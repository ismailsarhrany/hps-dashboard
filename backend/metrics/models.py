from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils import timezone
import uuid

class Server(models.Model):
    """
    Server information and connection details
    """
    OS_CHOICES = [
        ('aix', 'AIX'),
        ('linux', 'Linux'),
        ('solaris', 'Solaris'),
        ('windows', 'Windows'),
    ]
    
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('maintenance', 'Maintenance'),
        ('error', 'Error'),
    ]
    
    # Basic server information
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hostname = models.CharField(max_length=255, unique=True)
    ip_address = models.GenericIPAddressField()
    alias = models.CharField(max_length=100, blank=True, null=True, help_text="Friendly name for the server")
    
    # Operating system information
    os_type = models.CharField(max_length=20, choices=OS_CHOICES)
    os_version = models.CharField(max_length=100, blank=True, null=True)
    architecture = models.CharField(max_length=20, blank=True, null=True)  # x86_64, sparc, etc.
    
    # SSH connection details
    ssh_port = models.IntegerField(
        default=22,
        validators=[MinValueValidator(1), MaxValueValidator(65535)]
    )
    ssh_username = models.CharField(max_length=50)
    ssh_key_path = models.CharField(max_length=500, blank=True, null=True, help_text="Path to SSH private key")
    ssh_password = models.CharField(max_length=255, blank=True, null=True, help_text="SSH password (if not using key)")
    
    # Server status and monitoring
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    monitoring_enabled = models.BooleanField(default=True)
    monitoring_interval = models.IntegerField(default=60, help_text="Monitoring interval in seconds")
    
    # Metadata
    description = models.TextField(blank=True, null=True)
    location = models.CharField(max_length=100, blank=True, null=True)
    environment = models.CharField(max_length=20, blank=True, null=True)  # prod, dev, test
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_seen = models.DateTimeField(blank=True, null=True)
    
    class Meta:
        db_table = 'servers'
        indexes = [
            models.Index(fields=['hostname']),
            models.Index(fields=['ip_address']),
            models.Index(fields=['os_type']),
            models.Index(fields=['status']),
            models.Index(fields=['monitoring_enabled']),
        ]
        ordering = ['hostname']
    
    def __str__(self):
        return f"{self.hostname} ({self.ip_address})"
    
    def update_last_seen(self):
        """Update the last seen timestamp"""
        self.last_seen = timezone.now()
        self.save(update_fields=['last_seen'])
    
    def is_online(self):
        """Check if server was seen recently (within 5 minutes)"""
        if not self.last_seen:
            return False
        return timezone.now() - self.last_seen < timezone.timedelta(minutes=5)


class VmstatMetric(models.Model):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='vmstat_metrics')
    timestamp = models.DateTimeField(db_index=True)
    
    # Process information
    r = models.IntegerField(help_text="Runnable processes")
    b = models.IntegerField(help_text="Blocked processes")
    
    # Memory information (in KB)
    avm = models.BigIntegerField(help_text="Active virtual memory")
    fre = models.BigIntegerField(help_text="Free memory")
    
    # Paging activity
    pi = models.IntegerField(help_text="Pages paged in")
    po = models.IntegerField(help_text="Pages paged out")
    fr = models.IntegerField(help_text="Pages freed")
    
    # System activity
    interface_in = models.IntegerField(db_column='in', help_text="Interrupts")
    cs = models.IntegerField(help_text="Context switches")
    
    # CPU utilization (percentage)
    us = models.FloatField(help_text="User time")
    sy = models.FloatField(help_text="System time")
    idle = models.FloatField(help_text="Idle time")
    
    # Additional fields for extended metrics
    # wa = models.FloatField(null=True, blank=True, help_text="Wait time (I/O)")
    # st = models.FloatField(null=True, blank=True, help_text="Stolen time")

    class Meta:
        db_table = 'vmstat_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]
        ordering = ['-timestamp']


class IostatMetric(models.Model):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='iostat_metrics')
    timestamp = models.DateTimeField(db_index=True)
    disk = models.CharField(max_length=50, help_text="Disk device name")
    
    # I/O statistics
    tps = models.FloatField(help_text="Transactions per second")
    kb_read = models.FloatField(help_text="KB read per second")
    kb_wrtn = models.FloatField(help_text="KB written per second")
    service_time = models.FloatField(help_text="Average service time in milliseconds")
    
    # Additional fields for extended metrics
    # utilization = models.FloatField(null=True, blank=True, help_text="Device utilization percentage")
    # queue_length = models.FloatField(null=True, blank=True, help_text="Average queue length")

    class Meta:
        db_table = 'iostat_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp']),
            models.Index(fields=['timestamp']),
            models.Index(fields=['disk']),
        ]
        ordering = ['-timestamp']


