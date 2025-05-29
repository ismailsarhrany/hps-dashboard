# metrics/producers/metric_producer.py
from confluent_kafka import Producer
import json
from datetime import datetime
import os
import pytz
from django.conf import settings
import logging
import time

logger = logging.getLogger(__name__)

class MetricProducer:
    def __init__(self):
        bootstrap_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
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

    def produce_metric(self, metric_type, data):
        """Produce metric with microsecond-precision ordering."""
        if not self.producer:
            logger.error("Kafka producer is not initialized. Cannot produce metric.")
            return
        
        topic = f"metrics_{metric_type}"
    
        # Create high-precision timestamp
        timestamp = datetime.now()
        if settings.USE_TZ:
            tz = pytz.timezone(getattr(settings, "TIME_ZONE", "UTC"))
            if timestamp.tzinfo is None:
                timestamp = tz.localize(timestamp)
            else:
                timestamp = timestamp.astimezone(tz)
        else:
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=pytz.UTC)
    
        try:
            # Use microsecond precision for better ordering
            unix_timestamp_us = int(timestamp.timestamp() * 1000000)  # microseconds
            message_key = f"{metric_type}_{unix_timestamp_us}"
        
            message_value = json.dumps({
                "timestamp": timestamp.isoformat(),
                "data": data,
                "producer_time": timestamp.timestamp(),
                "sequence_id": unix_timestamp_us  # Add sequence ID for ordering
            })
        
            self.producer.produce(
                topic=topic, 
                value=message_value, 
                key=message_key,
                callback=self.delivery_report
            )
        
            self.producer.poll(0)
            logger.debug(f"Produced {metric_type} metric with sequence_id {unix_timestamp_us}")

        except Exception as e:
            logger.error(f"Error producing metric to topic {topic}: {str(e)}")

    def delivery_report(self, err, msg):
        """Called once for each message produced to indicate delivery result."""
        if err is not None:
            logger.error(f"Message delivery failed for topic {msg.topic()}: {err}")
            # You might want to implement retry logic here
        else:
            logger.debug(f"Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}")
            
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