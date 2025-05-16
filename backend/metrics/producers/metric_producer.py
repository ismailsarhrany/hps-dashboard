# metrics/producers/metric_producer.py
from confluent_kafka import Producer
import json
from datetime import datetime
import os
import pytz
from django.conf import settings

class MetricProducer:
    def __init__(self):
        
        bootstrap_servers = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')

        self.producer = Producer({
            'bootstrap.servers': bootstrap_servers
        })

    def produce_metric(self, metric_type, data):
        topic = f'metrics_{metric_type}'
        timestamp = datetime.now()
    
        # Make timestamp timezone-aware
        if settings.USE_TZ:
            timestamp = timestamp.replace(tzinfo=pytz.timezone(settings.TIME_ZONE))
        
        self.producer.produce(
            topic=topic,
            value=json.dumps({
                'timestamp': timestamp.isoformat(),
                'data': data
            })
        )
        self.producer.flush()