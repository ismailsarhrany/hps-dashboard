# metrics/management/commands/collect_all_servers.py
from django.core.management.base import BaseCommand
from metrics.producers.metric_producer import MetricProducer
from metrics.utils.multi_parsers import parse_vmstat, parse_iostat, parse_netstat, parse_process
import time
import signal
import threading
from datetime import datetime
from collections import defaultdict

class Command(BaseCommand):
    help = 'Collect all metrics from all active servers (unified collector)'
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.running = True
        self.collectors = {}  # server_id -> collector_info
        self.lock = threading.Lock()
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)
    
    def add_arguments(self, parser):
        parser.add_argument('--interval', type=int, default=30, help='Collection interval (default: 30s)')
        parser.add_argument('--sync-interval', type=int, default=300, help='Server sync interval (default: 300s)')
        parser.add_argument('--stagger', type=int, default=5, help='Stagger servers by X seconds (default: 5s)')
    
    def handle_interrupt(self, sig, frame):
        self.stdout.write(self.style.WARNING('Stopping all collectors...'))
        self.running = False
    
    def handle(self, *args, **options):
        interval = options['interval']
        sync_interval = options['sync_interval']
        stagger = options['stagger']
        
        producer = MetricProducer()
        
        self.stdout.write(self.style.SUCCESS(
            f'Starting unified collector (interval: {interval}s, sync: {sync_interval}s, stagger: {stagger}s)'
        ))
        
        # Start server sync thread
        sync_thread = threading.Thread(target=self.sync_servers, args=(producer, interval, stagger))
        sync_thread.daemon = True
        sync_thread.start()
        
        try:
            # Initial sync
            self.sync_active_servers(producer, interval, stagger)
            
            # Keep main thread alive and show status
            last_status = time.time()
            while self.running:
                time.sleep(10)
                
                # Show status every 60 seconds
                if time.time() - last_status > 60:
                    with self.lock:
                        active_count = len(self.collectors)
                    self.stdout.write(f"Status: {active_count} servers being monitored")
                    last_status = time.time()
                    
        except KeyboardInterrupt:
            pass
        finally:
            self.cleanup_all(producer)
    
    def sync_servers(self, producer, interval, stagger):
        """Periodically sync active servers"""
        while self.running:
            try:
                time.sleep(300)  # Sync every 5 minutes
                if self.running:
                    self.sync_active_servers(producer, interval, stagger)
            except Exception as e:
                self.stderr.write(f"Error in server sync: {e}")
    
    def sync_active_servers(self, producer, interval, stagger):
        """Add/remove collectors based on active servers"""
        try:
            from metrics.models import Server
            active_servers = Server.objects.filter(monitoring_enabled=True)
            active_server_ids = {str(server.id) for server in active_servers}
            
            with self.lock:
                current_server_ids = set(self.collectors.keys())
                
                # Add new servers
                new_servers = active_server_ids - current_server_ids
                for server in active_servers:
                    server_id = str(server.id)
                    if server_id in new_servers:
                        self.start_server_collector(server, producer, interval, stagger)
                
                # Remove deleted/disabled servers
                removed_servers = current_server_ids - active_server_ids
                for server_id in removed_servers:
                    self.stop_server_collector(server_id)
                
                if new_servers or removed_servers:
                    self.stdout.write(f"Servers updated: +{len(new_servers)} -{len(removed_servers)} (Total: {len(active_server_ids)})")
                    
        except Exception as e:
            self.stderr.write(f"Error syncing servers: {e}")
    
    def start_server_collector(self, server, producer, interval, stagger):
        """Start collector thread for a server"""
        server_id = str(server.id)
        
        # Create collector thread
        thread = threading.Thread(
            target=self.collect_server_loop,
            args=(server, producer, interval),
            name=f"collector-{server.hostname}"
        )
        thread.daemon = True
        
        # Store collector info
        self.collectors[server_id] = {
            'server': server,
            'thread': thread,
            'start_time': time.time()
        }
        
        # Start with stagger to avoid thundering herd
        time.sleep(len(self.collectors) * stagger)
        thread.start()
        
        self.stdout.write(f"✓ Started collector for {server.hostname} ({server_id})")
    
    def stop_server_collector(self, server_id):
        """Stop collector for a server"""
        if server_id in self.collectors:
            server_name = self.collectors[server_id]['server'].hostname
            del self.collectors[server_id]  # Thread will stop when it checks self.running
            self.stdout.write(f"✓ Stopped collector for {server_name} ({server_id})")
    
    def collect_server_loop(self, server, producer, interval):
        """Main collection loop for a single server"""
        server_id = str(server.id)
        client = None
        
        try:
            from metrics.utils.ssh_client import get_ssh_client
            client = get_ssh_client(server_id)
            
            while self.running and server_id in self.collectors:
                try:
                    timestamp = datetime.now()
                    metrics_collected = 0
                    
                    # Collect all metrics in one go
                    metrics_data = self.collect_all_metrics(client, server, timestamp)
                    
                    # Send to Kafka
                    for metric_type, data in metrics_data.items():
                        if data:  # Only send if we have data
                            if isinstance(data, list):
                                for item in data:
                                    producer.produce_metric(server_id, server.os_type, metric_type, item)
                                    metrics_collected += len(data)
                            else:
                                producer.produce_metric(server_id, server.os_type, metric_type, data)
                                metrics_collected += 1
                    
                    if metrics_collected > 0:
                        self.stdout.write(f"✓ {server.hostname}: {metrics_collected} metrics at {time.strftime('%H:%M:%S')}")
                    
                    # Wait for next interval
                    time.sleep(interval)
                    
                except Exception as e:
                    self.stderr.write(f"✗ {server.hostname}: {str(e)}")
                    time.sleep(min(30, interval))  # Wait before retry, max 30s
                    
        except Exception as e:
            self.stderr.write(f"Fatal error for {server.hostname}: {e}")
        finally:
            if client:
                try:
                    client.close()
                except:
                    pass
    
    def collect_all_metrics(self, client, server, timestamp):
        """Collect all metric types for a server"""
        metrics_data = {}
        
        # VMStat
        try:
            result = client.execute('vmstat 1 1')
            output = result[1] if isinstance(result, tuple) else result
            metrics_data['vmstat'] = parse_vmstat(output, server.os_type, timestamp)
        except Exception as e:
            self.stderr.write(f"VMStat error for {server.hostname}: {e}")
        
        # IOStat
        try:
            result = client.execute('iostat -d 1 1')
            output = result[1] if isinstance(result, tuple) else result
            metrics_data['iostat'] = parse_iostat(output, server.os_type, timestamp)
        except Exception as e:
            self.stderr.write(f"IOStat error for {server.hostname}: {e}")
        
        # Netstat
        try:
            result = client.execute('netstat -i -n')
            output = result[1] if isinstance(result, tuple) else result
            metrics_data['netstat'] = parse_netstat(output, server.os_type, timestamp)
        except Exception as e:
            self.stderr.write(f"Netstat error for {server.hostname}: {e}")
        
        # Process
        try:
            result = client.execute('ps aux | sort -nrk 3 | head -10')
            output = result[1] if isinstance(result, tuple) else result
            metrics_data['process'] = parse_process(output, server.os_type, timestamp)
        except Exception as e:
            self.stderr.write(f"Process error for {server.hostname}: {e}")
        
        return metrics_data
    
    def cleanup_all(self, producer):
        """Clean up all resources"""
        self.stdout.write("Cleaning up collectors...")
        with self.lock:
            active_collectors = len(self.collectors)
            self.collectors.clear()
        
        if producer:
            try:
                producer.close()
            except:
                pass
        
        self.stdout.write(f"✓ Stopped {active_collectors} collectors")