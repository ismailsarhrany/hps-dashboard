# metrics/management/commands/collect_metrics.py
from django.core.management.base import BaseCommand
from metrics.producers.metric_producer import MetricProducer
from metrics.utils.ssh_client import AIXClient
from metrics.utils.parsers import parse_vmstat, parse_iostat, parse_netstat_i, parse_process
import time
import signal
import sys

class Command(BaseCommand):
    help = 'Collect metrics from AIX server and send to Kafka indefinitely until interrupted'
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.running = True
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)
    
    def handle_interrupt(self, sig, frame):
        """Handle interrupt signal (Ctrl+C)"""
        self.stdout.write(self.style.WARNING('Interrupt received. Stopping metrics collection...'))
        self.running = False
    
    def handle(self, *args, **options):
        producer = MetricProducer()
        client = AIXClient()
        
        self.stdout.write(self.style.SUCCESS('Starting metrics collection. Press Ctrl+C to stop.'))
        
        try:
            # Run indefinitely until interrupted
            while self.running:
                try:
                    # Collect vmstat metrics
                    try:
                        output = client.execute('vmstat 1 1')
                        parsed = parse_vmstat(output)
                        producer.produce_metric('vmstat', parsed)
                    except Exception as e:
                        self.stderr.write(f"Error collecting vmstat: {str(e)}")

                    # Collect iostat metrics
                    try:
                        iostat_output = client.execute('iostat -d 1 1')
                        iostat_metrics = parse_iostat(iostat_output)
                        for metric in iostat_metrics:
                            producer.produce_metric('iostat', metric)
                    except Exception as e:
                        self.stderr.write(f"Error collecting iostat: {str(e)}")
            
                    # Collect netstat metrics
                    try:
                        netstat_output = client.execute('netstat -i -n')
                        netstat_metrics = parse_netstat_i(netstat_output)
                        for metric in netstat_metrics:
                            producer.produce_metric('netstat', metric)
                    except Exception as e:
                        self.stderr.write(f"Error collecting netstat: {str(e)}")
            
                    # Collect process metrics
                    try:
                        # Use AIX-compatible ps aux command
                        process_output = client.execute('ps aux | sort -nrk 3 | head -10')
                        process_metrics = parse_process(process_output)
                        for metric in process_metrics:
                            producer.produce_metric('process', metric)
                    except Exception as e:
                        self.stderr.write(f"Error collecting process info: {str(e)}")
                    
                    # Add a small delay between collection cycles
                    # Adjust this value based on how frequently you want to collect metrics
                    # time.sleep(60)  # Collect metrics every 60 seconds
                    
                except Exception as e:
                    self.stderr.write(f"Error in collection cycle: {str(e)}")
                    # Sleep briefly before retrying after an error
                    time.sleep(5)
                    
        except Exception as e:
            self.stderr.write(f"Critical error: {str(e)}")
        finally:
            # Close resources properly
            try:
                # Only call close() if it exists as a method on the client
                if hasattr(client, 'close') and callable(client.close):
                    client.close()
            except Exception as e:
                self.stderr.write(f"Error closing client: {str(e)}")
                
            try:
                producer.close()
            except Exception as e:
                self.stderr.write(f"Error closing producer: {str(e)}")
                
        self.stdout.write(self.style.SUCCESS('Metrics collection completed.'))