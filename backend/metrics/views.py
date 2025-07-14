# metrics/views.py
from django.utils import timezone
from django.http import JsonResponse, HttpResponse
from django.views import View
from django.utils.dateparse import parse_datetime
from datetime import timedelta
from django.db.models import (
    Avg, Max, Min, Count, DateTimeField, Func, Q, 
)
from django.db.models.functions import Trunc
from django.core.paginator import Paginator
from django.db import connection
from django.core.exceptions import ObjectDoesNotExist
from metrics.models import VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric, Server
from metrics.utils.ssh_client import get_ssh_client, get_all_ssh_clients, ssh_health_check
import logging
import json

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
        server_id = request.GET.get('server_id')
        hostname = request.GET.get('hostname')
        
        model = get_metric_model(metric)
        if not model:
            return JsonResponse({
                "error": "Invalid or missing metric parameter",
                "available_metrics": list(METRIC_MODEL_MAP.keys())
            }, status=400)

        now = timezone.now()
        start_time = now - timedelta(minutes=1)
        
        try:
            # Build query filter
            query_filter = Q(timestamp__gte=start_time)
            
            # Add server filter if specified
            if server_id:
                query_filter &= Q(server_id=server_id)
            elif hostname:
                try:
                    server = Server.objects.get(hostname=hostname)
                    query_filter &= Q(server_id=server.id)
                except ObjectDoesNotExist:
                    return JsonResponse({
                        "error": f"Server with hostname '{hostname}' not found"
                    }, status=404)
            
            # Check if data exists
            if not model.objects.filter(query_filter).exists():
                return JsonResponse({
                    "message": f"No recent data available for metric: {metric}",
                    "start_time": start_time.isoformat(),
                    "end_time": now.isoformat(),
                    "server_id": server_id,
                    "hostname": hostname
                }, status=404)
            
            # Get the data
            data = model.objects.filter(query_filter).order_by('-timestamp')[:1000]
            
            # Include server information in response
            result_data = []
            for item in data.values():
                if hasattr(model, 'server') and item.get('server_id'):
                    try:
                        server = Server.objects.get(id=item['server_id'])
                        item['server_hostname'] = server.hostname
                        item['server_alias'] = server.alias
                    except ObjectDoesNotExist:
                        item['server_hostname'] = 'Unknown'
                        item['server_alias'] = None
                result_data.append(item)
            
            return JsonResponse({
                "data": result_data,
                "count": len(result_data),
                "start_time": start_time.isoformat(),
                "end_time": now.isoformat(),
                "server_id": server_id,
                "hostname": hostname
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
    Supports server filtering and aggregation for process metrics.
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
            server_id = request.GET.get('server_id')
            hostname = request.GET.get('hostname')
            
            start = parse_datetime(start_str)
            end = parse_datetime(end_str)
            model = get_metric_model(metric)
            
            # Build server filter
            server_filter = self._build_server_filter(server_id, hostname)
            if isinstance(server_filter, JsonResponse):
                return server_filter
            
            # Handle process metrics with aggregation
            if metric == 'process':
                return self._handle_process_data(start, end, interval, pids, server_filter)
                
            # For other metrics, return raw data with pagination
            return self._handle_raw_data(model, start, end, request, server_filter)

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
    
    def _build_server_filter(self, server_id, hostname):
        """Build server filter for queries."""
        if server_id:
            try:
                server = Server.objects.get(id=server_id)
                return Q(server_id=server_id)
            except ObjectDoesNotExist:
                return JsonResponse({
                    "error": f"Server with ID '{server_id}' not found"
                }, status=404)
        elif hostname:
            try:
                server = Server.objects.get(hostname=hostname)
                return Q(server_id=server.id)
            except ObjectDoesNotExist:
                return JsonResponse({
                    "error": f"Server with hostname '{hostname}' not found"
                }, status=404)
        else:
            return Q()  # No server filter
    

    def _handle_raw_data(self, model, start, end, request, server_filter):
        """Handle non-process metrics by returning raw data with pagination."""
        
        # Build query filter
        query_filter = Q(timestamp__range=(start, end)) & server_filter
        
        # Get count first to check if we need pagination
        total_count = model.objects.filter(query_filter).count()
        
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
                
            queryset = model.objects.filter(query_filter).order_by('timestamp')
            paginator = Paginator(queryset, DEFAULT_PAGE_SIZE)
            page_obj = paginator.get_page(page)
            
            # Add server information
            result_data = []
            for item in page_obj.object_list.values():
                if hasattr(model, 'server') and item.get('server_id'):
                    try:
                        server = Server.objects.get(id=item['server_id'])
                        item['server_hostname'] = server.hostname
                        item['server_alias'] = server.alias
                    except ObjectDoesNotExist:
                        item['server_hostname'] = 'Unknown'
                        item['server_alias'] = None
                result_data.append(item)
            
            return JsonResponse({
                "data": result_data,
                "count": len(result_data),
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
            query_filter
        ).order_by('timestamp').values()
        
        # Add server information
        result_data = []
        for item in data:
            if hasattr(model, 'server') and item.get('server_id'):
                try:
                    server = Server.objects.get(id=item['server_id'])
                    item['server_hostname'] = server.hostname
                    item['server_alias'] = server.alias
                except ObjectDoesNotExist:
                    item['server_hostname'] = 'Unknown'
                    item['server_alias'] = None
            result_data.append(item)
        
        return JsonResponse({
            "data": result_data,
            "count": len(result_data),
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "metric": model._meta.verbose_name
        })
    
    def _handle_process_data(self, start, end, interval, pids, server_filter):
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
                start, end, interval_seconds, pid_list, server_filter
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
    
    def _aggregate_process_data(self, start, end, interval_seconds, pid_list, server_filter):
        """Aggregate process data by time buckets and PIDs with server filtering."""
        
        # Base queryset with optimized filtering
        queryset = ProcessMetric.objects.filter(
            timestamp__range=(start, end)
        ).filter(server_filter)  # Apply server filter
        
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
                'time_bucket', 'pid', 'command', 'user', 'server'
            ).annotate(
                avg_cpu=Avg('cpu'),
                max_cpu=Max('cpu'),
                min_cpu=Min('cpu'),
                avg_mem=Avg('mem'),
                max_mem=Max('mem'),
                min_mem=Min('mem'),
                record_count=Count('id')
            ).order_by('time_bucket', 'pid')
            
            # Convert to list with server information
            result = []
            for item in aggregated:
                try:
                    # Add server information
                    server_info = {}
                    if item['server']:
                        try:
                            server = Server.objects.get(id=item['server'])
                            server_info = {
                                "server_id": str(server.id),
                                "hostname": server.hostname,
                                "alias": server.alias
                            }
                        except ObjectDoesNotExist:
                            server_info = {
                                "server_id": None,
                                "hostname": "Unknown",
                                "alias": None
                            }
                    
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
                        "count": item['record_count'],
                        "server": server_info
                    })
                except (TypeError, ValueError) as e:
                    logger.warning(f"Error processing aggregated item: {e}, item: {item}")
                    continue
                    
            return result
            
        except Exception as e:
            logger.error(f"Aggregation query failed: {e}")
            raise

