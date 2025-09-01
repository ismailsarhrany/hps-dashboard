from django.db.models.signals import post_save, pre_save, post_delete
from django.dispatch import receiver
from django.utils import timezone
from django.core.cache import cache
from .models import (
    AnomalyDetection, AnomalyPrediction, TrainingJob,
    AnomalyModel, ModelPerformanceMetric
)
import logging

logger = logging.getLogger(__name__)


@receiver(post_save, sender=AnomalyDetection)
def anomaly_detection_post_save(sender, instance, created, **kwargs):
    """
    Handle actions after anomaly detection is saved
    """
    if created:
        logger.info(f"New anomaly detected: {instance.id} on {instance.server.hostname}")
        
        # Update model last used timestamp
        if instance.model:
            instance.model.update_last_used()
        
        # Clear relevant caches
        cache_keys = [
            f'anomaly_count_{instance.server.id}',
            f'recent_anomalies_{instance.server.id}',
            'anomaly_summary_dashboard'
        ]
        cache.delete_many(cache_keys)
        
        # Create alert for critical anomalies
        if instance.severity == 'critical':
            # You can integrate with notification systems here
            logger.critical(f"Critical anomaly detected on {instance.server.hostname}: {instance.description}")


@receiver(pre_save, sender=AnomalyDetection)
def anomaly_detection_pre_save(sender, instance, **kwargs):
    """
    Handle validation and auto-population before saving anomaly detection
    """
    # Auto-generate description if not provided
    if not instance.description and instance.metric_values:
        instance.description = generate_anomaly_description(instance)
    
    # Auto-determine severity based on score and confidence
    if not instance.severity:
        instance.severity = determine_severity(instance.anomaly_score, instance.confidence)
    
    # Auto-generate tags based on contributing features
    if instance.features_contributing and not instance.tags:
        instance.tags = generate_anomaly_tags(instance.features_contributing)


@receiver(post_save, sender=TrainingJob)
def training_job_post_save(sender, instance, created, **kwargs):
    """
    Handle training job status changes
    """
    if not created:  # Only handle updates, not creation
        if instance.status == 'completed':
            logger.info(f"Training job completed for model: {instance.model.name}")
            
            # Update model status to ready if training successful
            if instance.final_metrics and instance.model:
                instance.model.status = 'ready'
                instance.model.trained_at = timezone.now()
                instance.model.performance_metrics = instance.final_metrics
                instance.model.save(update_fields=['status', 'trained_at', 'performance_metrics'])
                
                # Create performance metric record
                create_performance_metric_from_training(instance)
        
        elif instance.status == 'failed':
            logger.error(f"Training job failed for model: {instance.model.name}")
            if instance.model:
                instance.model.status = 'failed'
                instance.model.save(update_fields=['status'])


@receiver(post_save, sender=AnomalyModel)
def anomaly_model_post_save(sender, instance, created, **kwargs):
    """
    Handle model lifecycle events
    """
    if created:
        logger.info(f"New anomaly model created: {instance.name}")
    
    # Clear model-related caches when model is updated
    if not created:
        cache_keys = [
            f'model_performance_{instance.id}',
            'available_models_list',
            'model_statistics'
        ]
        cache.delete_many(cache_keys)


@receiver(post_save, sender=AnomalyPrediction)
def anomaly_prediction_post_save(sender, instance, created, **kwargs):
    """
    Handle prediction events
    """
    if created:
        logger.info(f"New prediction created for {instance.server.hostname}: {instance.probability:.2%} probability")
        
        # Clear prediction caches
        cache.delete(f'predictions_{instance.server.id}')
        
        # Create alert for high-probability predictions
        if instance.probability >= 0.8:
            logger.warning(f"High probability anomaly prediction for {instance.server.hostname}")


