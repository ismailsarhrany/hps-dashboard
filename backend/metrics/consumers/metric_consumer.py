# metrics/consumers/metric_consumer.py
from confluent_kafka import Consumer
import json
from django.apps import apps
import os

class MetricConsumer:
    def __init__(self):
        bootstrap_servers = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
        self.conf = {
            'bootstrap.servers': bootstrap_servers,
            'group.id': 'metric_consumer',
            'auto.offset.reset': 'earliest'
        }
        self.consumer = Consumer(self.conf)
    
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
            
            # Convert nested data to model fields
            instance_data = {
                'timestamp': data['timestamp'],
                **data['data']
            }
            
            # Handle field name differences
            if msg.topic() == 'metrics_vmstat':
                instance_data['interface_in'] = instance_data.pop('in')
            
            model.objects.create(**instance_data)
            
        except Exception as e:
            print(f"Error processing message: {str(e)}")

