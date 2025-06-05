import joblib
import pandas as pd
import requests
import numpy as np
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import AnomalyDetectionResult
from django.conf import settings
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# === Constants ===
# Map your actual metrics to the features your model expects
METRIC_TO_FEATURE_MAP = {
    # CPU metrics
    'cpu_user': 'us',      # CPU user time
    'cpu_system': 'sy',    # CPU system time  
    'cpu_idle': 'idle',    # CPU idle time
    
    # Memory metrics
    'mem_active': 'avm',   # Active virtual memory
    'mem_free': 'fre',     # Free memory
    
    # Disk metrics
    'disk_tps': 'tps',     # Transfers per second
    
    # Network metrics
    'net_ipkts': 'ipkts',  # Input packets
    'net_opkts': 'opkts',  # Output packets
}

# Features that your isolation forest model expects
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
MODEL_PATH =" D:\\projet\\backend\\models\\mlmodels\\isolation_forest_combined_model.joblib"
SCALER_PATH = "D:\\projet\\backend\\models\\mlmodels\\isolation_forest_combined_scaler.joblib"

# URL to fetch historical data from your existing API
HISTORIC_API = 'http://localhost:8000/api/metrics/historical/'

class AnomalyDetectionView(APIView):
    """
    API endpoint to perform anomaly detection using a trained Isolation Forest model
    on combined metric data (CPU, Memory, Disk, Network).
    """

    def get(self, request):
        start = request.query_params.get('start')
        end = request.query_params.get('end')

        if not start or not end:
            return Response({
                'error': 'start and end parameters are required',
                'example': 'start=2025-06-03T11:25:00&end=2025-06-03T11:30:00'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Load model and scaler
            model = joblib.load(MODEL_PATH)
            scaler = joblib.load(SCALER_PATH)
            logger.info("Successfully loaded model and scaler")
        except Exception as e:
            logger.error(f"Failed to load model or scaler: {e}")
            return Response({
                'error': f'Failed to load model or scaler: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            # Fetch and combine metric data
            combined_df = self.fetch_combined_metrics(start, end)
            if combined_df is None or combined_df.empty:
                return Response({
                    'error': 'Failed to fetch or process metric data.'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Clean data
            initial_rows = len(combined_df)
            combined_df.dropna(inplace=True)
            
            if combined_df.empty:
                return Response({
                    'error': 'No data available after removing NaNs.',
                    'info': f'Initial rows: {initial_rows}, after cleaning: 0'
                }, status=status.HTTP_204_NO_CONTENT)

            logger.info(f"Processing {len(combined_df)} data points")

            # Ensure we have all required features
            missing_features = set(ISO_FOREST_FEATURES) - set(combined_df.columns)
            if missing_features:
                return Response({
                    'error': f'Missing required features: {list(missing_features)}',
                    'available_features': list(combined_df.columns)
                }, status=status.HTTP_400_BAD_REQUEST)

            # Scale data
            scaled_data = scaler.transform(combined_df[ISO_FOREST_FEATURES])

            # Predict anomalies
            predictions = model.predict(scaled_data)
            scores = model.score_samples(scaled_data)

            # Process results
            results = []
            anomaly_count = 0
            
            for i, (timestamp, row) in enumerate(combined_df.iterrows()):
                is_anomaly = predictions[i] == -1
                score = float(scores[i])  # Convert numpy float to Python float
                
                if is_anomaly:
                    anomaly_count += 1

                # Prepare metric values dict
                metric_values = {}
                for feature in ISO_FOREST_FEATURES:
                    metric_values[feature] = float(row[feature]) if pd.notna(row[feature]) else None

                # Save to database
                try:
                    record = AnomalyDetectionResult.objects.create(
                        timestamp=timestamp,
                        is_anomaly=is_anomaly,
                        anomaly_score=score,
                        metric_values=metric_values,
                        # Remove server_id since it's commented out in model
                    )
                except Exception as e:
                    logger.error(f"Failed to save record for timestamp {timestamp}: {e}")
                    continue

                results.append({
                    'timestamp': timestamp.isoformat(),
                    'is_anomaly': is_anomaly,
                    'anomaly_score': score,
                    'metric_values': metric_values
                })

            logger.info(f"Detected {anomaly_count} anomalies out of {len(results)} data points")

            return Response({
                'results': results,
                'summary': {
                    'total_points': len(results),
                    'anomalies_detected': anomaly_count,
                    'anomaly_rate': round(anomaly_count / len(results) * 100, 2) if results else 0
                }
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error in anomaly detection: {e}")
            return Response({
                'error': f'Internal server error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def fetch_combined_metrics(self, start, end):
        """
        Fetch and combine metrics from the /api/metrics/historical/ endpoint.
        Handles the actual structure of your API responses (vmstat, iostat, netstat).
        """
        all_data = {}
        
        # API metric types and the fields we need from each
        api_metrics = {
            'vmstat': ['us', 'sy', 'idle', 'avm', 'fre'],  # CPU and memory from vmstat
            'iostat': ['tps'],                              # Disk metrics from iostat
            'netstat': ['ipkts', 'opkts'],                 # Network metrics from netstat
        }

        for api_metric, required_fields in api_metrics.items():
            try:
                logger.info(f"Fetching {api_metric} data...")
                response = requests.get(
                    HISTORIC_API,
                    params={'metric': api_metric, 'start': start, 'end': end},
                    timeout=30
                )
                response.raise_for_status()
                data = response.json()

                if not data:
                    logger.warning(f"No data returned for metric {api_metric}")
                    continue

                df = pd.DataFrame(data)
                
                if df.empty:
                    logger.warning(f"Empty dataframe for metric {api_metric}")
                    continue
                    
                if 'timestamp' not in df.columns:
                    logger.error(f"No timestamp column in {api_metric} data")
                    continue

                # Convert timestamp
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                
                # Handle aggregation for metrics with multiple entries per timestamp
                if api_metric == 'iostat':
                    # Aggregate disk metrics (sum tps across all disks per timestamp)
                    df_grouped = df.groupby('timestamp').agg({
                        'tps': 'sum',
                        'kb_read': 'sum',
                        'kb_wrtn': 'sum'
                    }).reset_index()
                    df = df_grouped
                    
                elif api_metric == 'netstat':
                    # Aggregate network metrics (sum across all interfaces per timestamp)
                    # Use rate fields for better representation
                    df_grouped = df.groupby('timestamp').agg({
                        'ipkts': 'sum',
                        'opkts': 'sum',
                        'ipkts_rate': 'sum',
                        'opkts_rate': 'sum',
                        'ierrs': 'sum',
                        'oerrs': 'sum'
                    }).reset_index()
                    df = df_grouped
                    # Use rate values for better anomaly detection
                    df['ipkts'] = df['ipkts_rate']  # Use rate instead of cumulative
                    df['opkts'] = df['opkts_rate']  # Use rate instead of cumulative

                # Set timestamp as index
                df.set_index('timestamp', inplace=True)
                df = df.sort_index()

                # Extract only the fields we need for the model
                for field in required_fields:
                    if field in df.columns:
                        all_data[field] = df[[field]]
                        logger.info(f"Added {field} from {api_metric}")
                    else:
                        logger.warning(f"Field {field} not found in {api_metric} data")

            except requests.exceptions.RequestException as e:
                logger.error(f"Network error fetching {api_metric}: {e}")
                continue
            except Exception as e:
                logger.error(f"Error processing {api_metric}: {e}")
                continue

        if not all_data:
            logger.error("No metric data could be fetched")
            return None

        logger.info(f"Successfully fetched data for features: {list(all_data.keys())}")

        try:
            # Merge all metrics on timestamp using outer join
            combined_df = pd.concat(all_data.values(), axis=1, join='outer')
            
            # Sort by timestamp
            combined_df = combined_df.sort_index()
            
            # Handle missing data with interpolation
            combined_df = combined_df.interpolate(method='time', limit_direction='both')
            
            # Forward fill and backward fill remaining NaNs
            combined_df = combined_df.fillna(method='ffill').fillna(method='bfill')
            
            # Remove any remaining NaN rows
            initial_rows = len(combined_df)
            combined_df.dropna(inplace=True)
            final_rows = len(combined_df)
            
            logger.info(f"Combined dataframe shape: {combined_df.shape}")
            logger.info(f"Data cleaning: {initial_rows} -> {final_rows} rows")
            logger.info(f"Available features: {list(combined_df.columns)}")
            
            return combined_df
            
        except Exception as e:
            logger.error(f"Error combining metric data: {e}")
            return None


class AnomalyDetectionHistoryView(APIView):
    """
    API endpoint to retrieve historical anomaly detection results
    """
    
    def get(self, request):
        start = request.query_params.get('start')
        end = request.query_params.get('end')
        anomalies_only = request.query_params.get('anomalies_only', 'false').lower() == 'true'
        
        queryset = AnomalyDetectionResult.objects.all()
        
        if start:
            try:
                start_dt = pd.to_datetime(start)
                queryset = queryset.filter(timestamp__gte=start_dt)
            except:
                return Response({'error': 'Invalid start date format'}, status=status.HTTP_400_BAD_REQUEST)
        
        if end:
            try:
                end_dt = pd.to_datetime(end)
                queryset = queryset.filter(timestamp__lte=end_dt)
            except:
                return Response({'error': 'Invalid end date format'}, status=status.HTTP_400_BAD_REQUEST)
        
        if anomalies_only:
            queryset = queryset.filter(is_anomaly=True)
        
        queryset = queryset.order_by('-timestamp')[:1000]  # Limit results
        
        results = []
        for record in queryset:
            results.append({
                'timestamp': record.timestamp.isoformat(),
                'is_anomaly': record.is_anomaly,
                'anomaly_score': record.anomaly_score,
                'metric_values': record.metric_values
            })
        
        return Response({
            'results': results,
            'count': len(results)
        }, status=status.HTTP_200_OK)


class AnomalyPlotDataView(APIView):
    """
    API endpoint to get data formatted for plotting anomalies over time
    """
    
    def get(self, request):
        start = request.query_params.get('start')
        end = request.query_params.get('end')
        metric = request.query_params.get('metric', 'us')  # Default to CPU user time
        
        if not start or not end:
            return Response({
                'error': 'start and end parameters are required'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            start_dt = pd.to_datetime(start)
            end_dt = pd.to_datetime(end)
        except:
            return Response({
                'error': 'Invalid date format'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Get anomaly detection results
        queryset = AnomalyDetectionResult.objects.filter(
            timestamp__gte=start_dt,
            timestamp__lte=end_dt
        ).order_by('timestamp')
        
        if not queryset.exists():
            return Response({
                'error': 'No anomaly detection data found for this time range',
                'suggestion': 'Run anomaly detection first using /api/anomaly-detection/'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Prepare data for plotting
        normal_data = []
        anomaly_data = []
        
        for record in queryset:
            timestamp_str = record.timestamp.isoformat()
            
            # Get the metric value from stored metric_values
            metric_value = record.metric_values.get(metric)
            
            if metric_value is not None:
                data_point = {
                    'timestamp': timestamp_str,
                    'value': metric_value,
                    'anomaly_score': record.anomaly_score
                }
                
                if record.is_anomaly:
                    anomaly_data.append(data_point)
                else:
                    normal_data.append(data_point)
        
        return Response({
            'metric': metric,
            'normal_data': normal_data,
            'anomaly_data': anomaly_data,
            'summary': {
                'total_points': len(normal_data) + len(anomaly_data),
                'normal_points': len(normal_data),
                'anomaly_points': len(anomaly_data),
                'time_range': {
                    'start': start,
                    'end': end
                }
            }
        }, status=status.HTTP_200_OK)