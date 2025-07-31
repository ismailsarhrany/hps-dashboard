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
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from metrics.models import VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric, Server
from metrics.utils.ssh_client import get_ssh_client, get_all_ssh_clients, ssh_health_check
import logging
import json
# from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_protect
# from .permissions import AllowAll, AllowAll 
from rest_framework.views import APIView
# from rest_framework.authentication import TokenAuthentication
# from rest_framework.permissions import IsAuthenticated
from django.views.generic import View
from django.forms.models import model_to_dict
from encrypted_model_fields.fields import EncryptedCharField
import json
from .permissions import AllowAll
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone

from .models import Server, OracleDatabase, OracleTable, OracleTableData, OracleMonitoringTask
from .serializers import (
    OracleDatabaseSerializer, OracleTableSerializer, 
    OracleTableDataSerializer, OracleMonitoringTaskSerializer
)
from metrics.management.services.oracle_service import OracleService




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

class RealtimeMetricsView(APIView):
    """API endpoint to get the last 1 minute of data for a given metric."""
    authentication_classes = []
    permission_classes = [AllowAll]
    
    # @method_decorator(login_required)
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

class HistoricalMetricsView(APIView):
    """
    API endpoint to get historical data for a given metric within a time range.
    Supports server filtering and aggregation for process metrics.
    """
    authentication_classes = []
    permission_classes = [AllowAll]


    # @method_decorator(login_required)
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
    
class ServerCreateView(APIView):
    """Create a new server instance"""
    authentication_classes = []
    permission_classes = [AllowAll]
    
    # @method_decorator(csrf_protect)
    # @method_decorator(login_required)    
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

class ServerDetailView(APIView):
    """Retrieve, update or delete a server instance"""
    authentication_classes = []
    permission_classes = [AllowAll]  

    # @method_permission_classes([AllowAll])
    # @method_decorator(login_required)
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
    
    # @method_permission_classes([AllowAll])
    # @method_decorator(csrf_protect)
    # @method_decorator(login_required)
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
                # if 'ssh_password' in data:
                #     server.ssh_password = encrypt(data['ssh_password'])
                # if 'ssh_key_path' in data:
                #     server.ssh_key_path = encrypt(data['ssh_key_path'])    
            
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
    
    # @method_permission_classes([AllowAll])
    # @method_decorator(csrf_protect)
    # @method_decorator(login_required)
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

class ServerListView(APIView):
    """List all servers or create a new server"""
    authentication_classes = []
    permission_classes = [AllowAll]
    
    # @method_decorator(login_required)
    
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
            server_list = [model_to_dict(server) | {"id": server.id} for server in page_obj]
            
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

class ServerTestConnectionView(APIView):
    """Test SSH connection to a server"""
    authentication_classes = []
    permission_classes = [AllowAll]
    
    # @method_decorator(csrf_protect)
    # @method_decorator(login_required)
    
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

class ServerBulkStatusView(APIView):
    """Bulk update server statuses"""
    authentication_classes = []
    permission_classes = [AllowAll]
    
    # @method_decorator(csrf_protect)
    # @method_decorator(login_required)
    
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
    

