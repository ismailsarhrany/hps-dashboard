# app/metrics/management/commands/import_sqlite.py
import json
import os
from django.core.management.base import BaseCommand
from django.conf import settings
from metrics.models import VmstatMetric, IostatMetric,NetstatMetric,ProcessMetric  # Import all your models

class Command(BaseCommand):
    help = 'Import SQLite data from JSON files'
    batch_size = 1000

    def handle(self, *args, **options):
        migration_dir = os.path.join("D:\projet\migration_data")
        
        # Example for vmstat_metrics
        with open(os.path.join(migration_dir, 'vmstat_metrics.json')) as f:
            data = json.load(f)
            batch = []
            for row in data:
                batch.append(VmstatMetric(
                    timestamp=row[0],
                    r=row[1],
                    b=row[2],
                    avm=row[3],
                    fre=row[4],
                    pi=row[5],
                    po=row[6],
                    fr=row[7],
                    interface_in=row[8],  # 'in' is a reserved word, use interface_in
                    cs=row[9],
                    us=row[10],
                    sy=row[11],
                    idle=row[12],
                ))
                if len(batch) >= self.batch_size:
                    VmstatMetric.objects.bulk_create(batch)
                    batch = []
            if batch:
                VmstatMetric.objects.bulk_create(batch)
            self.stdout.write(f"Imported {len(data)} vmstat records")

        # Repeat for other metric types
        # Example for iostat_metrics
        with open(os.path.join(migration_dir, 'iostat_metrics.json')) as f:
            data = json.load(f)
            batch = []
            for row in data:
                batch.append(IostatMetric(
                    timestamp=row[0],
                    disk=row[1],
                    tps=row[2],
                    kb_read=row[3],
                    kb_wrtn=row[4],
                    service_time=row[5],
                ))
                if len(batch) >= self.batch_size:
                    IostatMetric.objects.bulk_create(batch)
                    batch = []
            if batch:
                IostatMetric.objects.bulk_create(batch)
            self.stdout.write(f"Imported {len(data)} iostat records")

            #netstat
        with open(os.path.join(migration_dir, 'netstat_metrics.json')) as f:
            data = json.load(f)
            batch = []
            for row in data:
                batch.append(NetstatMetric(
                    timestamp=row[0],
                    interface=row[1],
                    ipkts=row[2],
                    ierrs=row[3],
                    opkts=row[4],
                    oerrs=row[5],
                    coll=row[6],
                ))
                if len(batch) >= self.batch_size:
                    NetstatMetric.objects.bulk_create(batch)
                    batch = []
            if batch:
                NetstatMetric.objects.bulk_create(batch)
            self.stdout.write(f"Imported {len(data)} netstat records")

        with open(os.path.join(migration_dir, 'process_metrics.json')) as f:
            data = json.load(f)
            batch = []
            for row in data:
                batch.append(ProcessMetric(
                    timestamp=row[0],
                    pid=row[1],
                    user=row[2],
                    cpu=row[3],
                    mem=row[4],
                    command=row[5],
                ))
                if len(batch) >= self.batch_size:
                    ProcessMetric.objects.bulk_create(batch)
                    batch = []
            if batch:
                ProcessMetric.objects.bulk_create(batch)
            self.stdout.write(f"Imported {len(data)} ps records")