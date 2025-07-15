from django.urls import path, re_path
from .views import (
    RealtimeMetricsView,
    HistoricalMetricsView,
    debug_view,
    health_check,
    ServerListView,
    ServerCreateView,
    ServerDetailView,
    ServerTestConnectionView,
    ServerBulkStatusView
)

urlpatterns = [
    # Metrics endpoints
    path('api/metrics/realtime/', RealtimeMetricsView.as_view(), name='realtime-metrics'),
    path('api/metrics/historical/', HistoricalMetricsView.as_view(), name='historical-metrics'),
    
    # Server management endpoints
    path('api/servers/', ServerListView.as_view(), name='server-list'),
    path('api/servers/create/', ServerCreateView.as_view(), name='server-create'),
    path('api/servers/<uuid:server_id>/', ServerDetailView.as_view(), name='server-detail'),
    path('api/servers/<uuid:server_id>/test-connection/', ServerTestConnectionView.as_view(), name='server-test-connection'),
    path('api/servers/bulk-status/', ServerBulkStatusView.as_view(), name='server-bulk-status'),
    
    # Health and debug endpoints
    path('health/', health_check, name='health-check'),
    path('debug/', debug_view, name='debug'),
    
    # Fallback URLs without trailing slashessup
    re_path(r'^api/metrics/realtime$', RealtimeMetricsView.as_view()),
    re_path(r'^api/metrics/historical$', HistoricalMetricsView.as_view()),
    re_path(r'^api/servers$', ServerListView.as_view()),
    re_path(r'^api/servers/create$', ServerCreateView.as_view()),
    re_path(r'^api/servers/(?P<server_id>[^/]+)$', ServerDetailView.as_view()),
    re_path(r'^api/servers/(?P<server_id>[^/]+)/test-connection$', ServerTestConnectionView.as_view()),
    re_path(r'^api/servers/bulk-status$', ServerBulkStatusView.as_view()),
    re_path(r'^health$', health_check),
]