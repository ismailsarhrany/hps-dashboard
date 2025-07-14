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
    
    def handle_interrupt(self, sig, frame):
        self.stdout.write(self.style.WARNING('Stopping VMStat collection...'))
        self.running = False
    
    def handle(self, *args, **options):
        interval = options['interval']
        producer = MetricProducer()
        client = AIXClient()
        
        self.stdout.write(self.style.SUCCESS(f'Starting VMStat collection (interval: {interval}s)'))
        
        try:
            while self.running:
                try:
                    output = client.execute('vmstat 1 1')
                    parsed = parse_vmstat(output)
                    producer.produce_metric('vmstat', parsed)
                    self.stdout.write(f"VMStat metric collected at {time.strftime('%H:%M:%S')}")
                    
                    if self.running:  # Check if still running before sleeping
                        time.sleep(interval)
                        
                except Exception as e:
                    self.stderr.write(f"Error collecting VMStat: {str(e)}")
                    time.sleep(5)  # Brief pause before retry
                    
        except KeyboardInterrupt:
            pass
        finally:
            self.cleanup_resources(client, producer)
    
    def cleanup_resources(self, client, producer):
        try:
            if hasattr(client, 'close') and callable(client.close):
                client.close()
            producer.close()
        except Exception as e:
            self.stderr.write(f"Error during cleanup: {str(e)}")
        
        self.stdout.write(self.style.SUCCESS('VMStat collection completed.'))


