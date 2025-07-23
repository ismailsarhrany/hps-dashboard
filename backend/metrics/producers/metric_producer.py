# metrics/producers/metric_producer.py
from confluent_kafka import Producer
import json
from datetime import datetime
import os
import pytz
from django.conf import settings
import logging
import time
from decimal import Decimal

logger = logging.getLogger(__name__)

class JSONEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle datetime and other non-serializable types"""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        elif isinstance(obj, Decimal):
            return float(obj)
        elif hasattr(obj, '__dict__'):
            return obj.__dict__
        return super().default(obj)

class MetricProducer:
    def __init__(self):
        bootstrap_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
        config = {
            "bootstrap.servers": bootstrap_servers,
            "acks": "1",  # Wait for leader acknowledgment
            "retries": 3,
            "retry.backoff.ms": 300,
            "message.timeout.ms": 30000,
            "compression.type": "snappy",  # Enable compression
            "batch.size": 16384,
            "linger.ms": 5,  # Small linger time for batching
        }
        logger.info(f"Initializing Kafka Producer with config: {config}")
        try:
            self.producer = Producer(config)
            logger.info("Kafka Producer initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka Producer: {str(e)}")
            self.producer = None

    def _serialize_data(self, data):
        """Recursively serialize data to ensure JSON compatibility"""
        if isinstance(data, dict):
            return {key: self._serialize_data(value) for key, value in data.items()}
        elif isinstance(data, list):
            return [self._serialize_data(item) for item in data]
        elif isinstance(data, datetime):
            return data.isoformat()
        elif isinstance(data, Decimal):
            return float(data)
        elif hasattr(data, '__dict__'):
            return self._serialize_data(data.__dict__)
        else:
            return data

    def produce_metric(self, server_id, os_type, metric_type, data):
        """Produce metric with enhanced JSON serialization and error handling."""
        if not self.producer:
            logger.error("Kafka producer is not initialized. Cannot produce metric.")
            return False
        
        try:
            # Create high-precision timestamp
            timestamp = datetime.now()
            unix_timestamp_us = int(timestamp.timestamp() * 1000000)
            
            # Handle timezone-aware timestamps
            if settings.USE_TZ:
                tz = pytz.timezone(getattr(settings, "TIME_ZONE", "UTC"))
                if timestamp.tzinfo is None:
                    timestamp = tz.localize(timestamp)
                else:
                    timestamp = timestamp.astimezone(tz)
            else:
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=pytz.UTC)
            
            topic = f"metrics_{metric_type}_{server_id}"
            
            # Serialize all data to ensure JSON compatibility
            serialized_data = self._serialize_data(data)
            
            message_payload = {
                "server_id": server_id,
                "os_type": os_type,
                "timestamp": timestamp.isoformat(),
                "data": serialized_data,
                "producer_time": timestamp.timestamp(),
                "sequence_id": unix_timestamp_us
            }
            
            # Use custom JSON encoder as fallback
            message_value = json.dumps(message_payload, cls=JSONEncoder, ensure_ascii=False)
            
            self.producer.produce(
                topic=topic, 
                value=message_value, 
                key=f"{server_id}_{unix_timestamp_us}",
                callback=self.delivery_report
            )
            
            # Poll to handle delivery reports
            self.producer.poll(0)
            logger.debug(f"Successfully produced {metric_type} metric for server {server_id}")
            return True
            
        except json.JSONEncodeError as e:
            logger.error(f"JSON serialization error for {metric_type} metric: {str(e)}")
            logger.error(f"Problematic data: {data}")
            return False
        except Exception as e:
            logger.error(f"Error producing {metric_type} metric for server {server_id}: {str(e)}")
            return False

    def delivery_report(self, err, msg):
        """Called once for each message produced to indicate delivery result."""
        if err is not None:
            logger.error(f"Message delivery failed for topic {msg.topic()}: {err}")
            # Could implement retry logic here
        else:
            logger.debug(f"Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}")

    def produce_batch_metrics(self, server_id, os_type, metrics_data):
        """Produce multiple metric types in a batch for efficiency"""
        success_count = 0
        total_count = len(metrics_data)
        
        for metric_type, data in metrics_data.items():
            if self.produce_metric(server_id, os_type, metric_type, data):
                success_count += 1
        
        # Flush after batch
        self.producer.poll(0)
        
        logger.info(f"Batch production completed: {success_count}/{total_count} metrics sent for server {server_id}")
        return success_count == total_count
            
    def flush_and_wait(self, timeout=10):
        """Flush producer and wait for all messages to be delivered."""
        if self.producer:
            remaining = self.producer.flush(timeout=timeout)
            if remaining > 0:
                logger.warning(f"{remaining} messages still in queue after flush timeout.")
            return remaining
        return 0
            
    def close(self):
        """Flush any outstanding messages and close the producer."""
        if self.producer:
            logger.info("Flushing remaining messages and closing Kafka producer...")
            try:
                remaining_messages = self.producer.flush(timeout=10)
                if remaining_messages > 0:
                    logger.warning(f"{remaining_messages} messages still in queue after flush timeout.")
                logger.info("Kafka producer closed.")
            except Exception as e:
                logger.error(f"Error during Kafka producer flush/close: {str(e)}")
            finally:
                self.producer = None
        else:
            logger.info("Kafka producer was not initialized or already closed.")

    def get_producer_stats(self):
        """Get producer statistics for monitoring"""
        if self.producer:
            return {
                "producer_initialized": True,
                "queue_size": len(self.producer)
            }
        return {"producer_initialized": False}