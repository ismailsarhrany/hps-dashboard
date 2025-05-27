# metrics/producers/metric_producer.py
from confluent_kafka import Producer
import json
from datetime import datetime
import os
import pytz
from django.conf import settings
import logging

logger = logging.getLogger(__name__) # Add logging

class MetricProducer:
    def __init__(self):
        
        bootstrap_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
        config = {
            "bootstrap.servers": bootstrap_servers,
            # Add other producer configurations if needed, e.g., for retries, acks
            # "acks": "all",
            # "retries": 3,
            # "message.timeout.ms": 10000
        }
        logger.info(f"Initializing Kafka Producer with config: {config}")
        try:
            self.producer = Producer(config)
            logger.info("Kafka Producer initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka Producer: {str(e)}")
            self.producer = None # Set producer to None if initialization fails

    def produce_metric(self, metric_type, data):
        if not self.producer:
            logger.error("Kafka producer is not initialized. Cannot produce metric.")
            return
            
        topic = f"metrics_{metric_type}"
        timestamp = datetime.now()
    
        # Make timestamp timezone-aware
        if settings.USE_TZ:
            # Ensure TIME_ZONE is set in Django settings
            tz = pytz.timezone(getattr(settings, "TIME_ZONE", "UTC")) 
            timestamp = timestamp.astimezone(tz)
        
        try:
            message_value = json.dumps({
                "timestamp": timestamp.isoformat(),
                "data": data
            })
            
            # Use a delivery report callback for better error handling (optional but recommended)
            self.producer.produce(topic=topic, value=message_value, callback=self.delivery_report)
            # flush() after each message can impact performance, consider flushing periodically or on close
            # self.producer.poll(0) # Poll for delivery reports without blocking
            # self.producer.flush(5) # Flush with a timeout

        except BufferError:
             logger.warning(f"Kafka producer queue is full. Waiting to produce to topic {topic}...")
             self.producer.flush() # Force flush if buffer is full
             # Retry producing after flush
             try:
                 self.producer.produce(topic=topic, value=message_value, callback=self.delivery_report)
             except Exception as e:
                 logger.error(f"Error producing metric to topic {topic} after flush: {str(e)}")
        except Exception as e:
            logger.error(f"Error producing metric to topic {topic}: {str(e)}")

    def delivery_report(self, err, msg):
        """ Called once for each message produced to indicate delivery result. """
        if err is not None:
            logger.error(f"Message delivery failed for topic {msg.topic()}: {err}")
        # else:
            # logger.debug(f"Message delivered to {msg.topic()} [{msg.partition()}] at offset {msg.offset()}")
            
    def close(self):
        """Flush any outstanding messages and close the producer."""
        if self.producer:
            logger.info("Flushing remaining messages and closing Kafka producer...")
            try:
                # Wait for all messages in the Producer queue to be delivered.
                remaining_messages = self.producer.flush(timeout=10) # Timeout in seconds
                if remaining_messages > 0:
                    logger.warning(f"{remaining_messages} messages still in queue after flush timeout.")
                logger.info("Kafka producer closed.")
            except Exception as e:
                logger.error(f"Error during Kafka producer flush/close: {str(e)}")
            finally:
                 self.producer = None # Ensure producer is marked as closed
        else:
            logger.info("Kafka producer was not initialized or already closed.")

