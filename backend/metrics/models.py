from django.db import models

class VmstatMetric(models.Model):
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
            models.Index(fields=['timestamp'], name='vmstat_timestamp_idx'),
        ]

class IostatMetric(models.Model):
    timestamp = models.DateTimeField()
    disk = models.CharField(max_length=50)
    tps = models.FloatField()
    kb_read = models.FloatField()
    kb_wrtn = models.FloatField()
    service_time = models.FloatField()

    class Meta:
        db_table = 'iostat_metrics'
        indexes = [
            models.Index(fields=['timestamp'], name='iostat_timestamp_idx'),
        ]

class NetstatMetric(models.Model):
    timestamp = models.DateTimeField()
    interface = models.CharField(max_length=50)
    ipkts = models.IntegerField()
    ierrs = models.IntegerField()
    opkts = models.IntegerField()
    oerrs = models.IntegerField()
    time = models.IntegerField()

    class Meta:
        db_table = 'netstat_metrics'
        indexes = [
            models.Index(fields=['timestamp'], name='netstat_timestamp_idx'),
            models.Index(fields=['interface'], name='netstat_interface_idx'),
        ]

class ProcessMetric(models.Model):
    timestamp = models.DateTimeField()
    pid = models.IntegerField()
    user = models.CharField(max_length=50)
    cpu = models.FloatField()
    mem = models.FloatField()
    command = models.CharField(max_length=255)

    class Meta:
        db_table = 'process_metrics'
        indexes = [
            models.Index(fields=['timestamp'], name='process_timestamp_idx'),
        ]