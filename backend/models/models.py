from django.db import models

class AnomalyDetectionResult(models.Model):
    timestamp = models.DateTimeField()
    is_anomaly = models.BooleanField()
    anomaly_score = models.FloatField()
    metric_values = models.JSONField()  # Stores all metric values
    # server = models.ForeignKey('monitoring.Server', on_delete=models.CASCADE)

    class Meta:
        db_table = "anomaly_detection"
        indexes = [
            models.Index(fields=['timestamp']),
            models.Index(fields=['is_anomaly']),
        ]