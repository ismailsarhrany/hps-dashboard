# metrics/consumers/metric_consumer.py
from confluent_kafka import Consumer
import json
from django.apps import apps
import os
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

class MetricConsumer:
    def __init__(self):
        bootstrap_servers = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
        self.conf = {
            'bootstrap.servers': bootstrap_servers,
            'group.id': 'metric_consumer',
            'auto.offset.reset': 'earliest',
            'enable.auto.commit': 'false'
        }
        self.consumer = Consumer(self.conf)
        self.channel_layer = get_channel_layer()
    
    def process_message(self, msg):
        model_map = {
            'metrics_vmstat': 'VmstatMetric',
            'metrics_iostat': 'IostatMetric',
            'metrics_netstat': 'NetstatMetric',
            'metrics_process': 'ProcessMetric'
        }
        
        try:
            data = json.loads(msg.value())
            model_name = model_map[msg.topic()]
            model = apps.get_model('metrics', model_name)
            
            instance_data = {
                'timestamp': data['timestamp'],
                **data['data']
            }
            
            if msg.topic() == 'metrics_vmstat':
                instance_data['interface_in'] = instance_data.pop('in')
            
            # Save to database
            model.objects.create(**instance_data)
            
            # Broadcast via WebSocket
            async_to_sync(self.channel_layer.group_send)(
                "metrics",
                {
                    "type": "metric.update",
                    "data": {
                        "metric": msg.topic().replace('metrics_', ''),
                        "timestamp": instance_data['timestamp'],
                        "values": instance_data
                    }
                }
            )
            
        except Exception as e:
            print(f"Error processing message: {str(e)}")