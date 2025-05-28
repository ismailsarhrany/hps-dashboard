# metrics/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # Specific metric WebSocket URLs
    re_path(r'ws/metrics/vmstat/$', consumers.VmstatConsumer.as_asgi()),
    re_path(r'ws/metrics/iostat/$', consumers.IostatConsumer.as_asgi()),
    re_path(r'ws/metrics/netstat/$', consumers.NetstatConsumer.as_asgi()),
    re_path(r'ws/metrics/process/$', consumers.ProcessConsumer.as_asgi()),
    
    # General metrics URL (for backwards compatibility)
    re_path(r'ws/metrics/$', consumers.MetricConsumer.as_asgi()),
]