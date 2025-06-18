import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# ML Libraries
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error
import tensorflow as tf
from tensorflow.keras.models import Model, Sequential
from tensorflow.keras.layers import LSTM, Dense, Input, RepeatVector, TimeDistributed, Dropout
from tensorflow.keras.optimizers import Adam
from prophet import Prophet
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.seasonal import seasonal_decompose
import torch
import torch.nn as nn

# Set random seeds for reproducibility
np.random.seed(42)
tf.random.set_seed(42)

class DataGenerator:
    """Generate synthetic AIX server metrics data"""
    
    def __init__(self, start_date='2024-01-01', days=30, freq='5min'):
        self.start_date = start_date
        self.days = days
        self.freq = freq
        self.timestamps = pd.date_range(start=start_date, periods=days*288, freq=freq)
        
    def generate_vmstat_data(self):
        """Generate vmstat metrics with patterns and anomalies"""
        n = len(self.timestamps)
        
        # Base patterns with daily/weekly seasonality
        daily_pattern = np.sin(2 * np.pi * np.arange(n) / 288)  # 288 = 24h/5min
        weekly_pattern = np.sin(2 * np.pi * np.arange(n) / (288 * 7))
        
        data = {
            'timestamp': self.timestamps,
            # Running processes (0-50)
            'r': np.clip(5 + 3 * daily_pattern + np.random.normal(0, 2, n), 0, 50).astype(int),
            # Blocked processes (0-10)
            'b': np.clip(1 + 0.5 * daily_pattern + np.random.normal(0, 0.5, n), 0, 10).astype(int),
            # Available memory (MB)
            'avm': np.clip(8000 + 2000 * daily_pattern + np.random.normal(0, 500, n), 1000, 16000).astype(int),
            # Free memory (MB)
            'fre': np.clip(4000 + 1000 * daily_pattern + np.random.normal(0, 300, n), 500, 8000).astype(int),
            # Page in/out
            'pi': np.clip(10 + 5 * daily_pattern + np.random.normal(0, 3, n), 0, 100).astype(int),
            'po': np.clip(8 + 4 * daily_pattern + np.random.normal(0, 2, n), 0, 80).astype(int),
            # Frame rate
            'fr': np.clip(50 + 20 * daily_pattern + np.random.normal(0, 10, n), 0, 200).astype(int),
            # Interface in
            'interface_in': np.clip(100 + 50 * daily_pattern + np.random.normal(0, 20, n), 0, 500).astype(int),
            # Context switches
            'cs': np.clip(1000 + 500 * daily_pattern + np.random.normal(0, 100, n), 100, 5000).astype(int),
            # CPU usage percentages
            'us': np.clip(30 + 20 * daily_pattern + np.random.normal(0, 5, n), 0, 100),
            'sy': np.clip(15 + 10 * daily_pattern + np.random.normal(0, 3, n), 0, 100),
            'idle': np.clip(55 - 30 * daily_pattern + np.random.normal(0, 5, n), 0, 100),
        }
        
        # Inject anomalies
        anomaly_indices = np.random.choice(n, size=int(0.05 * n), replace=False)
        for idx in anomaly_indices:
            data['us'][idx] *= 2.5  # CPU spike
            data['avm'][idx] *= 0.3  # Memory spike
            data['cs'][idx] *= 3     # Context switch spike
            
        return pd.DataFrame(data)
    
    def generate_iostat_data(self):
        """Generate iostat metrics"""
        n = len(self.timestamps)
        disks = ['hdisk0', 'hdisk1', 'hdisk2']
        
        all_data = []
        for disk in disks:
            daily_pattern = np.sin(2 * np.pi * np.arange(n) / 288)
            disk_load = np.random.uniform(0.5, 2.0)  # Different load per disk
            
            data = {
                'timestamp': self.timestamps,
                'disk': disk,
                'tps': np.clip(50 * disk_load + 20 * daily_pattern + np.random.normal(0, 10, n), 0, 500),
                'kb_read': np.clip(1000 * disk_load + 500 * daily_pattern + np.random.normal(0, 200, n), 0, 10000),
                'kb_wrtn': np.clip(800 * disk_load + 400 * daily_pattern + np.random.normal(0, 150, n), 0, 8000),
                'service_time': np.clip(5 + 2 * daily_pattern + np.random.normal(0, 1, n), 0, 50)
            }
            all_data.append(pd.DataFrame(data))
            
        return pd.concat(all_data, ignore_index=True)
    
    def generate_netstat_data(self):
        """Generate netstat metrics"""
        n = len(self.timestamps)
        interfaces = ['en0', 'en1', 'lo0']
        
        all_data = []
        for interface in interfaces:
            daily_pattern = np.sin(2 * np.pi * np.arange(n) / 288)
            traffic_load = np.random.uniform(0.3, 1.5) if interface != 'lo0' else 0.1
            
            ipkts = np.clip(1000 * traffic_load + 500 * daily_pattern + np.random.normal(0, 100, n), 0, 10000).astype(int)
            opkts = np.clip(900 * traffic_load + 450 * daily_pattern + np.random.normal(0, 90, n), 0, 9000).astype(int)
            ierrs = np.clip(np.random.poisson(2, n), 0, 50).astype(int)
            oerrs = np.clip(np.random.poisson(1, n), 0, 30).astype(int)
            
            data = {
                'timestamp': self.timestamps,
                'interface': interface,
                'ipkts': ipkts,
                'ierrs': ierrs,
                'ipkts_rate': ipkts / 300.0,  # per second
                'ierrs_rate': ierrs / 300.0,
                'opkts': opkts,
                'opkts_rate': opkts / 300.0,
                'oerrs': oerrs,
                'oerrs_rate': oerrs / 300.0,
                'time': np.arange(n)
            }
            all_data.append(pd.DataFrame(data))
            
        return pd.concat(all_data, ignore_index=True)
    
    def generate_process_data(self):
        """Generate process metrics"""
        n = len(self.timestamps)
        processes = ['java', 'oracle', 'httpd', 'sshd', 'cron']
        
        all_data = []
        for i, proc in enumerate(processes):
            daily_pattern = np.sin(2 * np.pi * np.arange(n) / 288)
            base_cpu = np.random.uniform(5, 40)
            base_mem = np.random.uniform(2, 20)
            
            data = {
                'timestamp': self.timestamps,
                'pid': 1000 + i,
                'user': f'user{i}',
                'cpu': np.clip(base_cpu + 10 * daily_pattern + np.random.normal(0, 5, n), 0, 100),
                'mem': np.clip(base_mem + 5 * daily_pattern + np.random.normal(0, 2, n), 0, 100),
                'command': proc
            }
            all_data.append(pd.DataFrame(data))
            
        return pd.concat(all_data, ignore_index=True)

