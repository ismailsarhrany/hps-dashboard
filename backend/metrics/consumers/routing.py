# # metrics/consumers/routing.py

# from django.urls import re_path
# from . import consumers

# websocket_urlpatterns = [
#     # Specific metric WebSocket URLs
#     re_path(r'ws/metrics/vmstat/$', consumers.VmstatConsumer.as_asgi()),
#     re_path(r'ws/metrics/iostat/$', consumers.IostatConsumer.as_asgi()),
#     re_path(r'ws/metrics/netstat/$', consumers.NetstatConsumer.as_asgi()),
#     re_path(r'ws/metrics/process/$', consumers.ProcessConsumer.as_asgi()),
    
#     # General metrics URL (for backwards compatibility)

#     re_path(r'ws/metrics/$', consumers.MetricConsumer.as_asgi()),
# ]

# metrics/consumers/routing.py
# metrics/consumers/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # Server-specific metric WebSocket URLs
    re_path(r'ws/metrics/vmstat/(?P<server_id>[^/]+)/$', consumers.VmstatConsumer.as_asgi()),
    re_path(r'ws/metrics/iostat/(?P<server_id>[^/]+)/$', consumers.IostatConsumer.as_asgi()),
    re_path(r'ws/metrics/netstat/(?P<server_id>[^/]+)/$', consumers.NetstatConsumer.as_asgi()),
    re_path(r'ws/metrics/process/(?P<server_id>[^/]+)/$', consumers.ProcessConsumer.as_asgi()),
    
    # General metrics URL
    re_path(r'ws/metrics/(?P<server_id>[^/]+)/$', consumers.MetricConsumer.as_asgi()),
    
    # Oracle data WebSocket - FIXED: Use proper parameter name
    re_path(r'ws/oracle_updates/(?P<server_id>[^/]+)/$', consumers.OracleDataConsumer.as_asgi()),
]