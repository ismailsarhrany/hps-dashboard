# metrics/consumers/metric_consumer.py
import json
import os
import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta
import pytz

from confluent_kafka import Consumer
from django.apps import apps
from django.conf import settings
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)

class MetricConsumer:
    def __init__(self):
        bootstrap_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
        self.conf = {
            "bootstrap.servers": bootstrap_servers,
            "group.id": "metric_consumer_group",
            "auto.offset.reset": "earliest",
            "enable.auto.commit": "false",
            "max.poll.interval.ms": 300000,  # 5 minutes
            "session.timeout.ms": 10000      # 10 seconds
        }
        
        try:
            self.consumer = Consumer(self.conf)
            logger.info(f"Kafka Consumer initialized with config: {self.conf}")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka Consumer: {e}")
            self.consumer = None
            return
            
        self.channel_layer = get_channel_layer()
        self.running = True
        
        # Simple message ordering without complex batching
        self.message_queues = defaultdict(list)
        self.queue_lock = threading.Lock()
        self.last_sent_sequence = defaultdict(int)

    def _send_message_immediately(self, metric_type, message_data):
        """Send message immediately while maintaining order."""
        try:
            sequence_id = message_data.get("sequence_id", 0)
            
            # Simple ordering check
            if sequence_id <= self.last_sent_sequence[metric_type]:
                logger.warning(f"Skipping out-of-order message for {metric_type}: "
                             f"{sequence_id} <= {self.last_sent_sequence[metric_type]}")
                return
            
            # Send to WebSocket
            group_name = f"{metric_type}_metrics"
            
            async_to_sync(self.channel_layer.group_send)(group_name, {
                "type": f"{metric_type}_update",
                "data": {
                    "metric": metric_type,
                    "timestamp": message_data["timestamp"],
                    "values": message_data["values"],
                    "id": message_data.get("id"),
                    "sequence_id": sequence_id
                }
            })
            
            # Update last sent sequence
            self.last_sent_sequence[metric_type] = sequence_id
            logger.debug(f"Sent {metric_type} message with sequence_id {sequence_id}")
            
        except Exception as e:
            logger.error(f"Error sending message for {metric_type}: {e}")

    def process_message(self, msg):
        """Simplified message processing without complex batching."""
        if not self.running:
            return
             
        model_map = {
            "metrics_vmstat": "VmstatMetric",
            "metrics_iostat": "IostatMetric", 
            "metrics_netstat": "NetstatMetric",
            "metrics_process": "ProcessMetric"
        }
        
        try:
            data = json.loads(msg.value().decode("utf-8"))
            topic = msg.topic()
            
            if topic not in model_map:
                logger.warning(f"Received message from unmapped topic: {topic}")
                self.consumer.commit(msg)
                return
                
            model_name = model_map[topic]
            model = apps.get_model("metrics", model_name)
            metric_type = topic.replace("metrics_", "")
            
            # Validate timestamp and sequence
            original_timestamp = data.get("timestamp")
            sequence_id = data.get("sequence_id", 0)
            
            if not original_timestamp:
                logger.warning(f"Message missing timestamp for {topic}")
                self.consumer.commit(msg)
                return
            
            # Prepare data for DB insertion
            instance_data = {
                "timestamp": original_timestamp,
                **data["data"]
            }
            
            # Handle special field mapping for vmstat
            if topic == "metrics_vmstat":
                if "in" in instance_data:
                    instance_data["interface_in"] = instance_data.pop("in")
            
            # Database saving
            try:
                instance = model.objects.create(**instance_data)
                db_id = instance.id
                logger.debug(f"Saved {topic} metric to database (ID: {db_id})")
            except Exception as db_err:
                logger.error(f"Error saving {topic} metric to database: {db_err}")
                db_id = None

            # Send immediately with ordering check
            message_data = {
                "timestamp": original_timestamp,
                "values": instance_data,
                "id": db_id,
                "sequence_id": sequence_id
            }
            
            self._send_message_immediately(metric_type, message_data)
            
            # Commit the Kafka message
            self.consumer.commit(msg)
            
        except json.JSONDecodeError as json_err:
            logger.error(f"Failed to decode JSON from {msg.topic()}: {json_err}")
            self.consumer.commit(msg)
        except Exception as e:
            logger.error(f"Error processing message from {msg.topic()}: {e}")