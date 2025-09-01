from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from datetime import datetime, timedelta
from anomalies.models import AnomalyModel, TrainingJob
from metrics.models import Server
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Train an anomaly detection model with historical data'
    
    def add_arguments(self, parser):
        parser.add_argument(
            'model_name',
            type=str,
            help='Name of the model to train'
        )
        
        parser.add_argument(
            '--model-type',
            type=str,
            choices=['lstm_autoencoder', 'isolation_forest', 'one_class_svm', 'ensemble'],
            default='isolation_forest',
            help='Type of model to train'
        )
        
        parser.add_argument(
            '--servers',
            type=str,
            nargs='*',
            help='Server hostnames to include in training (default: all)'
        )
        
        parser.add_argument(
            '--days',
            type=int,
            default=30,
            help='Number of days of historical data to use'
        )
        
        parser.add_argument(
            '--config',
            type=str,
            help='JSON string of model configuration parameters'
        )
        
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force retrain even if model already exists'
        )
    
    def handle(self, *args, **options):
        model_name = options['model_name']
        model_type = options['model_type']
        server_hostnames = options.get('servers', [])
        days = options['days']
        config_str = options.get('config', '{}')
        force = options['force']
        
        try:
            import json
            config = json.loads(config_str)
        except json.JSONDecodeError:
            raise CommandError(f"Invalid JSON configuration: {config_str}")
        
        # Check if model already exists
        if AnomalyModel.objects.filter(name=model_name).exists() and not force:
            raise CommandError(
                f"Model '{model_name}' already exists. Use --force to retrain."
            )
        
        # Get servers
        if server_hostnames:
            servers = Server.objects.filter(hostname__in=server_hostnames)
            if servers.count() != len(server_hostnames):
                found = list(servers.values_list('hostname', flat=True))
                missing = set(server_hostnames) - set(found)
                raise CommandError(f"Servers not found: {missing}")
        else:
            servers = Server.objects.all()
        
        if not servers.exists():
            raise CommandError("No servers available for training")
        
        # Calculate data range
        end_date = timezone.now()
        start_date = end_date - timedelta(days=days)
        
        # Create or get model
        model, created = AnomalyModel.objects.get_or_create(
            name=model_name,
            defaults={
                'model_type': model_type,
                'status': 'training',
                'config': config,
                'model_path': f'/models/{model_name}_{model_type}.joblib',
                'scaler_path': f'/models/{model_name}_scaler.joblib',
            }
        )
        
        if not created and not force:
            raise CommandError(f"Model already exists: {model_name}")
        
        if not created:
            model.status = 'training'
            model.config.update(config)
            model.save()
        
        # Create training job
        training_job = TrainingJob.objects.create(
            model=model,
            training_config=config,
            data_range_start=start_date,
            data_range_end=end_date,
            status='queued'
        )
        
        # Add servers to training job
        training_job.servers.set(servers)
        
        self.stdout.write(
            self.style.SUCCESS(
                f"Training job created for model '{model_name}'\n"
                f"Model Type: {model_type}\n"
                f"Servers: {servers.count()}\n"
                f"Data Range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}\n"
                f"Job ID: {training_job.id}"
            )
        )
        
        # Here you would typically trigger the actual training process
        # This could be done via Celery, subprocess, or other background task system
        self.stdout.write(
            self.style.WARNING(
                "Note: This command creates the training job record. "
                "Actual model training should be implemented in your ML pipeline."
            )
        )