class DataPreprocessor:
    """Layer 1: Data Preprocessing"""
    
    def __init__(self):
        self.scalers = {}
        self.feature_columns = []
        
    def clean_data(self, df):
        """Data cleaning with missing value handling and outlier detection"""
        print("Cleaning data...")
        
        # Handle missing values
        numeric_columns = df.select_dtypes(include=[np.number]).columns
        df[numeric_columns] = df[numeric_columns].fillna(df[numeric_columns].median())
        
        # Outlier detection using IQR
        for col in numeric_columns:
            if col != 'timestamp':
                Q1 = df[col].quantile(0.25)
                Q3 = df[col].quantile(0.75)
                IQR = Q3 - Q1
                lower_bound = Q1 - 1.5 * IQR
                upper_bound = Q3 + 1.5 * IQR
                df[col] = df[col].clip(lower_bound, upper_bound)
        
        return df
    
    def feature_engineering(self, df):
        """Advanced feature engineering"""
        print("Engineering features...")
        
        # Temporal features
        df['hour'] = df['timestamp'].dt.hour
        df['day_of_week'] = df['timestamp'].dt.dayofweek
        df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
        
        # Statistical features (rolling windows)
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        for col in numeric_cols:
            if col not in ['hour', 'day_of_week', 'is_weekend']:
                df[f'{col}_ma_12'] = df[col].rolling(window=12, min_periods=1).mean()
                df[f'{col}_std_12'] = df[col].rolling(window=12, min_periods=1).std().fillna(0)
                df[f'{col}_diff'] = df[col].diff().fillna(0)
        
        return df
    
    def normalize_data(self, df, method='standard'):
        """Multi-method normalization"""
        print(f"Normalizing data using {method} method...")
        
        # Separate numeric and categorical columns
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        numeric_cols = [col for col in numeric_cols if col not in ['timestamp']]
        
        if method == 'standard':
            scaler = StandardScaler()
        elif method == 'minmax':
            scaler = MinMaxScaler()
        else:
            raise ValueError("Method must be 'standard' or 'minmax'")
        
        df_normalized = df.copy()
        df_normalized[numeric_cols] = scaler.fit_transform(df[numeric_cols])
        
        self.scalers[method] = scaler
        self.feature_columns = numeric_cols
        
        return df_normalized

class MultiScaleForecaster:
    """Layer 2: Multi-scale Forecasting Engine"""
    
    def __init__(self, batch_size=32):
        self.batch_size = batch_size
        self.models = {}
        self.ensemble_weights = {}
        
    def prepare_sequences(self, data, sequence_length, target_col):
        """Prepare sequences for LSTM/Transformer models"""
        X, y = [], []
        for i in range(len(data) - sequence_length):
            X.append(data[i:(i + sequence_length)])
            y.append(data[i + sequence_length, target_col])
        return np.array(X), np.array(y)
    
    def build_lstm_model(self, input_shape, name='lstm_24h'):
        """Build LSTM model for long-term forecasting (24h)"""
        model = Sequential([
            LSTM(128, return_sequences=True, input_shape=input_shape),
            Dropout(0.2),
            LSTM(128, return_sequences=True),
            Dropout(0.2),
            LSTM(128),
            Dropout(0.2),
            Dense(64, activation='relu'),
            Dense(1)
        ])
        
        model.compile(optimizer=Adam(learning_rate=0.001), loss='mse', metrics=['mae'])
        self.models[name] = model
        return model
    
    def build_transformer_model(self, input_shape, name='transformer_12h'):
        """Build Transformer model for medium-term forecasting (12h)"""
        inputs = Input(shape=input_shape)
        
        # Multi-head attention
        attention = tf.keras.layers.MultiHeadAttention(
            num_heads=8, key_dim=64, dropout=0.1
        )(inputs, inputs)
        
        # Add & Norm
        attention = tf.keras.layers.LayerNormalization(epsilon=1e-6)(inputs + attention)
        
        # Feed forward
        ffn = Sequential([
            Dense(512, activation='relu'),
            Dense(input_shape[-1])
        ])
        
        ffn_output = ffn(attention)
        ffn_output = tf.keras.layers.LayerNormalization(epsilon=1e-6)(attention + ffn_output)
        
        # Global average pooling and output
        outputs = tf.keras.layers.GlobalAveragePooling1D()(ffn_output)
        outputs = Dense(64, activation='relu')(outputs)
        outputs = Dense(1)(outputs)
        
        model = Model(inputs, outputs)
        model.compile(optimizer=Adam(learning_rate=0.001), loss='mse', metrics=['mae'])
        self.models[name] = model
        return model
    
    def train_arima_model(self, data, name='arima_6h'):
        """Train ARIMA model for short-term forecasting (6h)"""
        from statsmodels.tsa.arima.model import ARIMA
        
        # Auto ARIMA parameter selection (simplified)
        best_aic = float('inf')
        best_params = (1, 1, 1)
        
        for p in range(3):
            for d in range(2):
                for q in range(3):
                    try:
                        model = ARIMA(data, order=(p, d, q))
                        fitted_model = model.fit()
                        if fitted_model.aic < best_aic:
                            best_aic = fitted_model.aic
                            best_params = (p, d, q)
                    except:
                        continue
        
        # Train final model
        model = ARIMA(data, order=best_params)
        fitted_model = model.fit()
        self.models[name] = fitted_model
        return fitted_model
    
    def train_prophet_model(self, data, timestamps, name='prophet_48h'):
        """Train Prophet model for extended long-term forecasting (48h)"""
        # Prepare data for Prophet
        prophet_data = pd.DataFrame({
            'ds': timestamps,
            'y': data
        })
        
        model = Prophet(
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10,
            daily_seasonality=True,
            weekly_seasonality=True,
            yearly_seasonality=False
        )
        
        model.fit(prophet_data)
        self.models[name] = model
        return model
    
    def train_models_batch(self, df, target_column, epochs=50):
        """Train all models with batch processing"""
        print("Training multi-scale forecasting models...")
        
        # Prepare data
        data = df[self.feature_columns].values
        target_idx = list(df.columns).index(target_column)
        
        # LSTM (24h - sequence length 288 = 24h)
        seq_len_lstm = 288
        if len(data) > seq_len_lstm:
            X_lstm, y_lstm = self.prepare_sequences(data, seq_len_lstm, target_idx)
            lstm_model = self.build_lstm_model((seq_len_lstm, data.shape[1]))
            
            # Batch training
            for epoch in range(epochs):
                for i in range(0, len(X_lstm), self.batch_size):
                    batch_X = X_lstm[i:i+self.batch_size]
                    batch_y = y_lstm[i:i+self.batch_size]
                    lstm_model.train_on_batch(batch_X, batch_y)
                
                if (epoch + 1) % 10 == 0:
                    loss = lstm_model.evaluate(X_lstm, y_lstm, verbose=0)
                    print(f"LSTM Epoch {epoch+1}/{epochs}, Loss: {loss[0]:.4f}")
        
        # Transformer (12h - sequence length 144 = 12h)
        seq_len_transformer = 144
        if len(data) > seq_len_transformer:
            X_transformer, y_transformer = self.prepare_sequences(data, seq_len_transformer, target_idx)
            transformer_model = self.build_transformer_model((seq_len_transformer, data.shape[1]))
            
            # Batch training
            for epoch in range(epochs):
                for i in range(0, len(X_transformer), self.batch_size):
                    batch_X = X_transformer[i:i+self.batch_size]
                    batch_y = y_transformer[i:i+self.batch_size]
                    transformer_model.train_on_batch(batch_X, batch_y)
                
                if (epoch + 1) % 10 == 0:
                    loss = transformer_model.evaluate(X_transformer, y_transformer, verbose=0)
                    print(f"Transformer Epoch {epoch+1}/{epochs}, Loss: {loss[0]:.4f}")
        
        # ARIMA (6h)
        arima_data = df[target_column].values[-1000:]  # Use last 1000 points
        self.train_arima_model(arima_data)
        
        # Prophet (48h)
        prophet_data = df[target_column].values
        prophet_timestamps = df['timestamp'].values
        self.train_prophet_model(prophet_data, prophet_timestamps)
        
        print("Multi-scale forecasting models trained successfully!")

