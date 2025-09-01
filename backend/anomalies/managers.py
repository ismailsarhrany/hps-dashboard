from django.db import models
from django.utils import timezone
from datetime import timedelta
from django.db.models import Q, Count, Avg, Max, Min


class AnomalyModelQuerySet(models.QuerySet):
    """Custom queryset for AnomalyModel"""
    
    def ready(self):
        """Get models that are ready for use"""
        return self.filter(status='ready')
    
    def active(self):
        """Get models that have been used recently (within 7 days)"""
        week_ago = timezone.now() - timedelta(days=7)
        return self.filter(
            status='ready',
            last_used__gte=week_ago
        )
    
    def by_performance(self, min_f1_score=0.7):
        """Get models with minimum F1 score performance"""
        return self.filter(
            performance_metrics__ensemble__f1_score__gte=min_f1_score
        )
    
    def ensemble_models(self):
        """Get ensemble models only"""
        return self.filter(model_type='ensemble')


class AnomalyModelManager(models.Manager):
    """Custom manager for AnomalyModel"""
    
    def get_queryset(self):
        return AnomalyModelQuerySet(self.model, using=self._db)
    
    def ready(self):
        return self.get_queryset().ready()
    
    def active(self):
        return self.get_queryset().active()
    
    def best_performing(self, limit=5):
        """Get best performing models based on F1 score"""
        return self.get_queryset().ready().order_by(
            '-performance_metrics__ensemble__f1_score'
        )[:limit]


class AnomalyDetectionQuerySet(models.QuerySet):
    """Custom queryset for AnomalyDetection"""
    
    def unresolved(self):
        """Get unresolved anomalies"""
        return self.exclude(status__in=['resolved', 'false_positive'])
    
    def critical(self):
        """Get critical severity anomalies"""
        return self.filter(severity='critical')
    
    def recent(self, hours=24):
        """Get anomalies from last N hours"""
        cutoff = timezone.now() - timedelta(hours=hours)
        return self.filter(timestamp__gte=cutoff)
    
    def for_server(self, server_id):
        """Get anomalies for specific server"""
        return self.filter(server_id=server_id)
    
    def by_model_type(self, model_type):
        """Get anomalies detected by specific model type"""
        return self.filter(model__model_type=model_type)
    
    def high_confidence(self, min_confidence=0.8):
        """Get high confidence anomalies"""
        return self.filter(confidence__gte=min_confidence)


class AnomalyDetectionManager(models.Manager):
    """Custom manager for AnomalyDetection"""
    
    def get_queryset(self):
        return AnomalyDetectionQuerySet(self.model, using=self._db)
    
    def unresolved(self):
        return self.get_queryset().unresolved()
    
    def critical(self):
        return self.get_queryset().critical()
    
    def recent(self, hours=24):
        return self.get_queryset().recent(hours)
    
    def dashboard_summary(self, server_id=None):
        """Get summary stats for dashboard"""
        qs = self.get_queryset()
        if server_id:
            qs = qs.filter(server_id=server_id)
        
        last_24h = timezone.now() - timedelta(hours=24)
        
        return {
            'total_today': qs.filter(timestamp__gte=last_24h).count(),
            'unresolved': qs.unresolved().count(),
            'critical_today': qs.filter(
                timestamp__gte=last_24h,
                severity='critical'
            ).count(),
            'avg_score_today': qs.filter(
                timestamp__gte=last_24h
            ).aggregate(avg_score=Avg('anomaly_score'))['avg_score'] or 0,
        }


class AnomalyPredictionQuerySet(models.QuerySet):
    """Custom queryset for AnomalyPrediction"""
    
    def active(self):
        """Get predictions for future events (not past)"""
        return self.filter(predicted_timestamp__gt=timezone.now())
    
    def imminent(self, hours=6):
        """Get predictions for events happening soon"""
        cutoff = timezone.now() + timedelta(hours=hours)
        return self.filter(
            predicted_timestamp__lte=cutoff,
            predicted_timestamp__gt=timezone.now()
        )
    
    def high_probability(self, min_prob=0.7):
        """Get high probability predictions"""
        return self.filter(probability__gte=min_prob)
    
    def unvalidated(self):
        """Get predictions that haven't been validated yet"""
        return self.filter(is_validated=False)
    
    def validated_accurate(self):
        """Get validated predictions that were accurate"""
        return self.filter(is_validated=True, actual_occurred=True)


