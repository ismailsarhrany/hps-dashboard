# metrics/views.py

from django.utils import timezone
from django.http import JsonResponse, HttpResponse
from django.views import View
from django.utils.dateparse import parse_datetime
from datetime import timedelta
from metrics.models import VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric

# Simple debug view to test routing
def debug_view(request):
    return HttpResponse("Debug view is working! Your Django URL routing is correct.")

# Map metric names to their corresponding Django models
metric_model_map = {
    'vmstat': VmstatMetric,
    'iostat': IostatMetric,
    'netstat': NetstatMetric,
    'process': ProcessMetric,
}

def get_metric_model(metric):
    """Return the model class for a given metric name."""
    return metric_model_map.get(metric.lower()) if metric else None


class RealtimeMetricsView(View):
    """
    API endpoint to get the last 15 minutes of data for a given metric.
    Example: /api/metrics/realtime/?metric=vmstat
    """
    def get(self, request):
        # First, print some debug information
        print(f"RealtimeMetricsView called with GET parameters: {request.GET}")
        
        # Temporary simplified response to test if the view is being reached
        if not request.GET.get('metric'):
            return JsonResponse({
                "status": "working", 
                "message": "RealtimeMetricsView is working! Add a metric parameter to get data."
            })
            
        metric = request.GET.get('metric')
        model = get_metric_model(metric)

        if not model:
            return JsonResponse({
                "error": "Invalid or missing metric parameter",
                "available_metrics": list(metric_model_map.keys())
            }, status=400)

        now = timezone.now()
        start_time = now - timedelta(minutes=15)
        
        try:
            data = model.objects.filter(timestamp__gte=start_time).values()
            
            if not data.exists():
                return JsonResponse({
                    "message": "No recent data available for metric: " + metric,
                    "start_time": start_time.isoformat(),
                    "end_time": now.isoformat()
                }, status=404)
                
            return JsonResponse(list(data), safe=False)
            
        except Exception as e:
            return JsonResponse({
                "error": "Database error",
                "details": str(e)
            }, status=500)


class HistoricalMetricsView(View):
    """
    API endpoint to get metrics data between a user-defined start and end time.
    Example: /api/metrics/historical/?metric=vmstat&start=2025-05-12T10:00:00&end=2025-05-12T10:30:00
    """
    def get(self, request):
        # First, print some debug information
        print(f"HistoricalMetricsView called with GET parameters: {request.GET}")
        
        # Check for required parameters
        metric = request.GET.get('metric')
        start_str = request.GET.get('start')
        end_str = request.GET.get('end')
        
        if not all([metric, start_str, end_str]):
            return JsonResponse({
                "error": "Missing required parameters",
                "required": ["metric", "start", "end"],
                "received": {
                    "metric": metric,
                    "start": start_str,
                    "end": end_str
                }
            }, status=400)
            
        # Parse dates
        try:
            start = parse_datetime(start_str)
            end = parse_datetime(end_str)
        except Exception as e:
            return JsonResponse({
                "error": "Invalid date format",
                "message": "Dates should be in ISO format (YYYY-MM-DDTHH:MM:SS)",
                "details": str(e)
            }, status=400)
            
        # Get model
        model = get_metric_model(metric)
        if not model:
            return JsonResponse({
                "error": "Invalid metric type",
                "available_metrics": list(metric_model_map.keys())
            }, status=400)

        # Validate date range
        if start > end:
            return JsonResponse({
                "error": "Start time must be before end time"
            }, status=400)

        # Get data
        try:
            data = model.objects.filter(timestamp__range=(start, end)).values()
            
            if not data.exists():
                return JsonResponse({
                    "message": "No data available for the specified time range",
                    "start": start.isoformat(),
                    "end": end.isoformat()
                }, status=404)
                
            return JsonResponse(list(data), safe=False)
            
        except Exception as e:
            return JsonResponse({
                "error": "Database error",
                "details": str(e)
            }, status=500)