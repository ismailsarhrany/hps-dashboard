# metrics/management/commands/start_consumer.py
from django.core.management.base import BaseCommand
from metrics.consumers.metric_consumer import MetricConsumer
import signal
import datetime
import json


class Command(BaseCommand):
    help = 'Start Kafka consumer for metric processing'
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.running = True
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self.handle_interrupt)
        signal.signal(signal.SIGTERM, self.handle_interrupt)
        self.message_count = 0
        self.topic_counters = {
            'metrics_vmstat': 0,
            'metrics_iostat': 0,
            'metrics_netstat': 0,
            'metrics_process': 0
        }
    
    def handle_interrupt(self, sig, frame):
        """Handle interrupt signal (Ctrl+C)"""
        self.stdout.write(self.style.WARNING('Interrupt received. Stopping consumer...'))
        self.running = False
    
    def handle(self, *args, **options):
        consumer = MetricConsumer()
        # Dynamically get topics for all active servers
        from metrics.models import Server
        topics = []
        for server in Server.objects.filter(monitoring_enabled=True):
            if not server.id:  # Skip invalid servers
                continue
            server_id = str(server.id)
            topics.append(f"metrics_vmstat_{server_id}")
            topics.append(f"metrics_iostat_{server_id}")
            topics.append(f"metrics_netstat_{server_id}")
            topics.append(f"metrics_process_{server_id}")
        
        consumer.consumer.subscribe(topics)     
        
        self.stdout.write(self.style.SUCCESS(f"Starting Kafka consumer, subscribed to topics: {', '.join(topics)}"))
        self.stdout.write(self.style.SUCCESS("Waiting for messages... Press Ctrl+C to stop."))
        
        try:
            while self.running:
                msg = consumer.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    self.stderr.write(self.style.ERROR(f"Consumer error: {msg.error()}"))
                    continue
                
                # Process the message
                try:
                    topic = msg.topic()
                    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Track message count by topic
                    self.message_count += 1
                    self.topic_counters[topic] += 1
                    
                    # Get a sample of the data for debugging
                    value = json.loads(msg.value().decode('utf-8'))
                    metric_type = topic.replace('metrics_', '')
                    
                    # Display a nice message about the received metric
                    self.stdout.write(f"[{timestamp}] Received {metric_type} metric (#{self.message_count})")
                    
                    # Process the message with your consumer logic
                    consumer.process_message(msg)
                    
                    # Show a summary every 10 messages
                    if self.message_count % 10 == 0:
                        self.stdout.write(self.style.SUCCESS(
                            f"Stats: {self.message_count} messages processed total "
                            f"(VMStat: {self.topic_counters['metrics_vmstat']}, "
                            f"IOStat: {self.topic_counters['metrics_iostat']}, "
                            f"NetStat: {self.topic_counters['metrics_netstat']}, "
                            f"Process: {self.topic_counters['metrics_process']})"
                        ))
                        
                except Exception as e:
                    self.stderr.write(self.style.ERROR(f"Error processing message: {str(e)}"))
                    
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Interrupt received. Shutting down..."))
        finally:
            self.stdout.write("Closing consumer...")
            consumer.consumer.close()
            
            # Print summary before exiting
            self.stdout.write(self.style.SUCCESS(
                f"Consumer shutdown complete. Processed {self.message_count} messages total:\n"
                f"- VMStat: {self.topic_counters['metrics_vmstat']}\n"
                f"- IOStat: {self.topic_counters['metrics_iostat']}\n"
                f"- NetStat: {self.topic_counters['metrics_netstat']}\n"
                f"- Process: {self.topic_counters['metrics_process']}"
            ))