class ContextualAnomalyDetector:
    """Layer 3: Contextual Anomaly Detection Framework"""
    
    def __init__(self, batch_size=32):
        self.batch_size = batch_size
        self.detectors = {}
        self.thresholds = {
            'low': (0.3, 0.5),
            'medium': (0.5, 0.7),
            'high': (0.7, 0.9),
            'critical': (0.9, 1.0)
        }
        
    def build_lstm_autoencoder(self, input_shape, name='lstm_autoencoder'):
        """Build LSTM Autoencoder for sequential anomaly detection"""
        # Encoder
        inputs = Input(shape=input_shape)
        encoded = LSTM(64, return_sequences=True)(inputs)
        encoded = LSTM(32, return_sequences=False)(encoded)
        
        # Decoder
        repeated = RepeatVector(input_shape[0])(encoded)
        decoded = LSTM(32, return_sequences=True)(repeated)
        decoded = LSTM(64, return_sequences=True)(decoded)
        decoded = TimeDistributed(Dense(input_shape[1]))(decoded)
        
        autoencoder = Model(inputs, decoded)
        autoencoder.compile(optimizer=Adam(learning_rate=0.001), loss='mse')
        
        self.detectors[name] = autoencoder
        return autoencoder
    
    def train_isolation_forest(self, data, name='isolation_forest'):
        """Train Isolation Forest for point anomaly detection"""
        model = IsolationForest(
            n_estimators=100,
            contamination=0.05,
            random_state=42,
            n_jobs=-1
        )
        model.fit(data)
        self.detectors[name] = model
        return model
    
    def train_oneclass_svm(self, data, name='oneclass_svm'):
        """Train One-Class SVM for collective anomaly detection"""
        model = OneClassSVM(
            kernel='rbf',
            nu=0.05,
            gamma='scale'
        )
        model.fit(data)
        self.detectors[name] = model
        return model
    
    def train_detectors_batch(self, df, sequence_length=50, epochs=50):
        """Train all anomaly detectors with batch processing"""
        print("Training contextual anomaly detection models...")
        
        # Prepare data
        data = df[self.feature_columns].values
        
        # 1. Isolation Forest (Point anomaly detection)
        print("Training Isolation Forest...")
        self.train_isolation_forest(data)
        
        # 2. One-Class SVM (Collective anomaly detection)
        print("Training One-Class SVM...")
        # Use subset for SVM due to computational complexity
        svm_data = data[::10]  # Use every 10th point
        self.train_oneclass_svm(svm_data)
        
        # 3. LSTM Autoencoder (Sequential anomaly detection)
        print("Training LSTM Autoencoder...")
        if len(data) > sequence_length:
            # Prepare sequences
            X_seq = []
            for i in range(len(data) - sequence_length):
                X_seq.append(data[i:(i + sequence_length)])
            X_seq = np.array(X_seq)
            
            # Build and train autoencoder
            autoencoder = self.build_lstm_autoencoder((sequence_length, data.shape[1]))
            
            # Batch training
            for epoch in range(epochs):
                for i in range(0, len(X_seq), self.batch_size):
                    batch_X = X_seq[i:i+self.batch_size]
                    autoencoder.train_on_batch(batch_X, batch_X)
                
                if (epoch + 1) % 10 == 0:
                    loss = autoencoder.evaluate(X_seq, X_seq, verbose=0)
                    print(f"Autoencoder Epoch {epoch+1}/{epochs}, Loss: {loss:.4f}")
        
        print("Anomaly detection models trained successfully!")
    
    def detect_anomalies(self, data, sequence_length=50):
        """Detect anomalies using ensemble of detectors"""
        results = {}
        
        # Isolation Forest
        if 'isolation_forest' in self.detectors:
            if_scores = self.detectors['isolation_forest'].decision_function(data)
            if_anomalies = self.detectors['isolation_forest'].predict(data)
            results['isolation_forest'] = {
                'scores': if_scores,
                'anomalies': (if_anomalies == -1).astype(int)
            }
        
        # One-Class SVM
        if 'oneclass_svm' in self.detectors:
            svm_scores = self.detectors['oneclass_svm'].decision_function(data[::10])
            svm_anomalies = self.detectors['oneclass_svm'].predict(data[::10])
            # Interpolate back to original length
            svm_scores_full = np.repeat(svm_scores, 10)[:len(data)]
            svm_anomalies_full = np.repeat((svm_anomalies == -1).astype(int), 10)[:len(data)]
            results['oneclass_svm'] = {
                'scores': svm_scores_full,
                'anomalies': svm_anomalies_full
            }
        
        # LSTM Autoencoder
        if 'lstm_autoencoder' in self.detectors and len(data) > sequence_length:
            X_seq = []
            for i in range(len(data) - sequence_length):
                X_seq.append(data[i:(i + sequence_length)])
            X_seq = np.array(X_seq)
            
            reconstructions = self.detectors['lstm_autoencoder'].predict(X_seq, batch_size=self.batch_size)
            mse = np.mean(np.power(X_seq - reconstructions, 2), axis=(1, 2))
            
            # Pad with zeros for first sequence_length points
            mse_full = np.zeros(len(data))
            mse_full[sequence_length:] = mse
            
            # Threshold based on 95th percentile
            threshold = np.percentile(mse, 95)
            ae_anomalies = (mse_full > threshold).astype(int)
            
            results['lstm_autoencoder'] = {
                'scores': mse_full,
                'anomalies': ae_anomalies
            }
        
        return results
    
    def classify_severity(self, score, method='isolation_forest'):
        """Classify anomaly severity based on adaptive thresholds"""
        if method == 'isolation_forest':
            # Normalize IF scores (typically negative)
            normalized_score = max(0, min(1, (-score + 0.5) / 0.5))
        elif method == 'oneclass_svm':
            # Normalize SVM scores
            normalized_score = max(0, min(1, (-score + 1) / 2))
        else:
            # For autoencoder (MSE scores)
            normalized_score = min(1, score / 10)  # Adjust based on typical MSE range
        
        for severity, (low, high) in self.thresholds.items():
            if low <= normalized_score < high:
                return severity
        return 'normal'

