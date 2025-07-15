# metrics/management/commands/collect_vmstat.py
from django.core.management.base import BaseCommand
from metrics.producers.metric_producer import MetricProducer
from metrics.utils.ssh_client import AIXClient
# from metrics.utils.parsers import parse_vmstat
from metrics.utils.parsers import parse_vmstat
import time
import signal

class Command(BaseCommand):
    help = 'Collect VMStat metrics from AIX server'
    
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
    

    def handle(self, *args, **options):
        from metrics.models import Server
        servers = Server.objects.filter(monitoring_enabled=True)
        interval = options['interval']
        producer = MetricProducer()
        
        self.stdout.write(self.style.SUCCESS(f'Starting VMStat collection (interval: {interval}s'))
        
        try:
            while self.running:
                for server in servers:
                    try:
                        client = AIXClient(server.id)
                        output = client.execute('vmstat 1 1')
                        parsed = parse_vmstat(output)
                        
                        # Pass server ID to producer
                        producer.produce_metric(
                            str(server.id),
                            server.os_type,
                            'vmstat',
                            parsed
                        )
                        self.stdout.write(f"Collected VMStat for {server.hostname} at {time.strftime('%H:%M:%S')}")
                    
                    except Exception as e:
                        self.stderr.write(f"Error collecting VMStat for {server.hostname}: {str(e)}")
                    
                    finally:
                        if self.running:
                            time.sleep(interval)
                
        except KeyboardInterrupt:
            pass
        finally:
            self.cleanup_resources(producer)
    
    def cleanup_resources(self, producer):
        try:
            producer.close()
        except Exception as e:
            self.stderr.write(f"Error during cleanup: {str(e)}")
        self.stdout.write(self.style.SUCCESS('VMStat collection completed.'))

