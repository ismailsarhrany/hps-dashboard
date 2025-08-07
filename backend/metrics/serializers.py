# Add these fixes to your existing serializers.py

from rest_framework import serializers
from .models import Server, OracleDatabase, OracleTable, OracleTableData, OracleMonitoringTask

class ServerSerializer(serializers.ModelSerializer):
    """Serializer for Server model"""
    class Meta:
        model = Server
        fields = [
            'id', 
            'hostname', 
            'ip_address', 
            'ssh_port', 
            'ssh_username', 
            'status', 
            'monitoring_enabled',  # Use this instead of is_active
            'created_at', 
            'updated_at'
        ]
        extra_kwargs = {
            'ssh_password': {'write_only': True}
        }

class OracleDatabaseSerializer(serializers.ModelSerializer):
    """Serializer for Oracle Database model"""
    server = ServerSerializer(read_only=True)
    server_id = serializers.UUIDField(write_only=True)
    server_name = serializers.CharField(source='server.hostname', read_only=True)
    monitored_tables_count = serializers.SerializerMethodField()
    connection_status_display = serializers.CharField(source='get_connection_status_display', read_only=True)
    
    class Meta:
        model = OracleDatabase
        fields = [
            'id', 'server', 'server_id', 'server_name', 'name', 'host', 'port', 
            'sid', 'username', 'connection_timeout', 'is_active',
            'created_at', 'updated_at', 'last_connection_test', 'connection_status',
            'connection_status_display', 'monitored_tables_count'
        ]
        extra_kwargs = {
            'password': {'write_only': True}
        }
    
    def get_monitored_tables_count(self, obj):
        return obj.monitored_tables.filter(is_active=True).count()

class OracleTableSerializer(serializers.ModelSerializer):
    """Serializer for Oracle Table model"""
    database = OracleDatabaseSerializer(read_only=True)
    database_id = serializers.IntegerField(write_only=True)
    database_name = serializers.CharField(source='database.name', read_only=True)
    server_name = serializers.CharField(source='database.server.hostname', read_only=True)
    full_table_name = serializers.CharField(source='get_full_table_name', read_only=True)
    latest_snapshot = serializers.SerializerMethodField()
    monitoring_status = serializers.SerializerMethodField()
    
    class Meta:
        model = OracleTable
        fields = [
            'id', 'database', 'database_id', 'database_name', 'server_name',
            'table_name', 'schema_name', 'full_table_name', 'is_active',
            'polling_interval', 'columns_to_monitor', 'where_clause', 'order_by',
            'timestamp_column', 'primary_key_columns', 'created_at', 'updated_at',
            'last_poll_time', 'last_record_count', 'latest_snapshot', 'monitoring_status'
        ]
    
    def get_latest_snapshot(self, obj):
        latest = obj.data_snapshots.first()
        if latest:
            return {
                'id': latest.id,
                'record_count': latest.record_count,
                'timestamp': latest.timestamp,
                'collection_duration': latest.collection_duration
            }
        return None
    
    def get_monitoring_status(self, obj):
        from django.utils import timezone
        from datetime import timedelta
        
        if not obj.is_active:
            return 'inactive'
        
        if not obj.last_poll_time:
            return 'never_polled'
        
        # Check if polling is overdue
        next_poll_time = obj.last_poll_time + timedelta(seconds=obj.polling_interval)
        if timezone.now() > next_poll_time + timedelta(minutes=5):  # 5 min grace period
            return 'overdue'
        
        # Check recent task status
        latest_task = obj.monitoring_tasks.first()
        if latest_task:
            if latest_task.status == 'failed':
                return 'error'
            elif latest_task.status == 'running':
                return 'running'
        
        return 'active'