class AnomalyPredictionManager(models.Manager):
    """Custom manager for AnomalyPrediction"""
    
    def get_queryset(self):
        return AnomalyPredictionQuerySet(self.model, using=self._db)
    
    def active(self):
        return self.get_queryset().active()
    
    def imminent(self, hours=6):
        return self.get_queryset().imminent(hours)
    
    def accuracy_stats(self, days=30):
        """Calculate prediction accuracy over last N days"""
        cutoff = timezone.now() - timedelta(days=days)
        validated = self.filter(
            is_validated=True,
            validation_date__gte=cutoff
        )
        
        total = validated.count()
        if total == 0:
            return {'accuracy': 0, 'total_validated': 0}
        
        accurate = validated.filter(actual_occurred=True).count()
        
        return {
            'accuracy': round(accurate / total * 100, 2),
            'total_validated': total,
            'accurate_predictions': accurate,
            'false_predictions': total - accurate
        }


class TrainingJobQuerySet(models.QuerySet):
    """Custom queryset for TrainingJob"""
    
    def running(self):
        """Get currently running jobs"""
        return self.filter(status='running')
    
    def completed(self):
        """Get completed jobs"""
        return self.filter(status='completed')
    
    def failed(self):
        """Get failed jobs"""
        return self.filter(status='failed')
    
    def recent(self, days=7):
        """Get jobs from last N days"""
        cutoff = timezone.now() - timedelta(days=days)
        return self.filter(created_at__gte=cutoff)


class TrainingJobManager(models.Manager):
    """Custom manager for TrainingJob"""
    
    def get_queryset(self):
        return TrainingJobQuerySet(self.model, using=self._db)
    
    def running(self):
        return self.get_queryset().running()
    
    def queue_status(self):
        """Get training queue status"""
        return {
            'queued': self.filter(status='queued').count(),
            'running': self.filter(status='running').count(),
            'completed_today': self.filter(
                status='completed',
                completed_at__gte=timezone.now().date()
            ).count(),
            'failed_today': self.filter(
                status='failed',
                completed_at__gte=timezone.now().date()
            ).count()
        }


class CorrelationAnalysisQuerySet(models.QuerySet):
    """Custom queryset for CorrelationAnalysis"""
    
    def recent(self, days=30):
        """Get recent analyses"""
        cutoff = timezone.now() - timedelta(days=days)
        return self.filter(created_at__gte=cutoff)
    
    def high_confidence(self, min_confidence=0.8):
        """Get high confidence analyses"""
        return self.filter(analysis_confidence__gte=min_confidence)
    
    def for_server(self, server_id):
        """Get analyses for specific server"""
        return self.filter(server_id=server_id)


class CorrelationAnalysisManager(models.Manager):
    """Custom manager for CorrelationAnalysis"""
    
    def get_queryset(self):
        return CorrelationAnalysisQuerySet(self.model, using=self._db)
    
    def recent(self, days=30):
        return self.get_queryset().recent(days)
    
    def latest_for_server(self, server_id):
        """Get most recent analysis for a server"""
        return self.filter(server_id=server_id).order_by('-created_at').first()


class ModelPerformanceMetricQuerySet(models.QuerySet):
    """Custom queryset for ModelPerformanceMetric"""
    
    def for_model(self, model_id):
        """Get metrics for specific model"""
        return self.filter(model_id=model_id)
    
    def recent(self, days=30):
        """Get recent performance evaluations"""
        cutoff = timezone.now() - timedelta(days=days)
        return self.filter(evaluated_at__gte=cutoff)
    
    def best_performing(self, metric='f1_score'):
        """Get best performing models by metric"""
        return self.order_by(f'-{metric}')


class ModelPerformanceMetricManager(models.Manager):
    """Custom manager for ModelPerformanceMetric"""
    
    def get_queryset(self):
        return ModelPerformanceMetricQuerySet(self.model, using=self._db)
    
    def performance_trend(self, model_id, days=30):
        """Get performance trend for a model"""
        cutoff = timezone.now() - timedelta(days=days)
        metrics = self.filter(
            model_id=model_id,
            evaluated_at__gte=cutoff
        ).order_by('evaluated_at')
        
        if metrics.count() < 2:
            return {'trend': 'insufficient_data'}
        
        latest = metrics.last()
        earliest = metrics.first()
        
        f1_change = latest.f1_score - earliest.f1_score
        
        return {
            'trend': 'improving' if f1_change > 0.05 else 'declining' if f1_change < -0.05 else 'stable',
            'f1_change': round(f1_change, 3),
            'current_f1': latest.f1_score,
            'evaluations_count': metrics.count()
        }