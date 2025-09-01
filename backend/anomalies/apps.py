from django.apps import AppConfig


class AnomaliesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'anomalies'
    verbose_name = 'Anomaly Detection & Prediction'

    def ready(self):
        """Import signals when app is ready"""
        import anomalies.signals
 