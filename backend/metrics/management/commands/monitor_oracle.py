# backend/monitoring/management/commands/monitor_oracle.py

import time
import signal
import logging
from django.core.management.base import BaseCommand
from django.conf import settings
from services.oracle_service import OracleService

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Monitor Oracle databases and collect data in real-time'
    
    def __init__(self):
        super().__init__()
        self.oracle_service = OracleService()
        self.running = True

    def add_arguments(self, parser):
        parser.add_argument(
            '--interval',
            type=int,
            default=30,
            help='Global polling interval in seconds (default: 30)'
        )
        parser.add_argument(
            '--database-id',
            type=int,
            help='Monitor specific database by ID'
        )
        parser.add_argument(
            '--table-id',
            type=int,
            help='Monitor specific table by ID'
        )
        parser.add_argument(
            '--once',
            action='store_true',
            help='Run once and exit (don\'t loop)'
        )

    def handle(self, *args, **options):
        # Set up signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        self.stdout.write(
            self.style.SUCCESS('Starting Oracle monitoring service...')
        )
        
        interval = options['interval']
        database_id = options.get('database_id')
        table_id = options.get('table_id')
        run_once = options.get('once', False)
        
        try:
            if run_once:
                self._run_once(database_id, table_id)
            else:
                self._run_continuous(interval, database_id, table_id)
        except KeyboardInterrupt:
            self.stdout.write(
                self.style.WARNING('Received interrupt signal, shutting down...')
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Error in Oracle monitoring: {e}')
            )
            logger.error(f'Error in Oracle monitoring: {e}', exc_info=True)
        finally:
            self.stdout.write(
                self.style.SUCCESS('Oracle monitoring service stopped.')
            )

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        self.stdout.write(
            self.style.WARNING(f'Received signal {signum}, shutting down gracefully...')
        )
        self.running = False

    def _run_once(self, database_id=None, table_id=None):
        """Run monitoring once and exit"""
        if table_id:
            self._monitor_specific_table(table_id)
        elif database_id:
            self._monitor_specific_database(database_id)
        else:
            self._monitor_all_tables()

    def _run_continuous(self, interval, database_id=None, table_id=None):
        """Run monitoring continuously"""
        self.stdout.write(
            self.style.SUCCESS(f'Monitoring every {interval} seconds...')
        )
        
        while self.running:
            try:
                start_time = time.time()
                
                if table_id:
                    self._monitor_specific_table(table_id)
                elif database_id:
                    self._monitor_specific_database(database_id)
                else:
                    self._monitor_all_tables()
                
                # Calculate sleep time to maintain interval
                execution_time = time.time() - start_time
                sleep_time = max(0, interval - execution_time)
                
                if sleep_time > 0 and self.running:
                    time.sleep(sleep_time)
                    
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f'Error in monitoring loop: {e}')
                )
                logger.error(f'Error in monitoring loop: {e}', exc_info=True)
                # Sleep a bit before retrying
                if self.running:
                    time.sleep(5)

    def _monitor_all_tables(self):
        """Monitor all active Oracle tables"""
        self.stdout.write('Monitoring all active Oracle tables...')
        
        results = self.oracle_service.monitor_all_active_tables()
        
        for result in results:
            table_name = result['table_name']
            table_result = result['result']
            
            if table_result['success']:
                changes = "with changes" if table_result.get('changes_detected') else "no changes"
                self.stdout.write(
                    self.style.SUCCESS(
                        f'✓ {table_name}: {table_result["record_count"]} records ({changes})'
                    )
                )
            else:
                self.stdout.write(
                    self.style.ERROR(
                        f'✗ {table_name}: {table_result.get("error", "Unknown error")}'
                    )
                )

    def _monitor_specific_database(self, database_id):
        """Monitor all tables in a specific database"""
        from monitoring.models import OracleDatabase, OracleTable
        
        try:
            database = OracleDatabase.objects.get(id=database_id, is_active=True)
            tables = OracleTable.objects.filter(database=database, is_active=True)
            
            self.stdout.write(f'Monitoring database: {database}')
            
            for table in tables:
                if self._should_poll_table(table):
                    result = self.oracle_service.monitor_table(table)
                    
                    if result['success']:
                        changes = "with changes" if result.get('changes_detected') else "no changes"
                        self.stdout.write(
                            self.style.SUCCESS(
                                f'✓ {table}: {result["record_count"]} records ({changes})'
                            )
                        )
                    else:
                        self.stdout.write(
                            self.style.ERROR(
                                f'✗ {table}: {result.get("error", "Unknown error")}'
                            )
                        )
                        
        except OracleDatabase.DoesNotExist:
            self.stdout.write(
                self.style.ERROR(f'Database with ID {database_id} not found or inactive')
            )

    def _monitor_specific_table(self, table_id):
        """Monitor a specific table"""
        from monitoring.models import OracleTable
        
        try:
            table = OracleTable.objects.get(id=table_id, is_active=True)
            self.stdout.write(f'Monitoring table: {table}')
            
            result = self.oracle_service.monitor_table(table)
            
            if result['success']:
                changes = "with changes" if result.get('changes_detected') else "no changes"
                self.stdout.write(
                    self.style.SUCCESS(
                        f'✓ {table}: {result["record_count"]} records ({changes})'
                    )
                )
            else:
                self.stdout.write(
                    self.style.ERROR(
                        f'✗ {table}: {result.get("error", "Unknown error")}'
                    )
                )
                
        except OracleTable.DoesNotExist:
            self.stdout.write(
                self.style.ERROR(f'Table with ID {table_id} not found or inactive')
            )

    def _should_poll_table(self, table):
        """Check if table should be polled based on its individual polling interval"""
        from datetime import timedelta
        from django.utils import timezone
        
        if not table.last_poll_time:
            return True
        
        next_poll_time = table.last_poll_time + timedelta(seconds=table.polling_interval)
        return timezone.now() >= next_poll_time