class AnomalyForecastingSystem:
    """Main system integrating all layers"""
    
    def __init__(self, batch_size=32):
        self.batch_size = batch_size
        self.preprocessor = DataPreprocessor()
        self.forecaster = MultiScaleForecaster(batch_size)
        self.detector = ContextualAnomalyDetector(batch_size)
        self.data = {}
        
    def load_data(self, data_generator):
        """Load and preprocess all metric data"""
        print("Generating synthetic data...")
        
        # Generate all metric types
        self.data['vmstat'] = data_generator.generate_vmstat_data()
        self.data['iostat'] = data_generator.generate_iostat_data()
        self.data['netstat'] = data_generator.generate_netstat_data()
        self.data['process'] = data_generator.generate_process_data()
        
        print(f"Generated data shapes:")
        for key, df in self.data.items():
            print(f"  {key}: {df.shape}")
    
    def preprocess_all_data(self):
        """Apply Layer 1 preprocessing to all data"""
        print("\n=== LAYER 1: DATA PREPROCESSING ===")
        
        processed_data = {}
        for metric_type, df in self.data.items():
            print(f"\nProcessing {metric_type} data...")
            
            # Clean data
            df_clean = self.preprocessor.clean_data(df.copy())
            
            # Feature engineering
            df_features = self.preprocessor.feature_engineering(df_clean)
            
            # Normalize
            df_normalized = self.preprocessor.normalize_data(df_features, method='standard')
            
            processed_data[metric_type] = df_normalized
            
        self.processed_data = processed_data
        # Update feature columns from the first dataset
        self.forecaster.feature_columns = self.preprocessor.feature_columns
        self.detector.feature_columns = self.preprocessor.feature_columns
        
        return processed_data
    
    def train_forecasting_models(self, target_metric='vmstat', target_column='us'):
        """Apply Layer 2 multi-scale forecasting"""
        print(f"\n=== LAYER 2: MULTI-SCALE FORECASTING ===")
        
        if target_metric not in self.processed_data:
            raise ValueError(f"Metric {target_metric} not found in processed data")
        
        df = self.processed_data[target_metric]
        self.forecaster.train_models_batch(df, target_column, epochs=30)
        
        return self.forecaster.models
    
    def train_anomaly_detectors(self, target_metric='vmstat'):
        """Apply Layer 3 contextual anomaly detection"""
        print(f"\n=== LAYER 3: CONTEXTUAL ANOMALY DETECTION ===")
        
        if target_metric not in self.processed_data:
            raise ValueError(f"Metric {target_metric} not found in processed data")
        
        df = self.processed_data[target_metric]
        self.detector.train_detectors_batch(df, sequence_length=50, epochs=30)
        
        return self.detector.detectors
    
    def detect_and_analyze_anomalies(self, target_metric='vmstat'):
        """Detect anomalies and provide analysis"""
        print(f"\n=== ANOMALY DETECTION ANALYSIS ===")
        
        df = self.processed_data[target_metric]
        data = df[self.detector.feature_columns].values
        
        # Detect anomalies
        results = self.detector.detect_anomalies(data)
        
        # Analyze results
        analysis = {}
        for method, result in results.items():
            anomaly_count = np.sum(result['anomalies'])
            anomaly_rate = anomaly_count / len(result['anomalies'])
            
            # Classify severities
            severities = [self.detector.classify_severity(score, method) 
                         for score in result['scores']]
            severity_counts = pd.Series(severities).value_counts()
            
            analysis[method] = {
                'total_anomalies': anomaly_count,
                'anomaly_rate': anomaly_rate,
                'severity_distribution': severity_counts.to_dict()
            }
            
            print(f"\n{method.upper()} Results:")
            print(f"  Total anomalies: {anomaly_count}")
            print(f"  Anomaly rate: {anomaly_rate:.4f}")
            print(f"  Severity distribution: {severity_counts.to_dict()}")
        
        return results, analysis
    
    def generate_explanations(self, anomaly_results, target_metric='vmstat', top_n=5):
        """Generate explanations for detected anomalies"""
        print(f"\n=== ANOMALY EXPLANATIONS ===")
        
        df = self.processed_data[target_metric]
        explanations = []
        
        # Find top anomalies from each method
        for method, result in anomaly_results.items():
            anomaly_indices = np.where(result['anomalies'] == 1)[0]
            scores = result['scores'][anomaly_indices]
            
            # Get top N anomalies by score
            if method == 'isolation_forest':
                top_indices = anomaly_indices[np.argsort(scores)[:top_n]]  # Most negative scores
            else:
                top_indices = anomaly_indices[np.argsort(scores)[-top_n:]]  # Highest scores
            
            for idx in top_indices:
                timestamp = df.iloc[idx]['timestamp']
                severity = self.detector.classify_severity(result['scores'][idx], method)
                
                # Feature importance (simplified)
                feature_values = df.iloc[idx][self.detector.feature_columns].values
                feature_names = self.detector.feature_columns
                
                # Find most extreme features (highest absolute normalized values)
                extreme_features = []
                for i, (name, value) in enumerate(zip(feature_names, feature_values)):
                    if abs(value) > 1.5:  # Threshold for extreme values
                        extreme_features.append((name, value))
                
                explanation = {
                    'timestamp': timestamp,
                    'method': method,
                    'severity': severity,
                    'score': result['scores'][idx],
                    'extreme_features': extreme_features[:3],  # Top 3 extreme features
                    'context': self._generate_context_explanation(df.iloc[idx])
                }
                
                explanations.append(explanation)
                
                print(f"\nAnomaly detected at {timestamp} ({method}):")
                print(f"  Severity: {severity}")
                print(f"  Score: {result['scores'][idx]:.4f}")
                print(f"  Key factors: {[f[0] for f in extreme_features[:3]]}")
                print(f"  Context: {explanation['context']}")
        
        return explanations
    
    def _generate_context_explanation(self, row):
        """Generate contextual explanation for an anomaly"""
        hour = row['hour']
        is_weekend = row['is_weekend']
        
        context = []
        
        # Time-based context
        if 9 <= hour <= 17:
            context.append("during business hours")
        elif 22 <= hour or hour <= 6:
            context.append("during night hours")
        else:
            context.append("during off-peak hours")
        
        # Day context
        if is_weekend:
            context.append("on weekend")
        else:
            context.append("on weekday")
        
        return ", ".join(context)
    
    def visualize_results(self, target_metric='vmstat', target_column='us'):
        """Visualize anomaly detection and forecasting results"""
        print(f"\n=== VISUALIZATION ===")
        
        df = self.processed_data[target_metric]
        
        # Create subplots
        fig, axes = plt.subplots(3, 2, figsize=(15, 12))
        fig.suptitle(f'Anomaly Detection & Forecasting Results - {target_metric}', fontsize=16)
        
        # 1. Original time series with anomalies
        axes[0, 0].plot(df['timestamp'], df[target_column], label='Original Signal', alpha=0.7)
        
        # Detect anomalies for visualization
        data = df[self.detector.feature_columns].values
        anomaly_results = self.detector.detect_anomalies(data)
        
        # Overlay anomalies from different methods
        colors = ['red', 'orange', 'purple']
        for i, (method, result) in enumerate(anomaly_results.items()):
            anomaly_mask = result['anomalies'] == 1
            if np.any(anomaly_mask):
                axes[0, 0].scatter(df['timestamp'][anomaly_mask], 
                                 df[target_column][anomaly_mask], 
                                 color=colors[i % len(colors)], 
                                 label=f'{method} anomalies', 
                                 s=30, alpha=0.8)
        
        axes[0, 0].set_title(f'{target_column} with Detected Anomalies')
        axes[0, 0].set_xlabel('Time')
        axes[0, 0].set_ylabel(target_column)
        axes[0, 0].legend()
        axes[0, 0].tick_params(axis='x', rotation=45)
        
        # 2. Anomaly scores
        for i, (method, result) in enumerate(anomaly_results.items()):
            if i < 3:  # Only plot first 3 methods
                row = i // 2
                col = 1 if i % 2 == 0 else 0
                if i == 0:
                    axes[0, 1].plot(df['timestamp'], result['scores'], label=method, alpha=0.7)
                    axes[0, 1].set_title('Anomaly Scores')
                    axes[0, 1].set_xlabel('Time')
                    axes[0, 1].set_ylabel('Anomaly Score')
                    axes[0, 1].legend()
                    axes[0, 1].tick_params(axis='x', rotation=45)
                elif i == 1:
                    axes[1, 0].plot(df['timestamp'], result['scores'], label=method, alpha=0.7, color='orange')
                    axes[1, 0].set_title('SVM Anomaly Scores')
                    axes[1, 0].set_xlabel('Time')
                    axes[1, 0].set_ylabel('Anomaly Score')
                    axes[1, 0].tick_params(axis='x', rotation=45)
                else:
                    axes[1, 1].plot(df['timestamp'], result['scores'], label=method, alpha=0.7, color='purple')
                    axes[1, 1].set_title('Autoencoder Reconstruction Error')
                    axes[1, 1].set_xlabel('Time')
                    axes[1, 1].set_ylabel('MSE')
                    axes[1, 1].tick_params(axis='x', rotation=45)
        
        # 3. Feature correlation heatmap
        numeric_cols = df.select_dtypes(include=[np.number]).columns[:10]  # Top 10 features
        correlation_matrix = df[numeric_cols].corr()
        
        im = axes[2, 0].imshow(correlation_matrix, cmap='coolwarm', aspect='auto')
        axes[2, 0].set_xticks(range(len(numeric_cols)))
        axes[2, 0].set_yticks(range(len(numeric_cols)))
        axes[2, 0].set_xticklabels(numeric_cols, rotation=45, ha='right')
        axes[2, 0].set_yticklabels(numeric_cols)
        axes[2, 0].set_title('Feature Correlation Matrix')
        plt.colorbar(im, ax=axes[2, 0])
        
        # 4. Severity distribution
        severity_data = []
        severity_methods = []
        
        for method, result in anomaly_results.items():
            severities = [self.detector.classify_severity(score, method) 
                         for score in result['scores']]
            severity_counts = pd.Series(severities).value_counts()
            
            for severity, count in severity_counts.items():
                severity_data.append(count)
                severity_methods.append(f"{method}\n{severity}")
        
        if severity_data:
            axes[2, 1].bar(range(len(severity_data)), severity_data, 
                          color=['green', 'yellow', 'orange', 'red'] * (len(severity_data)//4 + 1))
            axes[2, 1].set_xticks(range(len(severity_data)))
            axes[2, 1].set_xticklabels(severity_methods, rotation=45, ha='right')
            axes[2, 1].set_title('Anomaly Severity Distribution')
            axes[2, 1].set_ylabel('Count')
        
        plt.tight_layout()
        plt.show()
        
        return fig

# Demo Usage and Testing
def run_demo():
    """Run complete demo of the anomaly detection system"""
    print("=" * 60)
    print("HYBRID ANOMALY DETECTION & FORECASTING SYSTEM DEMO")
    print("=" * 60)
    
    # Initialize system
    system = AnomalyForecastingSystem(batch_size=16)  # Smaller batch for demo
    
    # Generate synthetic data
    data_gen = DataGenerator(days=7, freq='5min')  # 1 week of 5-minute data
    system.load_data(data_gen)
    
    # Layer 1: Preprocessing
    processed_data = system.preprocess_all_data()
    
    # Layer 2: Forecasting (focus on CPU usage)
    forecasting_models = system.train_forecasting_models(
        target_metric='vmstat', 
        target_column='us'
    )
    
    # Layer 3: Anomaly Detection
    detection_models = system.train_anomaly_detectors(target_metric='vmstat')
    
    # Detect and analyze anomalies
    anomaly_results, analysis = system.detect_and_analyze_anomalies(target_metric='vmstat')
    
    # Generate explanations
    explanations = system.generate_explanations(anomaly_results, target_metric='vmstat')
    
    # Visualize results
    system.visualize_results(target_metric='vmstat', target_column='us')
    
    print("\n" + "=" * 60)
    print("DEMO COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    
    # Summary statistics
    print(f"\nSUMMARY STATISTICS:")
    print(f"- Total data points processed: {len(system.processed_data['vmstat'])}")
    print(f"- Features engineered: {len(system.preprocessor.feature_columns)}")
    print(f"- Forecasting models trained: {len(forecasting_models)}")
    print(f"- Anomaly detection models trained: {len(detection_models)}")
    print(f"- Total anomalies detected: {sum([a['total_anomalies'] for a in analysis.values()])}")
    print(f"- Explanations generated: {len(explanations)}")
    
    return system, anomaly_results, explanations

# Additional utility functions
def save_results_to_csv(system, anomaly_results, filename='anomaly_results.csv'):
    """Save anomaly detection results to CSV"""
    df = system.processed_data['vmstat'].copy()
    
    for method, result in anomaly_results.items():
        df[f'{method}_score'] = result['scores']
        df[f'{method}_anomaly'] = result['anomalies']
        df[f'{method}_severity'] = [
            system.detector.classify_severity(score, method) 
            for score in result['scores']
        ]
    
    df.to_csv(filename, index=False)
    print(f"Results saved to {filename}")

def load_real_data(file_paths):
    """Load real CSV data files"""
    data = {}
    for metric_type, file_path in file_paths.items():
        try:
            df = pd.read_csv(file_path)
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            data[metric_type] = df
            print(f"Loaded {metric_type}: {df.shape}")
        except Exception as e:
            print(f"Error loading {metric_type}: {e}")
    
    return data

# Evaluation Metrics and Confusion Matrix
from sklearn.metrics import confusion_matrix, classification_report, roc_auc_score, roc_curve
from sklearn.metrics import precision_score, recall_score, f1_score, accuracy_score
from sklearn.metrics import precision_recall_curve, average_precision_score
import itertools

class AnomalyEvaluator:
    """Comprehensive evaluation of anomaly detection models"""
    
    def __init__(self):
        self.evaluation_results = {}
        
    def create_ground_truth(self, data, anomaly_indices=None, contamination_rate=0.05):
        """Create ground truth labels for evaluation"""
        n_samples = len(data)
        y_true = np.zeros(n_samples)
        
        if anomaly_indices is not None:
            # Use provided anomaly indices
            y_true[anomaly_indices] = 1
        else:
            # Simulate ground truth based on extreme values
            # This is a simplified approach - in real scenarios, you'd have labeled data
            
            # Method 1: Statistical outliers (Z-score > 3)
            if isinstance(data, np.ndarray) and data.ndim > 1:
                # For multivariate data, use Mahalanobis distance
                from scipy.spatial.distance import mahalanobis
                mean = np.mean(data, axis=0)
                cov = np.cov(data.T)
                try:
                    inv_cov = np.linalg.inv(cov)
                    distances = [mahalanobis(point, mean, inv_cov) for point in data]
                    threshold = np.percentile(distances, (1 - contamination_rate) * 100)
                    y_true[np.array(distances) > threshold] = 1
                except:
                    # Fallback to univariate approach
                    z_scores = np.abs((data - np.mean(data, axis=0)) / np.std(data, axis=0))
                    max_z_scores = np.max(z_scores, axis=1)
                    threshold = np.percentile(max_z_scores, (1 - contamination_rate) * 100)
                    y_true[max_z_scores > threshold] = 1
            else:
                # For univariate data
                z_scores = np.abs((data - np.mean(data)) / np.std(data))
                threshold = np.percentile(z_scores, (1 - contamination_rate) * 100)
                y_true[z_scores > threshold] = 1
        
        return y_true.astype(int)
    
    def calculate_confusion_matrix(self, y_true, y_pred, method_name):
        """Calculate and visualize confusion matrix"""
        cm = confusion_matrix(y_true, y_pred)
        
        # Calculate metrics
        tn, fp, fn, tp = cm.ravel()
        
        metrics = {
            'confusion_matrix': cm,
            'true_negatives': tn,
            'false_positives': fp,
            'false_negatives': fn,
            'true_positives': tp,
            'accuracy': accuracy_score(y_true, y_pred),
            'precision': precision_score(y_true, y_pred, zero_division=0),
            'recall': recall_score(y_true, y_pred, zero_division=0),
            'f1_score': f1_score(y_true, y_pred, zero_division=0),
            'specificity': tn / (tn + fp) if (tn + fp) > 0 else 0,
            'sensitivity': tp / (tp + fn) if (tp + fn) > 0 else 0,
            'false_positive_rate': fp / (fp + tn) if (fp + tn) > 0 else 0,
            'false_negative_rate': fn / (fn + tp) if (fn + tp) > 0 else 0
        }
        
        self.evaluation_results[method_name] = metrics
        return metrics
    
    def plot_confusion_matrices(self, y_true, predictions_dict, figsize=(15, 10)):
        """Plot confusion matrices for all methods"""
        n_methods = len(predictions_dict)
        cols = min(3, n_methods)
        rows = (n_methods + cols - 1) // cols
        
        fig, axes = plt.subplots(rows, cols, figsize=figsize)
        if n_methods == 1:
            axes = [axes]
        elif rows == 1:
            axes = axes.reshape(1, -1)
        
        for idx, (method_name, y_pred) in enumerate(predictions_dict.items()):
            row = idx // cols
            col = idx % cols
            ax = axes[row, col] if rows > 1 else axes[col]
            
            # Calculate confusion matrix
            cm = confusion_matrix(y_true, y_pred)
            
            # Plot confusion matrix
            im = ax.imshow(cm, interpolation='nearest', cmap=plt.cm.Blues)
            ax.figure.colorbar(im, ax=ax)
            
            # Add labels
            classes = ['Normal', 'Anomaly']
            tick_marks = np.arange(len(classes))
            ax.set_xticks(tick_marks)
            ax.set_yticks(tick_marks)
            ax.set_xticklabels(classes)
            ax.set_yticklabels(classes)
            
            # Add text annotations
            thresh = cm.max() / 2.
            for i, j in itertools.product(range(cm.shape[0]), range(cm.shape[1])):
                ax.text(j, i, format(cm[i, j], 'd'),
                       horizontalalignment="center",
                       color="white" if cm[i, j] > thresh else "black")
            
            ax.set_ylabel('True Label')
            ax.set_xlabel('Predicted Label')
            ax.set_title(f'Confusion Matrix - {method_name}')
        
        # Hide empty subplots
        for idx in range(n_methods, rows * cols):
            row = idx // cols
            col = idx % cols
            if rows > 1:
                axes[row, col].axis('off')
            else:
                axes[col].axis('off')
        
        plt.tight_layout()
        plt.show()
        return fig
    
    def plot_roc_curves(self, y_true, scores_dict, figsize=(12, 8)):
        """Plot ROC curves for all methods"""
        plt.figure(figsize=figsize)
        
        colors = ['blue', 'red', 'green', 'orange', 'purple', 'brown']
        
        for idx, (method_name, scores) in enumerate(scores_dict.items()):
            # Normalize scores for ROC calculation
            if method_name == 'isolation_forest':
                # Isolation Forest scores are negative, invert them
                normalized_scores = -scores
            elif method_name == 'oneclass_svm':
                # One-Class SVM scores are negative, invert them
                normalized_scores = -scores
            else:
                # For autoencoder reconstruction error, higher is more anomalous
                normalized_scores = scores
            
            try:
                fpr, tpr, _ = roc_curve(y_true, normalized_scores)
                auc_score = roc_auc_score(y_true, normalized_scores)
                
                plt.plot(fpr, tpr, color=colors[idx % len(colors)], 
                        label=f'{method_name} (AUC = {auc_score:.3f})', linewidth=2)
                
                # Store AUC score
                if method_name in self.evaluation_results:
                    self.evaluation_results[method_name]['auc_score'] = auc_score
                    
            except Exception as e:
                print(f"Could not calculate ROC for {method_name}: {e}")
        
        plt.plot([0, 1], [0, 1], 'k--', label='Random Classifier')
        plt.xlim([0.0, 1.0])
        plt.ylim([0.0, 1.05])
        plt.xlabel('False Positive Rate')
        plt.ylabel('True Positive Rate')
        plt.title('ROC Curves - Anomaly Detection Methods')
        plt.legend(loc="lower right")
        plt.grid(True, alpha=0.3)
        plt.show()
    
    def plot_precision_recall_curves(self, y_true, scores_dict, figsize=(12, 8)):
        """Plot Precision-Recall curves for all methods"""
        plt.figure(figsize=figsize)
        
        colors = ['blue', 'red', 'green', 'orange', 'purple', 'brown']
        
        for idx, (method_name, scores) in enumerate(scores_dict.items()):
            # Normalize scores
            if method_name == 'isolation_forest':
                normalized_scores = -scores
            elif method_name == 'oneclass_svm':
                normalized_scores = -scores
            else:
                normalized_scores = scores
            
            try:
                precision, recall, _ = precision_recall_curve(y_true, normalized_scores)
                avg_precision = average_precision_score(y_true, normalized_scores)
                
                plt.plot(recall, precision, color=colors[idx % len(colors)], 
                        label=f'{method_name} (AP = {avg_precision:.3f})', linewidth=2)
                
                # Store average precision
                if method_name in self.evaluation_results:
                    self.evaluation_results[method_name]['average_precision'] = avg_precision
                    
            except Exception as e:
                print(f"Could not calculate PR curve for {method_name}: {e}")
        
        plt.xlim([0.0, 1.0])
        plt.ylim([0.0, 1.05])
        plt.xlabel('Recall')
        plt.ylabel('Precision')
        plt.title('Precision-Recall Curves - Anomaly Detection Methods')
        plt.legend(loc="lower left")
        plt.grid(True, alpha=0.3)
        plt.show()
    
    def generate_classification_report(self, y_true, predictions_dict):
        """Generate detailed classification reports"""
        print("\n" + "="*80)
        print("DETAILED CLASSIFICATION REPORTS")
        print("="*80)
        
        for method_name, y_pred in predictions_dict.items():
            print(f"\n{method_name.upper()} CLASSIFICATION REPORT:")
            print("-" * 50)
            print(classification_report(y_true, y_pred, 
                                      target_names=['Normal', 'Anomaly'], 
                                      digits=4))
    
    def create_evaluation_summary(self):
        """Create comprehensive evaluation summary"""
        if not self.evaluation_results:
            print("No evaluation results available. Run evaluate_models first.")
            return None
        
        # Create summary DataFrame
        summary_data = []
        for method, metrics in self.evaluation_results.items():
            summary_data.append({
                'Method': method,
                'Accuracy': metrics.get('accuracy', 0),
                'Precision': metrics.get('precision', 0),
                'Recall': metrics.get('recall', 0),
                'F1-Score': metrics.get('f1_score', 0),
                'Specificity': metrics.get('specificity', 0),
                'AUC': metrics.get('auc_score', 0),
                'Avg Precision': metrics.get('average_precision', 0),
                'FPR': metrics.get('false_positive_rate', 0),
                'FNR': metrics.get('false_negative_rate', 0)
            })
        
        summary_df = pd.DataFrame(summary_data)
        
        print("\n" + "="*100)
        print("EVALUATION SUMMARY - ALL METHODS")
        print("="*100)
        print(summary_df.round(4).to_string(index=False))
        
        # Highlight best performers
        print(f"\nBEST PERFORMERS:")
        print(f"Highest Accuracy: {summary_df.loc[summary_df['Accuracy'].idxmax(), 'Method']} ({summary_df['Accuracy'].max():.4f})")
        print(f"Highest F1-Score: {summary_df.loc[summary_df['F1-Score'].idxmax(), 'Method']} ({summary_df['F1-Score'].max():.4f})")
        print(f"Highest AUC: {summary_df.loc[summary_df['AUC'].idxmax(), 'Method']} ({summary_df['AUC'].max():.4f})")
        
        return summary_df
    
    def plot_metrics_comparison(self, figsize=(14, 10)):
        """Plot comparison of key metrics across methods"""
        if not self.evaluation_results:
            print("No evaluation results available.")
            return
        
        methods = list(self.evaluation_results.keys())
        metrics_to_plot = ['accuracy', 'precision', 'recall', 'f1_score', 'auc_score']
        metric_names = ['Accuracy', 'Precision', 'Recall', 'F1-Score', 'AUC']
        
        fig, axes = plt.subplots(2, 3, figsize=figsize)
        axes = axes.flatten()
        
        for idx, (metric, name) in enumerate(zip(metrics_to_plot, metric_names)):
            values = [self.evaluation_results[method].get(metric, 0) for method in methods]
            
            bars = axes[idx].bar(methods, values, color=['skyblue', 'lightcoral', 'lightgreen'][:len(methods)])
            axes[idx].set_title(f'{name} Comparison')
            axes[idx].set_ylabel(name)
            axes[idx].set_ylim(0, 1)
            
            # Add value labels on bars
            for bar, value in zip(bars, values):
                axes[idx].text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                              f'{value:.3f}', ha='center', va='bottom')
            
            # Rotate x-axis labels
            axes[idx].tick_params(axis='x', rotation=45)
        
        # Hide the last subplot
        axes[5].axis('off')
        
        plt.tight_layout()
        plt.show()
        return fig

# Enhanced AnomalyForecastingSystem with evaluation capabilities
class EnhancedAnomalyForecastingSystem(AnomalyForecastingSystem):
    """Enhanced system with comprehensive evaluation capabilities"""
    
    def __init__(self, batch_size=32):
        super().__init__(batch_size)
        self.evaluator = AnomalyEvaluator()
        self.ground_truth = None
    
    def evaluate_models(self, target_metric='vmstat', contamination_rate=0.05, 
                       known_anomaly_indices=None):
        """Comprehensive model evaluation with confusion matrices and scores"""
        print(f"\n=== MODEL EVALUATION ===")
        
        # Get processed data
        df = self.processed_data[target_metric]
        data = df[self.detector.feature_columns].values
        
        # Create or use ground truth
        if known_anomaly_indices is not None:
            self.ground_truth = np.zeros(len(data))
            self.ground_truth[known_anomaly_indices] = 1
        else:
            print("Creating synthetic ground truth based on statistical outliers...")
            self.ground_truth = self.evaluator.create_ground_truth(
                data, contamination_rate=contamination_rate
            )
        
        print(f"Ground truth created: {np.sum(self.ground_truth)} anomalies out of {len(self.ground_truth)} samples")
        print(f"Anomaly rate: {np.sum(self.ground_truth) / len(self.ground_truth):.4f}")
        
        # Detect anomalies
        anomaly_results = self.detector.detect_anomalies(data)
        
        # Prepare predictions and scores
        predictions_dict = {}
        scores_dict = {}
        
        for method, result in anomaly_results.items():
            predictions_dict[method] = result['anomalies']
            scores_dict[method] = result['scores']
            
            # Calculate confusion matrix and metrics
            metrics = self.evaluator.calculate_confusion_matrix(
                self.ground_truth, result['anomalies'], method
            )
            
            print(f"\n{method.upper()} METRICS:")
            print(f"  Accuracy: {metrics['accuracy']:.4f}")
            print(f"  Precision: {metrics['precision']:.4f}")
            print(f"  Recall: {metrics['recall']:.4f}")
            print(f"  F1-Score: {metrics['f1_score']:.4f}")
            print(f"  Specificity: {metrics['specificity']:.4f}")
        
        # Generate visualizations
        print("\nGenerating evaluation visualizations...")
        
        # Confusion matrices
        self.evaluator.plot_confusion_matrices(self.ground_truth, predictions_dict)
        
        # ROC curves
        self.evaluator.plot_roc_curves(self.ground_truth, scores_dict)
        
        # Precision-Recall curves
        self.evaluator.plot_precision_recall_curves(self.ground_truth, scores_dict)
        
        # Classification reports
        self.evaluator.generate_classification_report(self.ground_truth, predictions_dict)
        
        # Summary and comparison
        summary_df = self.evaluator.create_evaluation_summary()
        self.evaluator.plot_metrics_comparison()
        
        return {
            'predictions': predictions_dict,
            'scores': scores_dict,
            'ground_truth': self.ground_truth,
            'summary': summary_df,
            'detailed_metrics': self.evaluator.evaluation_results
        }
    
    def cross_validate_models(self, target_metric='vmstat', n_splits=5):
        """Perform time-series cross-validation"""
        print(f"\n=== CROSS-VALIDATION ===")
        
        df = self.processed_data[target_metric]
        data = df[self.detector.feature_columns].values
        
        # Time series split
        split_size = len(data) // n_splits
        cv_results = {}
        
        for method in ['isolation_forest', 'oneclass_svm']:
            method_scores = []
            
            for i in range(n_splits):
                start_idx = i * split_size
                end_idx = (i + 1) * split_size if i < n_splits - 1 else len(data)
                
                train_data = data[:start_idx] if start_idx > 0 else data[:end_idx//2]
                test_data = data[start_idx:end_idx]
                
                if len(train_data) > 100 and len(test_data) > 50:
                    # Train model on training data
                    if method == 'isolation_forest':
                        model = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
                    else:
                        model = OneClassSVM(kernel='rbf', nu=0.05, gamma='scale')
                    
                    model.fit(train_data)
                    
                    # Test on test data
                    test_predictions = model.predict(test_data)
                    test_scores = model.decision_function(test_data)
                    
                    # Create ground truth for test data
                    test_ground_truth = self.evaluator.create_ground_truth(test_data)
                    
                    # Calculate metrics
                    test_predictions_binary = (test_predictions == -1).astype(int)
                    f1 = f1_score(test_ground_truth, test_predictions_binary)
                    method_scores.append(f1)
            
            cv_results[method] = {
                'mean_f1': np.mean(method_scores),
                'std_f1': np.std(method_scores),
                'scores': method_scores
            }
            
            print(f"{method}: F1 = {np.mean(method_scores):.4f} ± {np.std(method_scores):.4f}")
        
        return cv_results

# Performance monitoring
    """Monitor system performance and resource usage"""
    
    def __init__(self):
        self.metrics = {}
        
    def log_performance(self, stage, execution_time, memory_usage=None):
        """Log performance metrics for each stage"""
        self.metrics[stage] = {
            'execution_time': execution_time,
            'memory_usage': memory_usage,
            'timestamp': datetime.now()
        }
    
    def get_performance_summary(self):
        """Get summary of performance metrics"""
        total_time = sum([m['execution_time'] for m in self.metrics.values()])
        
        print("\nPERFORMANCE SUMMARY:")
        print("-" * 40)
        for stage, metrics in self.metrics.items():
            print(f"{stage}: {metrics['execution_time']:.2f}s")
        print(f"Total execution time: {total_time:.2f}s")
        
        return self.metrics

# GPU memory management
def clear_gpu_memory():
    """Clear GPU memory to prevent OOM errors"""
    if tf.config.list_physical_devices('GPU'):
        tf.keras.backend.clear_session()
        print("GPU memory cleared")

# Demo Usage with Comprehensive Evaluation
def run_comprehensive_demo():
    """Run complete demo with evaluation metrics"""
    print("=" * 80)
    print("COMPREHENSIVE ANOMALY DETECTION EVALUATION DEMO")
    print("=" * 80)
    
    # Initialize enhanced system
    system = EnhancedAnomalyForecastingSystem(batch_size=16)
    
    # Generate synthetic data with known anomalies
    data_gen = DataGenerator(days=7, freq='5min')
    system.load_data(data_gen)
    
    # Layer 1: Preprocessing
    processed_data = system.preprocess_all_data()
    
    # Layer 2: Forecasting
    forecasting_models = system.train_forecasting_models(
        target_metric='vmstat', 
        target_column='us'
    )
    
    # Layer 3: Anomaly Detection
    detection_models = system.train_anomaly_detectors(target_metric='vmstat')
    
    # Comprehensive Evaluation
    evaluation_results = system.evaluate_models(
        target_metric='vmstat',
        contamination_rate=0.05  # Expected 5% anomaly rate
    )
    
    # Cross-validation
    cv_results = system.cross_validate_models(target_metric='vmstat', n_splits=5)
    
    print("\n" + "=" * 80)
    print("COMPREHENSIVE EVALUATION COMPLETED!")
    print("=" * 80)
    
    return system, evaluation_results, cv_results

# Utility function to create custom ground truth
def create_custom_ground_truth(timestamps, anomaly_periods):
    """
    Create ground truth based on known anomaly periods
    
    Parameters:
    timestamps: array of timestamps
    anomaly_periods: list of tuples (start_time, end_time) defining anomaly periods
    """
    ground_truth = np.zeros(len(timestamps))
    
    for start_time, end_time in anomaly_periods:
        mask = (timestamps >= start_time) & (timestamps <= end_time)
        ground_truth[mask] = 1
    
    return ground_truth.astype(int)

# Example usage with custom ground truth
def demo_with_custom_ground_truth():
    """Demo with manually defined anomaly periods"""
    
    # Initialize system
    system = EnhancedAnomalyForecastingSystem(batch_size=16)
    data_gen = DataGenerator(days=7, freq='5min')
    system.load_data(data_gen)
    
    # Preprocessing and training
    system.preprocess_all_data()
    system.train_anomaly_detectors(target_metric='vmstat')
    
    # Define known anomaly periods (example)
    df = system.processed_data['vmstat']
    timestamps = df['timestamp'].values
    
    anomaly_periods = [
        (timestamps[100], timestamps[120]),   # First anomaly period
        (timestamps[500], timestamps[530]),   # Second anomaly period
        (timestamps[800], timestamps[820]),   # Third anomaly period
    ]
    
    # Create custom ground truth
    custom_ground_truth = create_custom_ground_truth(timestamps, anomaly_periods)
    
    # Evaluate with custom ground truth
    data = df[system.detector.feature_columns].values
    anomaly_results = system.detector.detect_anomalies(data)
    
    # Manual evaluation
    predictions_dict = {}
    scores_dict = {}
    
    for method, result in anomaly_results.items():
        predictions_dict[method] = result['anomalies']
        scores_dict[method] = result['scores']
        
        # Calculate metrics
        metrics = system.evaluator.calculate_confusion_matrix(
            custom_ground_truth, result['anomalies'], method
        )
    
    # Visualize results
    system.evaluator.plot_confusion_matrices(custom_ground_truth, predictions_dict)
    system.evaluator.plot_roc_curves(custom_ground_truth, scores_dict)
    system.evaluator.create_evaluation_summary()
    
    return system, custom_ground_truth, predictions_dict

# Performance comparison function
def compare_model_performance(results_dict):
    """Compare performance across different configurations"""
    
    comparison_data = []
    
    for config_name, results in results_dict.items():
        metrics = results['detailed_metrics']
        
        for method, method_metrics in metrics.items():
            comparison_data.append({
                'Configuration': config_name,
                'Method': method,
                'Accuracy': method_metrics.get('accuracy', 0),
                'Precision': method_metrics.get('precision', 0),
                'Recall': method_metrics.get('recall', 0),
                'F1-Score': method_metrics.get('f1_score', 0),
                'AUC': method_metrics.get('auc_score', 0)
            })
    
    comparison_df = pd.DataFrame(comparison_data)
    
    # Pivot for better visualization
    pivot_metrics = ['Accuracy', 'Precision', 'Recall', 'F1-Score', 'AUC']
    
    fig, axes = plt.subplots(2, 3, figsize=(18, 12))
    axes = axes.flatten()
    
    for idx, metric in enumerate(pivot_metrics):
        pivot_df = comparison_df.pivot(index='Method', columns='Configuration', values=metric)
        
        pivot_df.plot(kind='bar', ax=axes[idx], width=0.8)
        axes[idx].set_title(f'{metric} Comparison')
        axes[idx].set_ylabel(metric)
        axes[idx].tick_params(axis='x', rotation=45)
        axes[idx].legend(title='Configuration')
        axes[idx].grid(True, alpha=0.3)
    
    axes[5].axis('off')
    plt.tight_layout()
    plt.show()
    
    return comparison_df

# Example of batch evaluation for parameter tuning
def parameter_tuning_demo():
    """Demo of parameter tuning with evaluation metrics"""
    
    # Different contamination rates to test
    contamination_rates = [0.03, 0.05, 0.07, 0.1]
    results_dict = {}
    
    for rate in contamination_rates:
        print(f"\nTesting contamination rate: {rate}")
        
        # Initialize system
        system = EnhancedAnomalyForecastingSystem(batch_size=16)
        data_gen = DataGenerator(days=5, freq='5min')  # Smaller dataset for speed
        system.load_data(data_gen)
        
        # Preprocessing and training
        system.preprocess_all_data()
        
        # Train with different contamination rate
        system.detector.train_isolation_forest(
            system.processed_data['vmstat'][system.detector.feature_columns].values,
            name=f'isolation_forest_{rate}'
        )
        
        # Evaluate
        evaluation_results = system.evaluate_models(
            target_metric='vmstat',
            contamination_rate=rate
        )
        
        results_dict[f'contamination_{rate}'] = evaluation_results
    
    # Compare results
    comparison_df = compare_model_performance(results_dict)
    print("\nParameter Tuning Results:")
    print(comparison_df.groupby('Configuration')[['Accuracy', 'F1-Score', 'AUC']].mean())
    
    return results_dict, comparison_df

# Run the demo
if __name__ == "__main__":
    # Choose which demo to run:
    
    # 1. Basic demo (original)
    # system, results, explanations = run_demo()
    
    # 2. Comprehensive evaluation demo
    system, evaluation_results, cv_results = run_comprehensive_demo()
    
    # 3. Demo with custom ground truth
    # system, ground_truth, predictions = demo_with_custom_ground_truth()
    
    # 4. Parameter tuning demo
    # tuning_results, comparison_df = parameter_tuning_demo()
    
    # Print final summary
    print(f"\nFINAL EVALUATION SUMMARY:")
    print(f"- Best performing method (F1-Score): {evaluation_results['summary'].loc[evaluation_results['summary']['F1-Score'].idxmax(), 'Method']}")
    print(f"- Best F1-Score: {evaluation_results['summary']['F1-Score'].max():.4f}")
    print(f"- Best AUC Score: {evaluation_results['summary']['AUC'].max():.4f}")
    
    # Save detailed results
    evaluation_results['summary'].to_csv('model_evaluation_summary.csv', index=False)
    print("Evaluation results saved to 'model_evaluation_summary.csv'")
    
    # Clear GPU memory
    clear_gpu_memory()