# class ServerListView(View):
#     def get(self, request):
#         servers = Server.objects.all().values('id', 'hostname', 'alias', 'status', 'monitoring_enabled', 'last_seen')
#         return JsonResponse({
#             "servers": list(servers),
#             "count": servers.count()
#         })
    
# Add to metrics/views.py
from django.views.generic import View
from django.forms.models import model_to_dict
from django.core.exceptions import ValidationError
import json

class ServerCreateView(View):
    """Create a new server instance"""
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            server = Server.objects.create(
                hostname=data['hostname'],
                ip_address=data['ip_address'],
                os_type=data.get('os_type', 'linux'),
                ssh_port=data.get('ssh_port', 22),
                ssh_username=data['ssh_username'],
                # Optional fields
                alias=data.get('alias'),
                os_version=data.get('os_version'),
                architecture=data.get('architecture'),
                ssh_key_path=data.get('ssh_key_path'),
                ssh_password=data.get('ssh_password'),
                status=data.get('status', 'active'),
                monitoring_enabled=data.get('monitoring_enabled', True),
                monitoring_interval=data.get('monitoring_interval', 60),
                description=data.get('description'),
                location=data.get('location'),
                environment=data.get('environment'),
            )
            return JsonResponse({
                "status": "created",
                "server": model_to_dict(server)
            }, status=201)
        except KeyError as e:
            return JsonResponse({
                "error": f"Missing required field: {str(e)}",
                "required_fields": ['hostname', 'ip_address', 'ssh_username']
            }, status=400)
        except ValidationError as e:
            return JsonResponse({
                "error": "Validation error",
                "details": e.message_dict
            }, status=400)
        except Exception as e:
            logger.error(f"Server creation failed: {str(e)}")
            return JsonResponse({
                "error": "Server creation failed",
                "details": str(e)
            }, status=500)

