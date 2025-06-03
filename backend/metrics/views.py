# metrics/views.py
from django.utils import timezone
from django.http import JsonResponse, HttpResponse
from django.views import View
from django.utils.dateparse import parse_datetime
from datetime import timedelta
from django.db.models import Avg, Max, Min
from django.db.models.functions import Trunc
from metrics.models import VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric

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
    API endpoint to get the last 1 minutes of data for a given metric.

    """
    def get(self, request):
        metric = request.GET.get('metric')
        model = get_metric_model(metric)

        if not model:
            return JsonResponse({
                "error": "Invalid or missing metric parameter",
                "available_metrics": list(metric_model_map.keys())
            }, status=400)

        now = timezone.now()
        start_time = now - timedelta(minutes=1)
        
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
    API endpoint to get historical data for a given metric within a time range.
    Returns raw data without any aggregation.
    """

    def get(self, request):
        metric = request.GET.get('metric')
        start_str = request.GET.get('start')
        end_str = request.GET.get('end')
        
        if not all([metric, start_str, end_str]):
            return JsonResponse({
                "error": "Missing required parameters",
                "required": ["metric", "start", "end"]
            }, status=400)
            
        try:
            start = parse_datetime(start_str)
            end = parse_datetime(end_str)
           
            if not start or not end:
                return JsonResponse({
                    "error": "Invalid datetime format. Use ISO format (e.g., 2024-01-01T00:00:00Z)"
                }, status=400)
            
            model = get_metric_model(metric)
            
            if not model:
                return JsonResponse({
                    "error": "Invalid metric type",
                    "available_metrics": list(metric_model_map.keys())
                }, status=400)

            if start > end:
                return JsonResponse({
                    "error": "Start time must be before end time"
                }, status=400)

            # Get raw data without any aggregation
            data = model.objects.filter(
                timestamp__range=(start, end)
            ).order_by('timestamp').values()
            
            if not data.exists():
                return JsonResponse({
                    "message": f"No data available for metric '{metric}' in the specified time range",
                    "start_time": start.isoformat(),
                    "end_time": end.isoformat(),
                    "count": 0
                }, status=404)
            
            return JsonResponse({
                "data": list(data),
                "count": len(data),
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "metric": metric
            }, safe=False)

            
        except Exception as e:
            return JsonResponse({
                "error": "Processing error",
                "details": str(e)
            }, status=500)


# Optional: Keep this class if you want to add aggregation functionality later
# but with a separate endpoint
class TimeAggregator:
    @staticmethod
    def get_aggregation(model, start, end):
        range_seconds = (end - start).total_seconds()
        
        if range_seconds <= 7200:  # 2 hours
            return model.objects.filter(timestamp__range=(start, end))
        elif range_seconds <= 86400:  # 24 hours
            return model.objects.filter(timestamp__range=(start, end)) \
                       .annotate(time_bucket=Trunc('timestamp', 'minute')) \
                       .values('time_bucket') \
                       .annotate(
                           avg_cpu=Avg('us') + Avg('sy'),
                           max_mem=Max('avm')
                       )
        else:  # >24 hours
            return model.objects.filter(timestamp__range=(start, end)) \
                       .annotate(time_bucket=Trunc('timestamp', 'hour')) \
                       .values('time_bucket') \
                       .annotate(
                           avg_cpu=Avg('us') + Avg('sy'),
                           max_mem=Max('avm')
                       )

# Keep the debug view for routing tests
def debug_view(request):
    return HttpResponse("Debug view is working! Your Django URL routing is correct.")