from django.urls import path
from .views import AnomalyDetectionView

urlpatterns = [
    path('anomaly-detection/', AnomalyDetectionView.as_view(), name='anomaly-detection'),
]
