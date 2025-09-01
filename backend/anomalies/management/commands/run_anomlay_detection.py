from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from datetime import datetime, timedelta
from anomalies.models import AnomalyModel, AnomalyDetection
from metrics.models import Server
import requests
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Run anomaly detection on recent server metrics'
    
    def add_arguments(self, parser):
        parser.add_argument(
            '--model',
            type=str,
            help='Model name to use for detection (default: best available)'
        )
        
        parser.add_argument(
            '--servers',
            type=str,
            nargs='*',
            help='Server hostnames to analyze (default: all)'
        )
        
        parser.add_argument(
            '--hours',
            type=int,
            default=1,
            help='Number of hours of recent data to analyze'
        )
        
        parser.add_argument(
            '--threshold',
            type=float,
            help='Custom threshold for anomaly detection'
        )
        
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Run detection without saving results'
        )
    
    def handle(self, *args, **options):
        model_name = options.get('model')
        server_hostnames = options.get('servers', [])
        hours = options['hours']
        custom_threshold = options.get('threshold')
        dry_run = options['dry_run']
        
        # Get model
        if model_name:
            try:
                model = AnomalyModel.objects.get(name=model_name, status='ready')
            except AnomalyModel.DoesNotExist:
                raise CommandError(f"Model '{model_name}' not found or not ready")
        else:
            # Get best performing ready model
            model = AnomalyModel.objects.ready().order_by(
                '-performance_metrics__ensemble__f1_score'
            ).first()
            
            if not model:
                raise CommandError("No ready models available")
        
        self.stdout.write(f"Using model: {model.name} ({model.model_type})")
        
        # Get servers
        if server_hostnames:
            servers = Server.objects.filter(hostname__in=server_hostnames)
            if servers.count() != len(server_hostnames):
                found = list(servers.values_list('hostname', flat=True))
                missing = set(server_hostnames) - set(found)
                self.stdout.write(
                    self.style.WARNING(f"Servers not found: {missing}")
                )
        else:
            servers = Server.objects.all()
        
        if not servers.exists():
            raise CommandError("No servers available for analysis")
        
        # Calculate time range
        end_time = timezone.now()
        start_time = end_time - timedelta(hours=hours)
        
        self.stdout.write(
            f"Analyzing {servers.count()} servers from "
            f"{start_time.strftime('%Y-%m-%d %H:%M')} to "
            f"{end_time.strftime('%Y-%m-%d %H:%M')}"
        )
        
        total_detections = 0
        total_anomalies = 0
        
        for server in servers:
            try:
                detections, anomalies = self.run_detection_for_server(
                    server, model, start_time, end_time, custom_threshold, dry_run
                )
                total_detections += detections
                total_anomalies += anomalies
                
                self.stdout.write(
                    f"  {server.hostname}: {anomalies}/{detections} anomalies detected"
                )
                
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f"Error processing {server.hostname}: {e}")
                )
                continue
        
        # Update model last used timestamp
        if not dry_run:
            model.update_last_used()
        
        # Summary
        anomaly_rate = (total_anomalies / total_detections * 100) if total_detections > 0 else 0
        
        self.stdout.write(
            self.style.SUCCESS(
                f"\nAnomaly detection completed:\n"
                f"Total data points: {total_detections}\n"
                f"Anomalies detected: {total_anomalies}\n"
                f"Anomaly rate: {anomaly_rate:.2f}%\n"
                f"Model used: {model.name}"
            )
        )
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING("Dry run mode - no results were saved")
            )
    
    def run_detection_for_server(self, server, model, start_time, end_time, 
                                custom_threshold, dry_run):
        """Run anomaly detection for a single server"""
        
        # Call the anomaly detection API endpoint
        api_url = 'http://localhost:8000/api/anomaly-detection/'
        
        params = {
            'start': start_time.isoformat(),
            'end': end_time.isoformat(),
        }
        
        try:
            response = requests.get(api_url, params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
            
            results = data.get('results', [])
            detections = len(results)
            anomalies = sum(1 for r in results if r['is_anomaly'])
            
            if not dry_run:
                # Process and save enhanced anomaly records
                for result in results:
                    if result['is_anomaly']:
                        self.create_enhanced_anomaly_record(
                            server, model, result, custom_threshold
                        )
            
            return detections, anomalies
            
        except requests.exceptions.RequestException as e:
            logger.error(f"API call failed for {server.hostname}: {e}")
            raise CommandError(f"Failed to fetch anomaly data: {e}")
        except Exception as e:
            logger.error(f"Processing failed for {server.hostname}: {e}")
            raise CommandError(f"Failed to process results: {e}")
    
    def create_enhanced_anomaly_record(self, server, model, result, custom_threshold):
        """Create enhanced anomaly detection record with additional context"""
        
        # Determine severity based on score and threshold
        score = abs(result['anomaly_score'])
        threshold = custom_threshold or model.threshold or 0.5
        
        if score >= threshold * 1.5:
            severity = 'critical'
        elif score >= threshold * 1.2:
            severity = 'high'
        elif score >= threshold:
            severity = 'medium'
        else:
            severity = 'low'
        
        # Extract contributing features (assume top 3 with highest values)
        metric_values = result.get('metric_values', {})
        contributing_features = sorted(
            metric_values.keys(),
            key=lambda k: abs(metric_values.get(k, 0)),
            reverse=True
        )[:3]
        
        # Create anomaly record
        AnomalyDetection.objects.create(
            server=server,
            model=model,
            timestamp=datetime.fromisoformat(result['timestamp'].replace('Z', '+00:00')),
            anomaly_score=score,
            confidence=0.8,  # Default confidence
            severity=severity,
            status='new',
            metric_values=metric_values,
            features_contributing=contributing_features,
            expected_values={},  # Would need baseline calculation
            deviation_percentages={},  # Would need baseline calculation
            individual_scores={'isolation_forest': score},
            model_agreement=1.0,  # Single model
        )