def generate_anomaly_description(anomaly_instance):
    """
    Auto-generate description for anomaly based on contributing features
    """
    try:
        contributing = anomaly_instance.features_contributing[:3]  # Top 3 contributors
        server_name = anomaly_instance.server.hostname
        
        feature_map = {
            'us': 'high CPU user time',
            'sy': 'high CPU system time', 
            'idle': 'low CPU idle time',
            'avm': 'abnormal active memory',
            'fre': 'low free memory',
            'tps': 'unusual disk activity',
            'ipkts': 'high network input',
            'opkts': 'high network output'
        }
        
        descriptions = [feature_map.get(feature, f'unusual {feature}') for feature in contributing]
        
        if len(descriptions) == 1:
            return f"Anomaly detected on {server_name}: {descriptions[0]}"
        elif len(descriptions) == 2:
            return f"Anomaly detected on {server_name}: {descriptions[0]} and {descriptions[1]}"
        else:
            return f"Anomaly detected on {server_name}: {', '.join(descriptions[:-1])}, and {descriptions[-1]}"
    
    except Exception as e:
        logger.error(f"Error generating anomaly description: {e}")
        return f"Anomaly detected on {anomaly_instance.server.hostname}"


def determine_severity(anomaly_score, confidence):
    """
    Auto-determine severity based on anomaly score and confidence
    """
    # Combine score and confidence for severity determination
    risk_factor = abs(anomaly_score) * confidence
    
    if risk_factor >= 0.8:
        return 'critical'
    elif risk_factor >= 0.6:
        return 'high'
    elif risk_factor >= 0.4:
        return 'medium'
    else:
        return 'low'


def generate_anomaly_tags(contributing_features):
    """
    Generate tags based on contributing features
    """
    tags = []
    
    cpu_features = {'us', 'sy', 'idle'}
    memory_features = {'avm', 'fre'}
    disk_features = {'tps'}
    network_features = {'ipkts', 'opkts'}
    
    if any(feature in contributing_features for feature in cpu_features):
        tags.append('cpu')
    
    if any(feature in contributing_features for feature in memory_features):
        tags.append('memory')
    
    if any(feature in contributing_features for feature in disk_features):
        tags.append('disk')
    
    if any(feature in contributing_features for feature in network_features):
        tags.append('network')
    
    return tags


def create_performance_metric_from_training(training_job):
    """
    Create ModelPerformanceMetric from completed training job
    """
    try:
        metrics = training_job.final_metrics
        
        if not metrics:
            return
        
        # Extract metrics from training results
        ensemble_metrics = metrics.get('ensemble', {})
        
        ModelPerformanceMetric.objects.create(
            model=training_job.model,
            accuracy=ensemble_metrics.get('accuracy', 0.0),
            precision=ensemble_metrics.get('precision', 0.0),
            recall=ensemble_metrics.get('recall', 0.0),
            f1_score=ensemble_metrics.get('f1_score', 0.0),
            auc_roc=ensemble_metrics.get('auc_roc', 0.0),
            false_positive_rate=ensemble_metrics.get('false_positive_rate', 0.0),
            false_negative_rate=ensemble_metrics.get('false_negative_rate', 0.0),
            detection_latency=metrics.get('detection_latency', 0.0),
            test_data_size=metrics.get('test_data_size', 0),
            evaluation_period_start=training_job.data_range_start,
            evaluation_period_end=training_job.data_range_end,
        )
        
        logger.info(f"Performance metric created for model: {training_job.model.name}")
        
    except Exception as e:
        logger.error(f"Error creating performance metric: {e}")


# Additional utility signals

@receiver(post_delete, sender=AnomalyModel)
def anomaly_model_post_delete(sender, instance, **kwargs):
    """
    Clean up when model is deleted
    """
    logger.info(f"Anomaly model deleted: {instance.name}")
    
    # Clear all related caches
    cache_keys = [
        f'model_performance_{instance.id}',
        'available_models_list',
        'model_statistics'
    ]
    cache.delete_many(cache_keys)


@receiver(post_save, sender=ModelPerformanceMetric)
def model_performance_post_save(sender, instance, created, **kwargs):
    """
    Update model performance tracking
    """
    if created:
        # Update the model's performance metrics
        model = instance.model
        model.performance_metrics['latest_evaluation'] = {
            'f1_score': instance.f1_score,
            'accuracy': instance.accuracy,
            'precision': instance.precision,
            'recall': instance.recall,
            'auc_roc': instance.auc_roc,
            'evaluated_at': instance.evaluated_at.isoformat()
        }
        model.save(update_fields=['performance_metrics'])
        
        # Clear performance caches
        cache.delete(f'model_performance_{instance.model.id}')
        
        logger.info(f"Performance metrics updated for model: {instance.model.name}")