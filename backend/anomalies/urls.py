from django.urls import path
from .views import AnomalyDetectionView, AnomalyDetectionHistoryView, AnomalyPlotDataView

urlpatterns = [
    path('anomaly-detection/', AnomalyDetectionView.as_view(), name='anomaly-detection'),
    path('anomaly-detection/history/', AnomalyDetectionHistoryView.as_view(), name='anomaly-detection-history'),
    path('anomaly-detection/plot-data/', AnomalyPlotDataView.as_view(), name='anomaly-plot-data'),
]