class OracleDatabaseViewSet(viewsets.ModelViewSet):
    """API endpoints for Oracle database management"""
    serializer_class = OracleDatabaseSerializer
    # permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = OracleDatabase.objects.all().select_related('server')
        server_id = self.request.query_params.get('server_id')
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        return queryset

    @action(detail=True, methods=['post'])
    def test_connection(self, request, pk=None):
        """Test connection to Oracle database"""
        database = self.get_object()
        oracle_service = OracleService()
        
        result = oracle_service.test_connection(database)
        
        if result['success']:
            return Response(result, status=status.HTTP_200_OK)
        else:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'])
    def tables(self, request, pk=None):
        """Get all monitored tables for this database"""
        database = self.get_object()
        tables = database.monitored_tables.filter(is_active=True)
        serializer = OracleTableSerializer(tables, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def status(self, request, pk=None):
        """Get database connection status and statistics"""
        database = self.get_object()
        
        # Get table count and recent activity
        table_count = database.monitored_tables.filter(is_active=True).count()
        recent_tasks = OracleMonitoringTask.objects.filter(
            table__database=database,
            created_at__gte=timezone.now() - timezone.timedelta(hours=1)
        ).count()
        
        # Get latest data snapshots
        latest_snapshots = OracleTableData.objects.filter(
            table__database=database
        ).select_related('table')[:5]
        
        return Response({
            'database': OracleDatabaseSerializer(database).data,
            'statistics': {
                'table_count': table_count,
                'recent_tasks': recent_tasks,
                'connection_status': database.connection_status,
                'last_connection_test': database.last_connection_test,
            },
            'latest_snapshots': OracleTableDataSerializer(latest_snapshots, many=True).data
        })


class OracleTableViewSet(viewsets.ModelViewSet):
    """API endpoints for Oracle table management"""
    serializer_class = OracleTableSerializer
    # permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = OracleTable.objects.all().select_related('database', 'database__server')
        database_id = self.request.query_params.get('database_id')
        server_id = self.request.query_params.get('server_id')
        
        if database_id:
            queryset = queryset.filter(database_id=database_id)
        if server_id:
            queryset = queryset.filter(database__server_id=server_id)
            
        return queryset

    @action(detail=True, methods=['post'])
    def monitor_now(self, request, pk=None):
        """Manually trigger monitoring for this table"""
        table = self.get_object()
        oracle_service = OracleService()
        
        result = oracle_service.monitor_table(table)
        
        if result['success']:
            return Response(result, status=status.HTTP_200_OK)
        else:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'])
    def current_data(self, request, pk=None):
        """Get current data from the table"""
        table = self.get_object()
        oracle_service = OracleService()
        
        result = oracle_service.get_table_data(table)
        
        if result['success']:
            return Response({
                'table': OracleTableSerializer(table).data,
                'data': result['data'],
                'record_count': result['record_count'],
                'timestamp': result['timestamp'],
                'collection_duration': result['collection_duration']
            })
        else:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        """Get historical data for this table"""
        table = self.get_object()
        limit = int(request.query_params.get('limit', 10))
        
        oracle_service = OracleService()
        history = oracle_service.get_table_history(table, limit)
        
        return Response({
            'table': OracleTableSerializer(table).data,
            'history': history
        })

    @action(detail=True, methods=['get'])
    def monitoring_tasks(self, request, pk=None):
        """Get monitoring tasks for this table"""
        table = self.get_object()
        limit = int(request.query_params.get('limit', 20))
        
        tasks = OracleMonitoringTask.objects.filter(table=table)[:limit]
        serializer = OracleMonitoringTaskSerializer(tasks, many=True)
        
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def update_config(self, request, pk=None):
        """Update table monitoring configuration"""
        table = self.get_object()
        
        # Update allowed fields
        allowed_fields = [
            'polling_interval', 'columns_to_monitor', 'where_clause', 
            'order_by', 'timestamp_column', 'primary_key_columns', 'is_active'
        ]
        
        for field in allowed_fields:
            if field in request.data:
                setattr(table, field, request.data[field])
        
        table.save()
        
        return Response(OracleTableSerializer(table).data)


class OracleDataViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoints for Oracle data snapshots"""
    serializer_class = OracleTableDataSerializer
    # permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = OracleTableData.objects.all().select_related('table', 'table__database')
        table_id = self.request.query_params.get('table_id')
        database_id = self.request.query_params.get('database_id')
        server_id = self.request.query_params.get('server_id')
        
        if table_id:
            queryset = queryset.filter(table_id=table_id)
        if database_id:
            queryset = queryset.filter(table__database_id=database_id)
        if server_id:
            queryset = queryset.filter(table__database__server_id=server_id)
            
        return queryset.order_by('-timestamp')

    @action(detail=False, methods=['get'])
    def latest_by_table(self, request):
        """Get latest data snapshot for each table"""
        from django.db.models import Max
        
        # Get latest timestamp for each table
        latest_times = OracleTableData.objects.values('table').annotate(
            latest_time=Max('timestamp')
        )
        
        # Get the actual latest records
        latest_snapshots = []
        for item in latest_times:
            snapshot = OracleTableData.objects.filter(
                table_id=item['table'],
                timestamp=item['latest_time']
            ).select_related('table', 'table__database', 'table__database__server').first()
            if snapshot:
                latest_snapshots.append(snapshot)
        
        serializer = OracleTableDataSerializer(latest_snapshots, many=True)
        return Response(serializer.data)


class OracleMonitoringTaskViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoints for monitoring tasks"""
    serializer_class = OracleMonitoringTaskSerializer
    # permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = OracleMonitoringTask.objects.all().select_related('table', 'table__database')
        table_id = self.request.query_params.get('table_id')
        database_id = self.request.query_params.get('database_id')
        status_filter = self.request.query_params.get('status')
        
        if table_id:
            queryset = queryset.filter(table_id=table_id)
        if database_id:
            queryset = queryset.filter(table__database_id=database_id)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
            
        return queryset.order_by('-created_at')

    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """Get monitoring task statistics"""
        from django.db.models import Count
        
        # Overall statistics
        total_tasks = OracleMonitoringTask.objects.count()
        
        # Status breakdown
        status_counts = OracleMonitoringTask.objects.values('status').annotate(
            count=Count('id')
        )
        
        # Recent activity (last 24 hours)
        recent_tasks = OracleMonitoringTask.objects.filter(
            created_at__gte=timezone.now() - timezone.timedelta(hours=24)
        ).count()
        
        # Failed tasks in last hour
        recent_failures = OracleMonitoringTask.objects.filter(
            status='failed',
            created_at__gte=timezone.now() - timezone.timedelta(hours=1)
        ).count()
        
        return Response({
            'total_tasks': total_tasks,
            'status_breakdown': {item['status']: item['count'] for item in status_counts},
            'recent_tasks_24h': recent_tasks,
            'recent_failures_1h': recent_failures
        })


# Additional utility views
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

@api_view(['GET','POST'])
# @permission_classes([IsAuthenticated])
def oracle_dashboard_data(request):
    """Get comprehensive dashboard data for Oracle monitoring"""
    from django.db.models import Count, Max
    
    # Database statistics
    total_databases = OracleDatabase.objects.filter(is_active=True).count()
    connected_databases = OracleDatabase.objects.filter(
        is_active=True, 
        connection_status='connected'
    ).count()
    
    # Table statistics
    total_tables = OracleTable.objects.filter(is_active=True).count()
    active_monitoring = OracleTable.objects.filter(
        is_active=True,
        database__is_active=True,
        database__server__is_active=True
    ).count()
    
    # Recent activity
    recent_snapshots = OracleTableData.objects.filter(
        timestamp__gte=timezone.now() - timezone.timedelta(hours=1)
    ).count()
    
    recent_tasks = OracleMonitoringTask.objects.filter(
        created_at__gte=timezone.now() - timezone.timedelta(hours=1)
    ).values('status').annotate(count=Count('id'))
    
    # Latest data from each active table
    latest_data = []
    active_tables = OracleTable.objects.filter(
        is_active=True,
        database__is_active=True
    ).select_related('database', 'database__server')[:10]
    
    for table in active_tables:
        latest_snapshot = OracleTableData.objects.filter(table=table).first()
        if latest_snapshot:
            latest_data.append({
                'table_name': str(table),
                'server_name': table.database.server.name,
                'database_name': table.database.name,
                'record_count': latest_snapshot.record_count,
                'timestamp': latest_snapshot.timestamp,
                'collection_duration': latest_snapshot.collection_duration
            })
    
    return Response({
        'databases': {
            'total': total_databases,
            'connected': connected_databases,
            'connection_rate': (connected_databases / total_databases * 100) if total_databases > 0 else 0
        },
        'tables': {
            'total': total_tables,
            'actively_monitored': active_monitoring
        },
        'activity': {
            'recent_snapshots': recent_snapshots,
            'recent_tasks': {item['status']: item['count'] for item in recent_tasks}
        },
        'latest_data': latest_data
    })