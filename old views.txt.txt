# metrics/views.py
from django.utils import timezone
from django.http import JsonResponse, HttpResponse
from django.views import View
from django.utils.dateparse import parse_datetime
from datetime import timedelta
from django.db.models import (
    Avg, Max, Min, Count, DateTimeField, Func, Q, 
)
from django.db.models.functions import Trunc  # Correct import for Trunc
from django.core.paginator import Paginator
from django.db import connection
from metrics.models import VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric
import logging


logger = logging.getLogger(__name__)
    
# Map metric names to their corresponding Django models
METRIC_MODEL_MAP = {
    'vmstat': VmstatMetric,
    'iostat': IostatMetric,
    'netstat': NetstatMetric,
    'process': ProcessMetric,
}

# Configuration constants
MAX_TIME_RANGE_DAYS = 30
MAX_RAW_RECORDS = 1000000  # Limit for raw data queries
DEFAULT_PAGE_SIZE = 1000000

def get_metric_model(metric):
    """Return the model class for a given metric name."""
    return METRIC_MODEL_MAP.get(metric.lower()) if metric else None

class PostgreSQLDateBin(Func):
    """PostgreSQL-specific date_bin function for time bucketing."""
    function = 'date_bin'
    template = "%(function)s(INTERVAL '%(interval_seconds)s second', %(expressions)s, TIMESTAMP '2000-01-01')"
    output_field = DateTimeField()

    def __init__(self, expression, interval_seconds, **extra):
        super().__init__(
            expression,
            interval_seconds=int(interval_seconds),
            **extra
        )

class GenericDateTrunc(Func):
    """Fallback for databases that don't support date_bin."""
    
    @staticmethod
    def get_trunc_lookup(interval_seconds):
        """Convert seconds to Django's Trunc lookup."""
        if interval_seconds < 60:
            return 'second'
        elif interval_seconds < 3600:
            return 'minute'  
        elif interval_seconds < 86400:
            return 'hour'
        else:
            return 'day'

class RealtimeMetricsView(View):
    """API endpoint to get the last 1 minute of data for a given metric."""
    
    def get(self, request):
        metric = request.GET.get('metric')
        model = get_metric_model(metric)

        if not model:
            return JsonResponse({
                "error": "Invalid or missing metric parameter",
                "available_metrics": list(METRIC_MODEL_MAP.keys())
            }, status=400)

        now = timezone.now()
        start_time = now - timedelta(minutes=1)
        
        try:
            # Use exists() for better performance
            if not model.objects.filter(timestamp__gte=start_time).exists():
                return JsonResponse({
                    "message": f"No recent data available for metric: {metric}",
                    "start_time": start_time.isoformat(),
                    "end_time": now.isoformat()
                }, status=404)
            
            # Limit the number of records for safety
            data = model.objects.filter(
                timestamp__gte=start_time
            ).order_by('-timestamp')[:1000].values()
            
            return JsonResponse({
                "data": list(data),
                "count": len(list(data)),
                "start_time": start_time.isoformat(),
                "end_time": now.isoformat()
            }, safe=False)
            
        except Exception as e:
            logger.error(f"Database error in RealtimeMetricsView: {str(e)}", exc_info=True)
            return JsonResponse({
                "error": "Database error",
                "details": str(e)
            }, status=500)

