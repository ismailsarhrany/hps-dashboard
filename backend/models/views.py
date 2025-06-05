import joblib
import pandas as pd
import requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import AnomalyDetectionResult
from django.conf import settings
from datetime import datetime

# === Constants ===
# Features to use from the combined metrics (vmstat + iostat + netstat)
ISO_FOREST_FEATURES = [
    'us',    # CPU user time
    'sy',    # CPU system time
    'idle',  # CPU idle time
    'avm',   # Active virtual memory
    'fre',   # Free memory
    'tps',   # Transfers per second (disk)
    'ipkts', # Input packets (network)
    'opkts'  # Output packets (network)
]

# Path to pre-trained model and scaler
MODEL_PATH = 'mlmodels/isolation_forest_combined_model.joblib'
SCALER_PATH = 'mlmodels/isolation_forest_combined_scaler.joblib'

# URL to fetch historical data from your existing API
HISTORIC_API = 'http://localhost:8000/api/metrics/historical/'

class AnomalyDetectionView(APIView):
    """
    API endpoint to perform anomaly detection using a trained Isolation Forest model
    on combined metric data (vmstat, iostat, netstat).
    """

    def get(self, request):
        start = request.query_params.get('start')
        end = request.query_params.get('end')

        if not start or not end:
            return Response({'error': 'start and end parameters are required'}, status=status.HTTP_400_BAD_REQUEST)

        # Load model and scaler
        try:
            model = joblib.load(MODEL_PATH)
            scaler = joblib.load(SCALER_PATH)
        except Exception as e:
            return Response({'error': f'Failed to load model or scaler: {e}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Fetch and combine metric data
        combined_df = self.fetch_combined_metrics(start, end)
        if combined_df is None or combined_df.empty:
            return Response({'error': 'Failed to fetch or process metric data.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Clean and scale
        combined_df.dropna(inplace=True)
        if combined_df.empty:
            return Response({'error': 'No data available after removing NaNs.'}, status=status.HTTP_204_NO_CONTENT)

        scaled_data = scaler.transform(combined_df[ISO_FOREST_FEATURES])

        # Predict
        predictions = model.predict(scaled_data)
        scores = model.score_samples(scaled_data)

        # Save and respond
        results = []
        for i, (timestamp, row) in enumerate(combined_df.iterrows()):
            is_anomaly = predictions[i] == -1
            score = scores[i]

            # Save to DB (adjust server_id logic if needed)
            record = AnomalyDetectionResult.objects.create(
                timestamp=timestamp,
                is_anomaly=is_anomaly,
                anomaly_score=score,
                metric_values=row.to_dict(),
                server_id=1
            )

            results.append({
                'timestamp': timestamp,
                'is_anomaly': is_anomaly,
                'anomaly_score': score,
                'metric_values': row.to_dict()
            })

        return Response(results, status=status.HTTP_200_OK)

    def fetch_combined_metrics(self, start, end):
        """
        Fetch and combine metrics from the /api/metrics/historical/ endpoint
        for each feature needed by the model.
        """
        all_data = {}

        for metric in ISO_FOREST_FEATURES:
            try:
                response = requests.get(
                    HISTORIC_API,
                    params={'metric': metric, 'start': start, 'end': end},
                    timeout=10
                )
                response.raise_for_status()
                data = response.json()

                df = pd.DataFrame(data)
                if df.empty or 'timestamp' not in df.columns or 'value' not in df.columns:
                    continue

                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df.set_index('timestamp', inplace=True)
                df = df.sort_index().rename(columns={'value': metric})
                all_data[metric] = df[[metric]]

            except Exception as e:
                print(f"Failed to fetch metric {metric}: {e}")
                continue

        if not all_data:
            return None

        # Merge all metrics on timestamp
        combined_df = pd.concat(all_data.values(), axis=1, join='outer')
        combined_df = combined_df.interpolate(method='time').fillna(method='ffill').fillna(method='bfill')

        return combined_df
