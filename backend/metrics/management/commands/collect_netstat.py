# metrics/management/commands/collect_netstat.py
from django.core.management.base import BaseCommand
from metrics.producers.metric_producer import MetricProducer
from metrics.utils.ssh_client import AIXClient
# from metrics.utils.parsers import parse_netstat_i
from metrics.utils.multi_parsers import parse_netstat
import time
import signal

class Command(BaseCommand):
    help = 'Collect Netstat metrics from AIX server'
    
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
            help='Collection interval in seconds (default: 15)'
        )
    
    def handle_interrupt(self, sig, frame):
        self.stdout.write(self.style.WARNING('Stopping Netstat collection...'))
        self.running = False
    
    def handle(self, *args, **options):
        from metrics.models import Server
        servers = Server.objects.filter(monitoring_enabled=True)
        interval = options['interval']
        producer = MetricProducer()
        
        self.stdout.write(self.style.SUCCESS(f'Starting Netstat collection (interval: {interval}s)'))
        
        try:
            while self.running:
                for server in servers:
                    try:
                        client = AIXClient(server.id)
                        output = client.execute('netstat -i -n')
                        metrics = parse_netstat(output)
                        for metric in metrics:
                            producer.produce_metric(str(server.id),server.os_type,'netstat', metric)
                        self.stdout.write(f"Netstat metrics collected for {server.hostname}  at {time.strftime('%H:%M:%S')}")
                    
                        if self.running:
                            time.sleep(interval)
                        
                    except Exception as e:
                        self.stderr.write(f"Error collecting Netstat  for {server.hostname} : {str(e)}")
                        time.sleep(5)
                    
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
        
        self.stdout.write(self.style.SUCCESS('Netstat collection completed.'))