class ServerDetailView(View):
    """Retrieve, update or delete a server instance"""
    
    def get(self, request, server_id):
        try:
            server = Server.objects.get(id=server_id)
            return JsonResponse(model_to_dict(server))
        except ObjectDoesNotExist:
            return JsonResponse({
                "error": f"Server with ID '{server_id}' not found"
            }, status=404)
        except Exception as e:
            return JsonResponse({
                "error": "Error retrieving server",
                "details": str(e)
            }, status=500)
    
    def put(self, request, server_id):
        try:
            server = Server.objects.get(id=server_id)
            data = json.loads(request.body)
            
            # Update fields
            for field in ['hostname', 'ip_address', 'os_type', 'ssh_port', 
                         'ssh_username', 'alias', 'os_version', 'architecture',
                         'ssh_key_path', 'ssh_password', 'status', 
                         'monitoring_enabled', 'monitoring_interval',
                         'description', 'location', 'environment']:
                if field in data:
                    setattr(server, field, data[field])
            
            server.save()
            return JsonResponse({
                "status": "updated",
                "server": model_to_dict(server)
            })
        except ObjectDoesNotExist:
            return JsonResponse({
                "error": f"Server with ID '{server_id}' not found"
            }, status=404)
        except ValidationError as e:
            return JsonResponse({
                "error": "Validation error",
                "details": e.message_dict
            }, status=400)
        except Exception as e:
            logger.error(f"Server update failed: {str(e)}")
            return JsonResponse({
                "error": "Server update failed",
                "details": str(e)
            }, status=500)
    
    def delete(self, request, server_id):
        try:
            server = Server.objects.get(id=server_id)
            server.delete()
            return JsonResponse({
                "status": "deleted",
                "server_id": server_id
            }, status=204)
        except ObjectDoesNotExist:
            return JsonResponse({
                "error": f"Server with ID '{server_id}' not found"
            }, status=404)
        except Exception as e:
            logger.error(f"Server deletion failed: {str(e)}")
            return JsonResponse({
                "error": "Server deletion failed",
                "details": str(e)
            }, status=500)

class ServerListView(View):
    """List all servers or create a new server"""
    
    def get(self, request):
        try:
            # Get query parameters
            status = request.GET.get('status')
            monitoring = request.GET.get('monitoring_enabled')
            environment = request.GET.get('environment')
            
            # Build filters
            filters = {}
            if status:
                filters['status'] = status
            if monitoring:
                filters['monitoring_enabled'] = monitoring.lower() == 'true'
            if environment:
                filters['environment'] = environment
                
            servers = Server.objects.filter(**filters).order_by('hostname')
            
            # Pagination
            page = request.GET.get('page', 1)
            per_page = request.GET.get('per_page', 25)
            
            try:
                per_page = min(int(per_page), 100)  # Max 100 per page
            except ValueError:
                per_page = 25
                
            paginator = Paginator(servers, per_page)
            page_obj = paginator.get_page(page)
            
            # Prepare response
            server_list = [model_to_dict(server) for server in page_obj]
            
            return JsonResponse({
                "count": paginator.count,
                "page": page_obj.number,
                "total_pages": paginator.num_pages,
                "servers": server_list
            })
        except Exception as e:
            logger.error(f"Server list error: {str(e)}")
            return JsonResponse({
                "error": "Error listing servers",
                "details": str(e)
            }, status=500)

