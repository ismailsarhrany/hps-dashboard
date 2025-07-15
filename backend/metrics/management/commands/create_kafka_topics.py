# Add to metrics/management/commands/create_kafka_topics.py
from django.core.management.base import BaseCommand
from confluent_kafka.admin import AdminClient, NewTopic
import os

class Command(BaseCommand):
    help = 'Create Kafka topics if they do not exist'
    
    def handle(self, *args, **options):
        bootstrap_servers = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        admin_client = AdminClient({'bootstrap.servers': bootstrap_servers})
        
        from metrics.models import Server
        topics = []
        
        # Create topics for all active servers
        for server in Server.objects.filter(monitoring_enabled=True):
            server_id = str(server.id)
            topics.append(f"metrics_vmstat_{server_id}")
            topics.append(f"metrics_iostat_{server_id}")
            topics.append(f"metrics_netstat_{server_id}")
            topics.append(f"metrics_process_{server_id}")
            
        new_topics = [NewTopic(topic, num_partitions=3, replication_factor=1) for topic in topics]
        
        # Create topics
        fs = admin_client.create_topics(new_topics)
        
        # Wait for each operation to complete
        for topic, f in fs.items():
            try:
                f.result()  # Waiting for result
                self.stdout.write(self.style.SUCCESS(f"Topic {topic} created successfully"))
            except Exception as e:
                if "already exists" in str(e):
                    self.stdout.write(f"Topic {topic} already exists")
                else:
                    self.stderr.write(f"Failed to create topic {topic}: {e}")