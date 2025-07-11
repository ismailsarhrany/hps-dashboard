# serializers.py

from rest_framework import serializers
from .models import AIXServer, ServerMetricCollection, VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric

class AIXServerSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    decrypted_password = serializers.SerializerMethodField()
    
    class Meta:
        model = AIXServer
        fields = [
            'id', 'name', 'ip_address', 'username', 'password', 
            'port', 'status', 'last_connected', 'created_at', 'updated_at',
            'is_simulation', 'simulation_interval', 'decrypted_password'
        ]
        read_only_fields = ['id', 'status', 'last_connected', 'created_at', 'updated_at']
    
    def get_decrypted_password(self, obj):
        # Only return decrypted password for testing purposes
        # In production, you might want to remove this
        if self.context.get('request') and self.context['request'].user.is_staff:
            try:
                return obj.decrypt_password()
            except:
                return None
        return None

class ServerMetricCollectionSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source='server.name', read_only=True)
    duration = serializers.SerializerMethodField()
    
    class Meta:
        model = ServerMetricCollection
        fields = [
            'id', 'server', 'server_name', 'started_at', 'ended_at', 
            'is_active', 'total_metrics_collected', 'duration'
        ]
        read_only_fields = ['id', 'started_at', 'ended_at', 'total_metrics_collected']
    
    def get_duration(self, obj):
        if obj.ended_at:
            return (obj.ended_at - obj.started_at).total_seconds()
        return None

class VmstatMetricSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source='server.name', read_only=True)
    
    class Meta:
        model = VmstatMetric
        fields = '__all__'

class IostatMetricSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source='server.name', read_only=True)
    
    class Meta:
        model = IostatMetric
        fields = '__all__'

class NetstatMetricSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source='server.name', read_only=True)
    
    class Meta:
        model = NetstatMetric
        fields = '__all__'

class ProcessMetricSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source='server.name', read_only=True)
    
    class Meta:
        model = ProcessMetric
        fields = '__all__'

# views.py

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db.models import Count, Avg, Max, Min
from datetime import datetime, timedelta
import logging

from .models import AIXServer, ServerMetricCollection, VmstatMetric, IostatMetric, NetstatMetric, ProcessMetric
from .serializers import (
    AIXServerSerializer, ServerMetricCollectionSerializer, 
    VmstatMetricSerializer, IostatMetricSerializer, 
    NetstatMetricSerializer, ProcessMetricSerializer
)
from .services.aix_simulation_service import simulation_manager

logger = logging.getLogger(__name__)