class ServerTestConnectionView(View):
    """Test SSH connection to a server"""
    
    def post(self, request, server_id):
        try:
            server = Server.objects.get(id=server_id)
            ssh_client = get_ssh_client(server_id)
            
            if not ssh_client:
                return JsonResponse({
                    "status": "error",
                    "message": "SSH client not available"
                }, status=400)
                
            # Try to execute a simple command
            try:
                output = ssh_client.execute("echo 'Connection test successful'")
                return JsonResponse({
                    "status": "success",
                    "server_id": server_id,
                    "hostname": server.hostname,
                    "output": output
                })
            except Exception as e:
                return JsonResponse({
                    "status": "error",
                    "server_id": server_id,
                    "hostname": server.hostname,
                    "error": str(e)
                }, status=400)
                
        except ObjectDoesNotExist:
            return JsonResponse({
                "error": f"Server with ID '{server_id}' not found"
            }, status=404)
        except Exception as e:
            return JsonResponse({
                "error": "Connection test failed",
                "details": str(e)
            }, status=500)

class ServerBulkStatusView(View):
    """Bulk update server statuses"""
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            server_ids = data.get('server_ids', [])
            new_status = data.get('status')
            
            if not server_ids:
                return JsonResponse({
                    "error": "No server IDs provided"
                }, status=400)
                
            if not new_status or new_status not in dict(Server.STATUS_CHOICES).keys():
                return JsonResponse({
                    "error": "Invalid or missing status",
                    "valid_statuses": list(dict(Server.STATUS_CHOICES).keys())
                }, status=400)
                
            # Update servers
            updated = Server.objects.filter(id__in=server_ids).update(status=new_status)
            
            return JsonResponse({
                "status": "success",
                "updated_count": updated,
                "new_status": new_status
            })
        except Exception as e:
            logger.error(f"Bulk status update failed: {str(e)}")
            return JsonResponse({
                "error": "Bulk update failed",
                "details": str(e)
            }, status=500)





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
    



# # New view to fetch metrics directly via SSH
# class LiveMetricFetchView(View):
#     """Fetch live metrics directly from servers via SSH"""
    
#     def get(self, request):
#         metric = request.GET.get('metric')
#         server_id = request.GET.get('server_id')
#         hostname = request.GET.get('hostname')
        
#         if not metric:
#             return JsonResponse({
#                 "error": "Missing metric parameter",
#                 "available_metrics": ["vmstat", "iostat", "netstat", "ps"]
#             }, status=400)
        
#         # Get SSH client
#         try:
#             if server_id:
#                 ssh_client = get_ssh_client(server_id)
#             elif hostname:
#                 ssh_client = get_ssh_client(hostname, by_hostname=True)
#             else:
#                 return JsonResponse({
#                     "error": "Must specify either server_id or hostname"
#                 }, status=400)
                
#             if not ssh_client:
#                 return JsonResponse({
#                     "error": "SSH client not available for server"
#                 }, status=404)
#         except Exception as e:
#             logger.error(f"SSH client error: {str(e)}")
#             return JsonResponse({
#                 "error": "SSH connection failed",
#                 "details": str(e)
#             }, status=500)
        
#         # Map metric to command
#         COMMAND_MAP = {
#             'vmstat': 'vmstat 1 1',
#             'iostat': 'iostat 1 1',
#             'netstat': 'netstat -i',
#             'ps': 'ps aux'
#         }
        