class NetstatMetric(models.Model):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='netstat_metrics')
    timestamp = models.DateTimeField(db_index=True)
    interface = models.CharField(max_length=50, help_text="Network interface name")
    
    # Input statistics
    ipkts = models.BigIntegerField(help_text="Input packets")
    ierrs = models.BigIntegerField(help_text="Input errors")
    ipkts_rate = models.FloatField(null=True, blank=True, help_text="Input packets per second")
    ierrs_rate = models.FloatField(null=True, blank=True, help_text="Input errors per second")
    
    # Output statistics
    opkts = models.BigIntegerField(help_text="Output packets")
    opkts_rate = models.FloatField(null=True, blank=True, help_text="Output packets per second")
    oerrs = models.BigIntegerField(help_text="Output errors")
    oerrs_rate = models.FloatField(null=True, blank=True, help_text="Output errors per second")
    
    # Additional fields
    time = models.BigIntegerField(help_text="Timestamp")
    # collisions = models.BigIntegerField(null=True, blank=True, help_text="Collisions")
    # dropped = models.BigIntegerField(null=True, blank=True, help_text="Dropped packets")

    class Meta:
        db_table = 'netstat_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp']),
            models.Index(fields=['timestamp']),
            models.Index(fields=['interface']),
        ]
        ordering = ['-timestamp']


class ProcessMetric(models.Model):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='process_metrics')
    timestamp = models.DateTimeField(db_index=True)
    
    # Process information
    pid = models.IntegerField(help_text="Process ID")
    user = models.CharField(max_length=50, help_text="Process owner")
    cpu = models.FloatField(help_text="CPU usage percentage")
    mem = models.FloatField(help_text="Memory usage percentage")
    command = models.CharField(max_length=500, help_text="Command line")
    
    # Additional process details
    # vsz = models.BigIntegerField(null=True, blank=True, help_text="Virtual memory size")
    # rss = models.BigIntegerField(null=True, blank=True, help_text="Resident set size")
    # start_time = models.CharField(max_length=20, null=True, blank=True, help_text="Process start time")
    
    class Meta:
        db_table = 'process_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp']),
            models.Index(fields=['timestamp', 'pid']),
            models.Index(fields=['pid', 'timestamp']),
        ]
        ordering = ['-timestamp']


class MonitoringSession(models.Model):
    """
    Track monitoring sessions for each server
    """
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='monitoring_sessions')
    session_id = models.UUIDField(default=uuid.uuid4, unique=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=[
        ('running', 'Running'),
        ('stopped', 'Stopped'),
        ('error', 'Error'),
    ], default='running')
    error_message = models.TextField(null=True, blank=True)
    metrics_collected = models.IntegerField(default=0)
    
    class Meta:
        db_table = 'monitoring_sessions'
        indexes = [
            models.Index(fields=['server', 'started_at']),
            models.Index(fields=['status']),
        ]
        ordering = ['-started_at']


class ServerGroup(models.Model):
    """
    Group servers for easier management
    """
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    servers = models.ManyToManyField(Server, related_name='groups', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'server_groups'
        ordering = ['name']
    
    def __str__(self):
        return self.name


class MetricAlert(models.Model):
    """
    Alert definitions for monitoring thresholds
    """
    METRIC_TYPES = [
        ('cpu', 'CPU Usage'),
        ('memory', 'Memory Usage'),
        ('disk_io', 'Disk I/O'),
        ('network', 'Network'),
        ('process', 'Process'),
    ]
    
    SEVERITY_LEVELS = [
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('critical', 'Critical'),
    ]
    
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name='alerts')
    name = models.CharField(max_length=100)
    metric_type = models.CharField(max_length=20, choices=METRIC_TYPES)
    threshold = models.FloatField()
    severity = models.CharField(max_length=20, choices=SEVERITY_LEVELS)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'metric_alerts'
        unique_together = ['server', 'name']
        indexes = [
            models.Index(fields=['server', 'is_active']),
            models.Index(fields=['metric_type']),
        ]