class HistoricalMetricsView(View):
    """
    API endpoint to get historical data for a given metric within a time range.
    Supports aggregation for process metrics with dynamic time intervals.
    """

    def get(self, request):
        try:
            # Validate required parameters
            validation_result = self._validate_parameters(request)
            if validation_result:
                return validation_result
                
            metric = request.GET.get('metric')
            start_str = request.GET.get('start')
            end_str = request.GET.get('end')
            interval = request.GET.get('interval')
            pids = request.GET.get('pids')
            
            start = parse_datetime(start_str)
            end = parse_datetime(end_str)
            model = get_metric_model(metric)
            
            # Handle process metrics with aggregation
            if metric == 'process':
                return self._handle_process_data(start, end, interval, pids)
                
            # For other metrics, return raw data with pagination
            return self._handle_raw_data(model, start, end, request)

        except Exception as e:
            logger.error(f"Error in HistoricalMetricsView: {str(e)}", exc_info=True)
            return JsonResponse({
                "error": "Processing error",
                "details": str(e)
            }, status=500)
    
    def _validate_parameters(self, request):
        """Validate request parameters."""
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
        except (ValueError, TypeError):
            return JsonResponse({
                "error": "Invalid datetime format. Use ISO format (e.g., 2024-01-01T00:00:00Z)"
            }, status=400)
           
        if not start or not end:
            return JsonResponse({
                "error": "Invalid datetime format. Use ISO format (e.g., 2024-01-01T00:00:00Z)"
            }, status=400)
        
        model = get_metric_model(metric)
        if not model:
            return JsonResponse({
                "error": "Invalid metric type",
                "available_metrics": list(METRIC_MODEL_MAP.keys())
            }, status=400)

        if start > end:
            return JsonResponse({
                "error": "Start time must be before end time"
            }, status=400)
            
        # Validate time range
        time_range_days = (end - start).days
        if time_range_days > MAX_TIME_RANGE_DAYS:
            return JsonResponse({
                "error": f"Time range exceeds maximum allowed duration ({MAX_TIME_RANGE_DAYS} days)"
            }, status=400)
            
        return None  # No validation errors
    
    def _handle_raw_data(self, model, start, end, request):
        """Handle non-process metrics by returning raw data with pagination."""
        
        # Get count first to check if we need pagination
        total_count = model.objects.filter(
            timestamp__range=(start, end)
        ).count()
        
        if total_count == 0:
            return JsonResponse({
                "message": "No data available for metric in the specified time range",
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "count": 0
            }, status=404)
        
        # If too many records, suggest aggregation or use pagination
        if total_count > MAX_RAW_RECORDS:
            page = request.GET.get('page', 1)
            try:
                page = int(page)
            except (ValueError, TypeError):
                page = 1
                
            queryset = model.objects.filter(
                timestamp__range=(start, end)
            ).order_by('timestamp')
            
            paginator = Paginator(queryset, DEFAULT_PAGE_SIZE)
            page_obj = paginator.get_page(page)
            
            return JsonResponse({
                "data": list(page_obj.object_list.values()),
                "count": len(page_obj.object_list),
                "total_count": total_count,
                "page": page,
                "total_pages": paginator.num_pages,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "metric": model._meta.verbose_name,
                "warning": f"Large dataset ({total_count} records). Consider using pagination or aggregation."
            })
        
        # For smaller datasets, return all data
        data = model.objects.filter(
            timestamp__range=(start, end)
        ).order_by('timestamp').values()
        
        data_list = list(data)
        
        return JsonResponse({
            "data": data_list,
            "count": len(data_list),
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "metric": model._meta.verbose_name
        })
    
    def _handle_process_data(self, start, end, interval, pids):
        """Handle process metrics with aggregation and filtering."""
        
        # Parse and validate PID filter
        pid_list = None
        if pids:
            try:
                pid_list = [int(pid.strip()) for pid in pids.split(',') if pid.strip()]
                if not pid_list:
                    raise ValueError("Empty PID list")
            except ValueError:
                return JsonResponse({
                    "error": "Invalid PID format. Use comma-separated integers (e.g., '123,456,789')"
                }, status=400)
        
        # Determine aggregation interval
        interval_seconds = self._determine_interval(start, end, interval)
        
        # Perform aggregation
        try:
            aggregated_data = self._aggregate_process_data(
                start, end, interval_seconds, pid_list
            )
        except Exception as e:
            logger.error(f"Aggregation error: {str(e)}", exc_info=True)
            return JsonResponse({
                "error": "Data aggregation failed",
                "details": str(e)
            }, status=500)
        
        return JsonResponse({
            "data": aggregated_data,
            "count": len(aggregated_data),
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "metric": "process",
            "interval_seconds": interval_seconds,
            "pids_filtered": pid_list
        })
    
    def _determine_interval(self, start, end, requested_interval):
        """Determine optimal aggregation interval based on time range."""
        time_range_seconds = (end - start).total_seconds()
        
        # Default intervals based on time range
        if time_range_seconds <= 3600:      # 1 hour
            default_interval = 60           # 1 minute
        elif time_range_seconds <= 86400:   # 1 day
            default_interval = 300          # 5 minutes
        elif time_range_seconds <= 604800:  # 1 week
            default_interval = 1800         # 30 minutes
        elif time_range_seconds <= 2592000: # 30 days
            default_interval = 3600         # 1 hour
        else:
            default_interval = 7200         # 2 hours
        
        # Use requested interval if valid
        if requested_interval:
            try:
                interval_seconds = int(requested_interval)
                if interval_seconds <= 0:
                    raise ValueError("Interval must be positive")
                if interval_seconds > 86400:  # Max 1 day
                    raise ValueError("Interval too large")
                return interval_seconds
            except ValueError as e:
                logger.warning(f"Invalid interval requested: {requested_interval}. Error: {e}. Using default: {default_interval}")
        
        return default_interval
    
    def _aggregate_process_data(self, start, end, interval_seconds, pid_list):
        """Aggregate process data by time buckets and PIDs."""
        
        # Base queryset with optimized filtering
        queryset = ProcessMetric.objects.filter(
            timestamp__range=(start, end)
        ).select_related()  # Add if you have foreign keys
        
        # Apply PID filter if specified
        if pid_list:
            queryset = queryset.filter(pid__in=pid_list)
        
        # Check if we have any data before proceeding
        if not queryset.exists():
            return []
        
        # Determine truncation level based on interval
        if interval_seconds < 60:
            trunc_level = 'second'
        elif interval_seconds < 3600:  # Less than 1 hour
            trunc_level = 'minute'
        elif interval_seconds < 86400:  # Less than 1 day
            trunc_level = 'hour'
        else:
            trunc_level = 'day'
        
        try:
            queryset = queryset.annotate(
                time_bucket=Trunc('timestamp', trunc_level)
            )
        except Exception as e:
            logger.warning(f"Time bucketing failed: {e}")
            # Final fallback
            queryset = queryset.annotate(
                time_bucket=Trunc('timestamp', 'minute')
            )
        
        # Perform aggregation with error handling
        try:
            aggregated = queryset.values(
                'time_bucket', 'pid', 'command', 'user'
            ).annotate(
                avg_cpu=Avg('cpu'),
                max_cpu=Max('cpu'),
                min_cpu=Min('cpu'),
                avg_mem=Avg('mem'),
                max_mem=Max('mem'),
                min_mem=Min('mem'),
                record_count=Count('id')
            ).order_by('time_bucket', 'pid')
            
            # Convert to list with better error handling
            result = []
            for item in aggregated:
                try:
                    result.append({
                        "timestamp": item['time_bucket'].isoformat() if item['time_bucket'] else None,
                        "pid": item['pid'],
                        "command": item['command'] or 'unknown',
                        "user": item['user'] or 'unknown',
                        "avg_cpu": round(float(item['avg_cpu'] or 0), 2),
                        "max_cpu": round(float(item['max_cpu'] or 0), 2),
                        "min_cpu": round(float(item['min_cpu'] or 0), 2),
                        "avg_mem": round(float(item['avg_mem'] or 0), 2),
                        "max_mem": round(float(item['max_mem'] or 0), 2),
                        "min_mem": round(float(item['min_mem'] or 0), 2),
                        "count": item['record_count']
                    })
                except (TypeError, ValueError) as e:
                    logger.warning(f"Error processing aggregated item: {e}, item: {item}")
                    continue
                    
            return result
            
        except Exception as e:
            logger.error(f"Aggregation query failed: {e}")
            raise
    
    def _is_postgresql(self):
        """Check if we're using PostgreSQL."""
        return connection.vendor == 'postgresql'

# Debug view for routing tests
def debug_view(request):
    """Debug endpoint to test URL routing."""
    return HttpResponse("Debug view is working! Your Django URL routing is correct.")

# Health check view
def health_check(request):
    """Simple health check endpoint."""
    try:
        # Test database connection
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            
        return JsonResponse({
            "status": "healthy",
            "timestamp": timezone.now().isoformat(),
            "database": "connected"
        })
    except Exception as e:
        return JsonResponse({
            "status": "unhealthy",
            "error": str(e),
            "timestamp": timezone.now().isoformat()
        }, status=500)