class OracleTableDataSerializer(serializers.ModelSerializer):
    """Serializer for Oracle Table Data snapshots"""
    table = OracleTableSerializer(read_only=True)
    table_id = serializers.IntegerField(write_only=True)
    table_name = serializers.CharField(source='table.table_name', read_only=True)
    database_name = serializers.CharField(source='table.database.name', read_only=True)
    server_name = serializers.CharField(source='table.database.server.hostname', read_only=True)
    data_preview = serializers.SerializerMethodField()
    
    class Meta:
        model = OracleTableData
        fields = [
            'id', 'table', 'table_id', 'table_name', 'database_name', 'server_name',
            'data', 'data_preview', 'record_count', 'checksum', 'timestamp',
            'collection_duration', 'errors'
        ]
        read_only_fields = ['id', 'timestamp', 'checksum']
    
    def get_data_preview(self, obj):
        """Return first 3 records as preview"""
        if obj.data and isinstance(obj.data, list):
            return obj.data[:3]
        return []
    
    def to_representation(self, instance):
        """Customize representation based on request context"""
        data = super().to_representation(instance)
        
        # If this is a list view, don't include full data to reduce payload size
        request = self.context.get('request')
        if request and hasattr(request, 'resolver_match'):
            if request.resolver_match.url_name and request.resolver_match.url_name.endswith('-list'):
                data.pop('data', None)  # Remove full data from list views
        
        return data

class OracleMonitoringTaskSerializer(serializers.ModelSerializer):
    """Serializer for Oracle Monitoring Tasks"""
    table = OracleTableSerializer(read_only=True)
    table_id = serializers.IntegerField(write_only=True)
    table_name = serializers.CharField(source='table.table_name', read_only=True)
    database_name = serializers.CharField(source='table.database.name', read_only=True)
    server_name = serializers.CharField(source='table.database.server.hostname', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    duration_formatted = serializers.SerializerMethodField()
    
    class Meta:
        model = OracleMonitoringTask
        fields = [
            'id', 'table', 'table_id', 'table_name', 'database_name', 'server_name',
            'status', 'status_display', 'started_at', 'completed_at', 'duration',
            'duration_formatted', 'records_processed', 'changes_detected',
            'error_message', 'created_at'
        ]
        read_only_fields = [
            'id', 'started_at', 'completed_at', 'duration', 'records_processed',
            'changes_detected', 'error_message', 'created_at'
        ]
    
    def get_duration_formatted(self, obj):
        """Format duration in human readable format"""
        if obj.duration is None:
            return None
        
        if obj.duration < 1:
            return f"{obj.duration:.2f}s"
        elif obj.duration < 60:
            return f"{obj.duration:.1f}s"
        else:
            minutes = int(obj.duration // 60)
            seconds = int(obj.duration % 60)
            return f"{minutes}m {seconds}s"

# Specialized serializers for different use cases

class OracleTableSummarySerializer(serializers.ModelSerializer):
    """Lightweight serializer for table summaries"""
    database_name = serializers.CharField(source='database.name', read_only=True)
    server_name = serializers.CharField(source='database.server.hostname', read_only=True)
    full_table_name = serializers.CharField(source='get_full_table_name', read_only=True)
    last_update = serializers.DateTimeField(source='last_poll_time', read_only=True)
    
    class Meta:
        model = OracleTable
        fields = [
            'id', 'table_name', 'schema_name', 'full_table_name',
            'database_name', 'server_name', 'last_record_count',
            'last_update', 'is_active', 'polling_interval'
        ]

class OracleDatabaseSummarySerializer(serializers.ModelSerializer):
    """Lightweight serializer for database summaries"""
    server_name = serializers.CharField(source='server.hostname', read_only=True)
    table_count = serializers.SerializerMethodField()
    
    class Meta:
        model = OracleDatabase
        fields = [
            'id', 'name', 'server_name', 'host', 'port', 'sid',
            'connection_status', 'last_connection_test', 'table_count', 'is_active'
        ]
    
    def get_table_count(self, obj):
        return obj.monitored_tables.filter(is_active=True).count()

class OracleDataUpdateSerializer(serializers.Serializer):
    """Serializer for real-time data updates via WebSocket"""
    type = serializers.CharField(default='oracle_data_update')
    server_id = serializers.IntegerField()
    server_name = serializers.CharField()
    database_id = serializers.IntegerField()
    database_name = serializers.CharField()
    table_id = serializers.IntegerField()
    table_name = serializers.CharField()
    schema_name = serializers.CharField()
    data = serializers.ListField()
    record_count = serializers.IntegerField()
    changes_detected = serializers.BooleanField()
    timestamp = serializers.DateTimeField()
    
    class Meta:
        fields = [
            'type', 'server_id', 'server_name', 'database_id', 'database_name',
            'table_id', 'table_name', 'schema_name', 'data', 'record_count',
            'changes_detected', 'timestamp'
        ]