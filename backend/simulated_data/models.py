from django.db import models

# Create your models here.
# models.py - Add these to your existing models

from django.db import models
from django.core.validators import validate_ipv4_address
from cryptography.fernet import Fernet
from django.conf import settings
import paramiko
import threading
import time
from datetime import datetime, timedelta
import random
import json

class AIXServer(models.Model):
    """Model to store AIX server connection details"""
    
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('error', 'Error'),
        ('connecting', 'Connecting'),
    ]
    
    name = models.CharField(max_length=100, unique=True)
    ip_address = models.GenericIPAddressField(validators=[validate_ipv4_address])
    username = models.CharField(max_length=50)
    password = models.TextField()  # Will be encrypted
    port = models.IntegerField(default=22)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='inactive')
    last_connected = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Simulation settings
    is_simulation = models.BooleanField(default=True)
    simulation_interval = models.IntegerField(default=30)  # seconds
    
    class Meta:
        db_table = 'aix_servers'
        verbose_name = 'AIX Server'
        verbose_name_plural = 'AIX Servers'
    
    def __str__(self):
        return f"{self.name} ({self.ip_address})"
    
    def save(self, *args, **kwargs):
        if self.password and not self.password.startswith('gAAAAAB'):
            # Encrypt password before saving
            self.password = self.encrypt_password(self.password)
        super().save(*args, **kwargs)
    
    def encrypt_password(self, password):
        """Encrypt password using Fernet encryption"""
        key = getattr(settings, 'ENCRYPTION_KEY', Fernet.generate_key())
        f = Fernet(key)
        return f.encrypt(password.encode()).decode()
    
    def decrypt_password(self):
        """Decrypt password for use"""
        key = getattr(settings, 'ENCRYPTION_KEY', Fernet.generate_key())
        f = Fernet(key)
        return f.decrypt(self.password.encode()).decode()
    
    def test_connection(self):
        """Test SSH connection to the server"""
        try:
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                hostname=self.ip_address,
                port=self.port,
                username=self.username,
                password=self.decrypt_password(),
                timeout=10
            )
            ssh.close()
            self.status = 'active'
            self.last_connected = datetime.now()
            self.save()
            return True
        except Exception as e:
            self.status = 'error'
            self.save()
            return False, str(e)

class ServerMetricCollection(models.Model):
    """Track metric collection sessions"""
    
    server = models.ForeignKey(AIXServer, on_delete=models.CASCADE, related_name='collections')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    total_metrics_collected = models.IntegerField(default=0)
    
    class Meta:
        db_table = 'server_metric_collections'

# Update your existing models to include server reference
class VmstatMetric(models.Model):
    server = models.ForeignKey(AIXServer, on_delete=models.CASCADE, related_name='vmstat_metrics')
    timestamp = models.DateTimeField()
    r = models.IntegerField()
    b = models.IntegerField()
    avm = models.IntegerField()
    fre = models.IntegerField()
    pi = models.IntegerField()
    po = models.IntegerField()
    fr = models.IntegerField()
    interface_in = models.IntegerField(db_column='in')
    cs = models.IntegerField()
    us = models.FloatField()
    sy = models.FloatField()
    idle = models.FloatField()

    class Meta:
        db_table = 'vmstat_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp'], name='vmstat_server_timestamp_idx'),
        ]

class IostatMetric(models.Model):
    server = models.ForeignKey(AIXServer, on_delete=models.CASCADE, related_name='iostat_metrics')
    timestamp = models.DateTimeField()
    disk = models.CharField(max_length=50)
    tps = models.FloatField()
    kb_read = models.FloatField()
    kb_wrtn = models.FloatField()
    service_time = models.FloatField()

    class Meta:
        db_table = 'iostat_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp'], name='iostat_server_timestamp_idx'),
        ]

class NetstatMetric(models.Model):
    server = models.ForeignKey(AIXServer, on_delete=models.CASCADE, related_name='netstat_metrics')
    timestamp = models.DateTimeField()
    interface = models.CharField(max_length=50)
    ipkts = models.IntegerField()
    ierrs = models.IntegerField()
    ipkts_rate = models.FloatField(null=True, blank=True)
    ierrs_rate = models.FloatField(null=True, blank=True)
    opkts = models.IntegerField()
    opkts_rate = models.FloatField(null=True, blank=True)
    oerrs = models.IntegerField()
    oerrs_rate = models.FloatField(null=True, blank=True)
    time = models.IntegerField()

    class Meta:
        db_table = 'netstat_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp'], name='netstat_server_timestamp_idx'),
            models.Index(fields=['interface'], name='netstat_interface_idx'),
        ]

class ProcessMetric(models.Model):
    server = models.ForeignKey(AIXServer, on_delete=models.CASCADE, related_name='process_metrics')
    timestamp = models.DateTimeField()
    pid = models.IntegerField()
    user = models.CharField(max_length=50)
    cpu = models.FloatField()
    mem = models.FloatField()
    command = models.CharField(max_length=255)

    class Meta:
        db_table = 'process_metrics'
        indexes = [
            models.Index(fields=['server', 'timestamp', 'pid']),
            models.Index(fields=['pid', 'timestamp']),
        ]