class AIXServerViewSet(viewsets.ModelViewSet):
    queryset = AIXServer.objects.all()
    serializer_class = AIXServerSerializer
    permission_classes = [IsAuthenticated]
    
    @action(detail=True, methods=['post'])
    def test_connection(self, request, pk=None):
        """Test SSH connection to the server"""
        server = self.get_object()
        try:
            result = server.test_connection()
            if result is True:
                return Response({
                    'status': 'success',
                    'message': 'Connection successful',
                    'server_status': server.status
                })
            else:
                return Response({
                    'status': 'error',
                    'message': f'Connection failed: {result[1]}',
                    'server_status': server.status
                }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({
                'status': 'error',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=True, methods=['post'])
    def start_simulation(self, request, pk=None):
        """Start metrics simulation for the server"""
        server = self.get_object()
        try:
            success = simulation_manager.start_server_simulation(server.id)
            if success:
                return Response({
                    'status': 'success',
                    'message': f'Simulation started for {server.name}',
                    'is_running': simulation_manager.get_simulation_status(server.id)
                })
            else:
                return Response({
                    'status': 'error',
                    'message': 'Failed to start simulation'
                }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Error starting simulation: {e}")
            return Response({
                'status': 'error',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=True, methods=['post'])
    def stop_simulation(self, request, pk=None):
        """Stop metrics simulation for the server"""
        server = self.get_object()
        try:
            simulation_manager.stop_server_simulation(server.id)
            return Response({
                'status': 'success',
                'message': f'Simulation stopped for {server.name}',
                'is_running': simulation_manager.get_simulation_status(server.id)
            })
        except Exception as e:
            logger.error(f"Error stopping simulation: {e}")
            return Response({
                'status': 'error',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=True, methods=['get'])
    def simulation_status(self, request, pk=None):
        """Get simulation status for the server"""
        server = self.get_object()
        is_running = simulation_manager.get_simulation_status(server.id)
        
        # Get latest collection session
        latest_collection = ServerMetricCollection.objects.filter(
            server=server
        ).order_by('-started_at').first()
        
        return Response({
            'server_id': server.id,
            'server_name': server.name,
            'is_running': is_running,
            'status': server.status,
            'last_connected': server.last_connected,
            'latest_collection': ServerMetricCollectionSerializer(latest_collection).data if latest_collection else None
        })
    
    @action(detail=True, methods=['get'])
    def metrics_summary(self, request, pk=None):
        """Get metrics summary for the server"""
        server = self.get_object()
        
        # Get time range from query params
        hours = int(request.query_params.get('hours', 24))
        since = timezone.now() - timedelta(hours=hours)
        
        # Get metrics counts
        vmstat_count = VmstatMetric.objects.filter(server=server, timestamp__gte=since).count()
        iostat_count = IostatMetric.objects.filter(server=server, timestamp__gte=since).count()
        netstat_count = NetstatMetric.objects.filter(server=server, timestamp__gte=since).count()
        process_count = ProcessMetric.objects.filter(server=server, timestamp__gte=since).count()
        
        # Get latest metrics
        latest_vmstat = VmstatMetric.objects.filter(server=server).order_by('-timestamp').first()
        latest_iostat = IostatMetric.objects.filter(server=server).order_by('-timestamp').first()
        latest_netstat = NetstatMetric.objects.filter(server=server).order_by('-timestamp').first()
        latest_process = ProcessMetric.objects.filter(server=server).order_by('-timestamp').first()
        
        return Response({
            'server_id': server.id,
            'server_name': server.name,
            'time_range_hours': hours,
            'metrics_count': {
                'vmstat': vmstat_count,
                'iostat': iostat_count,
                'netstat': netstat_count,
                'process': process_count,
                'total': vmstat_count + iostat_count + netstat_count + process_count
            },
            'latest_metrics': {
                'vmstat': VmstatMetricSerializer(latest_vmstat).data if latest_vmstat else None,
                'iostat': IostatMetricSerializer(latest_iostat).data if latest_iostat else None,
                'netstat': NetstatMetricSerializer(latest_netstat).data if latest_netstat else None,
                'process': ProcessMetricSerializer(latest_process).data if latest_process else None
            }
        })

class ServerMetricCollectionViewSet(viewsets.ModelViewSet):
    queryset = ServerMetricCollection.objects.all()
    serializer_class = ServerMetricCollectionSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        server_id = self.request.query_params.get('server_id')
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        return queryset.order_by('-started_at')

class VmstatMetricViewSet(viewsets.ModelViewSet):
    queryset = VmstatMetric.objects.all()
    serializer_class = VmstatMetricSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        server_id = self.request.query_params.get('server_id')
        hours = self.request.query_params.get('hours', 24)
        
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        # Filter by time range
        since = timezone.now() - timedelta(hours=int(hours))
        queryset = queryset.filter(timestamp__gte=since)
        
        return queryset.order_by('-timestamp')
    
    @action(detail=False, methods=['get'])
    def cpu_usage(self, request):
        """Get CPU usage statistics"""
        server_id = request.query_params.get('server_id')
        hours = int(request.query_params.get('hours', 24))
        
        queryset = self.get_queryset()
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        # Calculate CPU statistics
        cpu_stats = queryset.aggregate(
            avg_user=Avg('us'),
            avg_system=Avg('sy'),
            avg_idle=Avg('idle'),
            max_user=Max('us'),
            max_system=Max('sy'),
            min_idle=Min('idle')
        )
        
        # Get recent CPU data points for chart
        recent_data = queryset[:50].values('timestamp', 'us', 'sy', 'idle')
        
        return Response({
            'statistics': cpu_stats,
            'recent_data': list(recent_data),
            'server_id': server_id,
            'time_range_hours': hours
        })

class IostatMetricViewSet(viewsets.ModelViewSet):
    queryset = IostatMetric.objects.all()
    serializer_class = IostatMetricSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        server_id = self.request.query_params.get('server_id')
        hours = self.request.query_params.get('hours', 24)
        disk = self.request.query_params.get('disk')
        
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        if disk:
            queryset = queryset.filter(disk=disk)
        
        # Filter by time range
        since = timezone.now() - timedelta(hours=int(hours))
        queryset = queryset.filter(timestamp__gte=since)
        
        return queryset.order_by('-timestamp')
    
    @action(detail=False, methods=['get'])
    def disk_usage(self, request):
        """Get disk usage statistics"""
        server_id = request.query_params.get('server_id')
        hours = int(request.query_params.get('hours', 24))
        
        queryset = self.get_queryset()
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        # Get statistics by disk
        disk_stats = queryset.values('disk').annotate(
            avg_tps=Avg('tps'),
            avg_read=Avg('kb_read'),
            avg_write=Avg('kb_wrtn'),
            max_tps=Max('tps'),
            max_service_time=Max('service_time')
        )
        
        return Response({
            'disk_statistics': list(disk_stats),
            'server_id': server_id,
            'time_range_hours': hours
        })

class NetstatMetricViewSet(viewsets.ModelViewSet):
    queryset = NetstatMetric.objects.all()
    serializer_class = NetstatMetricSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        server_id = self.request.query_params.get('server_id')
        hours = self.request.query_params.get('hours', 24)
        interface = self.request.query_params.get('interface')
        
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        if interface:
            queryset = queryset.filter(interface=interface)
        
        # Filter by time range
        since = timezone.now() - timedelta(hours=int(hours))
        queryset = queryset.filter(timestamp__gte=since)
        
        return queryset.order_by('-timestamp')
    
    @action(detail=False, methods=['get'])
    def network_usage(self, request):
        """Get network usage statistics"""
        server_id = request.query_params.get('server_id')
        hours = int(request.query_params.get('hours', 24))
        
        queryset = self.get_queryset()
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        # Get statistics by interface
        interface_stats = queryset.values('interface').annotate(
            avg_ipkts_rate=Avg('ipkts_rate'),
            avg_opkts_rate=Avg('opkts_rate'),
            total_ierrs=Count('ierrs'),
            total_oerrs=Count('oerrs'),
            max_ipkts_rate=Max('ipkts_rate'),
            max_opkts_rate=Max('opkts_rate')
        )
        
        return Response({
            'interface_statistics': list(interface_stats),
            'server_id': server_id,
            'time_range_hours': hours
        })

class ProcessMetricViewSet(viewsets.ModelViewSet):
    queryset = ProcessMetric.objects.all()
    serializer_class = ProcessMetricSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        server_id = self.request.query_params.get('server_id')
        hours = self.request.query_params.get('hours', 24)
        user = self.request.query_params.get('user')
        command = self.request.query_params.get('command')
        
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        if user:
            queryset = queryset.filter(user=user)
        
        if command:
            queryset = queryset.filter(command__icontains=command)
        
        # Filter by time range
        since = timezone.now() - timedelta(hours=int(hours))
        queryset = queryset.filter(timestamp__gte=since)
        
        return queryset.order_by('-timestamp')
    
    @action(detail=False, methods=['get'])
    def top_processes(self, request):
        """Get top processes by CPU and memory usage"""
        server_id = request.query_params.get('server_id')
        hours = int(request.query_params.get('hours', 1))
        limit = int(request.query_params.get('limit', 10))
        
        queryset = self.get_queryset()
        if server_id:
            queryset = queryset.filter(server_id=server_id)
        
        # Get latest timestamp
        latest_timestamp = queryset.aggregate(Max('timestamp'))['timestamp__max']
        if not latest_timestamp:
            return Response({'top_cpu': [], 'top_memory': []})
        
        # Get processes from latest collection
        latest_processes = queryset.filter(timestamp=latest_timestamp)
        
        # Top CPU processes
        top_cpu = latest_processes.order_by('-cpu')[:limit]
        
        # Top memory processes
        top_memory = latest_processes.order_by('-mem')[:limit]
        
        return Response({
            'top_cpu': ProcessMetricSerializer(top_cpu, many=True).data,
            'top_memory': ProcessMetricSerializer(top_memory, many=True).data,
            'timestamp': latest_timestamp,
            'server_id': server_id
        })

# Management commands and utilities
class SimulationManagementViewSet(viewsets.ViewSet):
    """Management endpoints for simulation control"""
    permission_classes = [IsAuthenticated]
    
    @action(detail=False, methods=['post'])
    def start_all(self, request):
        """Start simulation for all servers"""
        servers = AIXServer.objects.filter(is_simulation=True)
        started = []
        failed = []
        
        for server in servers:
            try:
                success = simulation_manager.start_server_simulation(server.id)
                if success:
                    started.append(server.name)
                else:
                    failed.append(server.name)
            except Exception as e:
                failed.append(f"{server.name}: {str(e)}")
        
        return Response({
            'status': 'completed',
            'started': started,
            'failed': failed,
            'total_servers': len(servers)
        })
    
    @action(detail=False, methods=['post'])
    def stop_all(self, request):
        """Stop all running simulations"""
        try:
            simulation_manager.stop_all_simulations()
            return Response({
                'status': 'success',
                'message': 'All simulations stopped'
            })
        except Exception as e:
            return Response({
                'status': 'error',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['get'])
    def status_all(self, request):
        """Get status of all server simulations"""
        servers = AIXServer.objects.all()
        status_list = []
        
        for server in servers:
            is_running = simulation_manager.get_simulation_status(server.id)
            status_list.append({
                'server_id': server.id,
                'server_name': server.name,
                'ip_address': server.ip_address,
                'is_simulation': server.is_simulation,
                'is_running': is_running,
                'status': server.status,
                'last_connected': server.last_connected
            })
        
        return Response({
            'servers': status_list,
            'total_servers': len(servers),
            'running_simulations': len([s for s in status_list if s['is_running']])
        })