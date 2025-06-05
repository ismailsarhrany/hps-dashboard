from django.db import models

class AnomalyDetectionResult(models.Model):
    timestamp = models.DateTimeField()
    is_anomaly = models.BooleanField()
    anomaly_score = models.FloatField()
    metric_values = models.JSONField()  # Stores all metric values
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Uncomment and modify this if you have a Server model
    # server = models.ForeignKey('monitoring.Server', on_delete=models.CASCADE, null=True, blank=True)

    class Meta:
        db_table = "anomaly_detection"
        indexes = [
            models.Index(fields=['timestamp']),
            models.Index(fields=['is_anomaly']),
            models.Index(fields=['created_at']),
        ]
        ordering = ['-timestamp']

    def __str__(self):
        return f"Anomaly Detection {self.timestamp} - {'Anomaly' if self.is_anomaly else 'Normal'}"