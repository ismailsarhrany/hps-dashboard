from django.urls import path, re_path
from .views import RealtimeMetricsView, HistoricalMetricsView, debug_view

urlpatterns = [
    # Original paths
    path('api/metrics/realtime/', RealtimeMetricsView.as_view(), name='realtime-metrics'),
    path('api/metrics/historical/', HistoricalMetricsView.as_view(), name='historical-metrics'),
    
    # Debug path
    path('debug/', debug_view, name='debug'),
    
    # Paths without trailing slashes (Django usually redirects, but this is a fallback)
    re_path(r'^api/metrics/realtime$', RealtimeMetricsView.as_view(), name='realtime-metrics-no-slash'),
    re_path(r'^api/metrics/historical$', HistoricalMetricsView.as_view(), name='historical-metrics-no-slash'),
]