#         command = COMMAND_MAP.get(metric.lower())
#         if not command:
#             return JsonResponse({
#                 "error": "Unsupported metric",
#                 "available_metrics": list(COMMAND_MAP.keys())
#             }, status=400)
        
#         # Execute command
#         try:
#             output = ssh_client.execute(command)
#             return JsonResponse({
#                 "metric": metric,
#                 "server_id": server_id,
#                 "hostname": hostname,
#                 "output": output
#             })
#         except Exception as e:
#             logger.error(f"Command execution failed: {str(e)}")
#             return JsonResponse({
#                 "error": "Command execution failed",
#                 "details": str(e)
#             }, status=500)

# # New view for bulk metric collection
# class BulkMetricCollectionView(View):
#     """Collect metrics from all active servers simultaneously"""
    
#     def get(self, request):
#         metric = request.GET.get('metric')
#         if not metric:
#             return JsonResponse({
#                 "error": "Missing metric parameter",
#                 "available_metrics": ["vmstat", "iostat", "netstat", "ps"]
#             }, status=400)
        
#         # Get all SSH clients
#         try:
#             ssh_clients = get_all_ssh_clients()
#             if not ssh_clients:
#                 return JsonResponse({
#                     "message": "No active servers available"
#                 }, status=404)
#         except Exception as e:
#             logger.error(f"SSH client error: {str(e)}")
#             return JsonResponse({
#                 "error": "Failed to get SSH clients",
#                 "details": str(e)
#             }, status=500)
        
#         # Map metric to command
#         COMMAND_MAP = {
#             'vmstat': 'vmstat 1 1',
#             'iostat': 'iostat 1 1',
#             'netstat': 'netstat -i',
#             'ps': 'ps aux'
#         }
        
#         command = COMMAND_MAP.get(metric.lower())
#         if not command:
#             return JsonResponse({
#                 "error": "Unsupported metric",
#                 "available_metrics": list(COMMAND_MAP.keys())
#             }, status=400)
        
#         # Execute commands concurrently
#         from concurrent.futures import ThreadPoolExecutor
#         results = {}
        
#         def fetch_metric(client_id, ssh_client):
#             try:
#                 output = ssh_client.execute(command)
#                 return {
#                     "status": "success",
#                     "output": output
#                 }
#             except Exception as e:
#                 return {
#                     "status": "error",
#                     "error": str(e)
#                 }
        
#         with ThreadPoolExecutor(max_workers=10) as executor:
#             futures = {
#                 executor.submit(fetch_metric, client_id, ssh_client): client_id
#                 for client_id, ssh_client in ssh_clients.items()
#             }
#             for future in futures:
#                 client_id = futures[future]
#                 try:
#                     results[client_id] = future.result()
#                 except Exception as e:
#                     results[client_id] = {
#                         "status": "error",
#                         "error": str(e)
#                     }
        
#         # Add server information
#         final_results = {}
#         for client_id, result in results.items():
#             try:
#                 server = Server.objects.get(id=client_id)
#                 server_info = {
#                     "hostname": server.hostname,
#                     "alias": server.alias,
#                     "status": server.status
#                 }
#             except ObjectDoesNotExist:
#                 server_info = {
#                     "hostname": "Unknown",
#                     "alias": None,
#                     "status": "unknown"
#                 }
                
#             final_results[client_id] = {
#                 "server": server_info,
#                 "result": result
#             }
        
#         return JsonResponse({
#             "metric": metric,
#             "results": final_results,
#             "total_servers": len(results),
#             "success_count": sum(1 for r in results.values() if r['status'] == 'success'),
#             "error_count": sum(1 for r in results.values() if r['status'] == 'error')
#         })

# # SSH Health Check View
# class SSHHealthCheckView(View):
#     """Check health of all SSH connections"""
    
#     def get(self, request):
#         try:
#             health_data = ssh_health_check()
#             return JsonResponse(health_data)
#         except Exception as e:
#             logger.error(f"SSH health check failed: {str(e)}")
#             return JsonResponse({
#                 "status": "error",
#                 "error": str(e)
#             }, status=500)