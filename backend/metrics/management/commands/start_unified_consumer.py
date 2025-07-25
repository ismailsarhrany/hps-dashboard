# metrics/management/commands/start_unified_consumer.py
from django.core.management.base import BaseCommand
from metrics.consumers.metric_consumer import MetricConsumer
import signal
import datetime
import json
from collections import defaultdict
import time

class Command(BaseCommand):
    help = 'Start unified Kafka consumer for all metric types from all servers'
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.running = True
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)
        self.message_count = 0
        self.topic_counters = defaultdict(int)
        self.server_counters = defaultdict(int)
        self.last_sync = 0
    
    def handle_interrupt(self, sig, frame):
        self.stdout.write(self.style.WARNING('Interrupt received. Stopping consumer...'))
        self.running = False
    
    def handle(self, *args, **options):
        consumer = MetricConsumer()
        
        # Subscribe to all topics for all active servers
        topics = self.get_all_topics()
        consumer.consumer.subscribe(topics)
        
        self.stdout.write(self.style.SUCCESS(f"Unified consumer started, monitoring {len(topics)} topics"))
        self.stdout.write(self.style.SUCCESS("Waiting for messages... Press Ctrl+C to stop."))
        
        try:
            while self.running:
                # Periodically resync topics (every 5 minutes)
                if time.time() - self.last_sync > 300:
                    new_topics = self.get_all_topics()
                    if set(new_topics) != set(topics):
                        consumer.consumer.subscribe(new_topics)
                        topics = new_topics
                        self.stdout.write(f"Topics updated: now monitoring {len(topics)} topics")
                    self.last_sync = time.time()
                
                msg = consumer.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    self.stderr.write(self.style.ERROR(f"Consumer error: {msg.error()}"))
                    continue
                
                try:
                    topic = msg.topic()
                    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Parse topic to get metric type and server
                    topic_parts = topic.split('_')
                    if len(topic_parts) >= 3:
                        metric_type = topic_parts[1]  # vmstat, iostat, etc.
                        server_id = topic_parts[2]    # server ID
                        
                        # Track statistics
                        self.message_count += 1
                        self.topic_counters[metric_type] += 1
                        self.server_counters[server_id] += 1
                        
                        # Process the message
                        consumer.process_message(msg)
                        
                        # Show progress every 20 messages
                        if self.message_count % 20 == 0:
                            self.show_stats()
                    
                except Exception as e:
                    self.stderr.write(self.style.ERROR(f"Error processing message: {str(e)}"))
                    
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Interrupt received. Shutting down..."))
        finally:
            self.stdout.write("Closing consumer...")
            consumer.consumer.close()
            self.show_final_stats()
    
    def get_all_topics(self):
        """Get all topics for active servers"""
        try:
            from metrics.models import Server
            topics = []
            
            for server in Server.objects.filter(monitoring_enabled=True):
                if server.id:  # Valid server
                    server_id = str(server.id)
                    topics.extend([
                        f"metrics_vmstat_{server_id}",
                        f"metrics_iostat_{server_id}",
                        f"metrics_netstat_{server_id}",
                        f"metrics_process_{server_id}"
                    ])
            
            return topics
            
        except Exception as e:
            self.stderr.write(f"Error getting topics: {e}")
            return []
    
    def show_stats(self):
        """Show current processing statistics"""
        active_servers = len(self.server_counters)
        
        metric_stats = ", ".join([
            f"{metric}: {count}" 
            for metric, count in sorted(self.topic_counters.items())
        ])
        
        self.stdout.write(self.style.SUCCESS(
            f"[{datetime.datetime.now().strftime('%H:%M:%S')}] "
            f"Processed {self.message_count} messages from {active_servers} servers | {metric_stats}"
        ))
    
    def show_final_stats(self):
        """Show final statistics before shutdown"""
        self.stdout.write(self.style.SUCCESS("\n=== Final Statistics ==="))
        self.stdout.write(f"Total messages processed: {self.message_count}")
        self.stdout.write(f"Active servers monitored: {len(self.server_counters)}")
        
        self.stdout.write("\nMetrics breakdown:")
        for metric_type, count in sorted(self.topic_counters.items()):
            self.stdout.write(f"  {metric_type}: {count} messages")
        
        self.stdout.write(f"\nTop servers by activity:")
        sorted_servers = sorted(self.server_counters.items(), key=lambda x: x[1], reverse=True)
        for server_id, count in sorted_servers[:10]:  # Top 10
            try:
                from metrics.models import Server
                server = Server.objects.get(id=server_id)
                self.stdout.write(f"  {server.hostname} ({server_id}): {count} messages")
            except:
                self.stdout.write(f"  Server {server_id}: {count} messages")
        
        self.stdout.write(self.style.SUCCESS("Consumer shutdown complete."))