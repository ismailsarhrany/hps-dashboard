# metrics/management/commands/collect_iostat.py
from django.core.management.base import BaseCommand
from metrics.producers.metric_producer import MetricProducer
# from metrics.utils.ssh_client import AIXClient
# from metrics.utils.parsers import parse_iostat
from metrics.utils.multi_parsers import parse_iostat
import time
import signal
from datetime import datetime

class Command(BaseCommand):
    help = 'Collect IOStat metrics from AIX server'
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.running = True
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)
    
    def add_arguments(self, parser):
        parser.add_argument(
            '--interval',
            type=int,
            default=5,
            help='Collection interval in seconds (default: 5)'
        )
    
    def handle_interrupt(self, sig, frame):
        self.stdout.write(self.style.WARNING('Stopping IOStat collection...'))
        self.running = False
    
    def handle(self, *args, **options):
        from metrics.models import Server
        servers = Server.objects.filter(monitoring_enabled=True)
        interval = options['interval']
        producer = MetricProducer()
        
        
        self.stdout.write(self.style.SUCCESS(f'Starting IOStat collection (interval: {interval}s)'))
        
        try:
            while self.running:
                for server in servers:
                    try:
                        from metrics.utils.ssh_client import get_ssh_client
                        client = get_ssh_client(str(server.id))
                        # After
                        result = client.execute('iostat -d 1 1')
                        output = result[1] if isinstance(result, tuple) else result  # Extract stdout
                        metrics = parse_iostat(output, server.os_type, datetime.now())
                        for      metric in metrics:
                            producer.produce_metric(str(server.id),server.os_type,'iostat', metric)
                        self.stdout.write(f"iostat metrics collected for {server.hostname}  at {time.strftime('%H:%M:%S')}")
                    
                        if self.running:
                            time.sleep(interval)
                        
                    except Exception as e:
                        self.stderr.write(f"Error collecting iostat  for {server.hostname} : {str(e)}")
                        time.sleep(5)
                    
        except KeyboardInterrupt:
            pass
        finally:
            self.cleanup_resources(client, producer)
    
    def cleanup_resources(self,client=None ,producer=None):
        if client:
            try:
                client.close()
            except Exception as e:
                self.stderr.write(f"Error closing SSH client: {str(e)}")
        try:
            producer.close()
        except Exception as e:
            self.stderr.write(f"Error during cleanup: {str(e)}")
        self.stdout.write(self.style.SUCCESS('VMStat collection completed.'))


