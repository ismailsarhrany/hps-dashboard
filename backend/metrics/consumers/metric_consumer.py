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
            "enable.auto.commit": "false"
        }
        try:
            self.consumer = Consumer(self.conf)
            logger.info(f"Kafka Consumer initialized with config: {self.conf}")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka Consumer: {e}")
            self.consumer = None
            return
            
        self.channel_layer = get_channel_layer()
        
        # Enhanced buffering system
        self.message_buffers = defaultdict(list)
        self.buffer_lock = threading.Lock()
        self.running = True
        
        # Timing configuration
        self.batch_interval = 2.0  # Increased to 2 seconds for better ordering
        self.max_buffer_age = 5.0  # Maximum age of messages in buffer (seconds)
        self.max_buffer_size = 100  # Maximum messages per metric type
        
        # Timestamp tracking
        self.last_sent_timestamps = defaultdict(lambda: datetime.min.replace(tzinfo=pytz.UTC))
        
        # Start the background thread for batch processing
        self.batch_thread = threading.Thread(target=self._batch_processor, daemon=True)
        self.batch_thread.start()
        logger.info(f"Batch processing thread started with interval {self.batch_interval}s.")

    def _parse_timestamp_safely(self, ts_str):
        """Parse timestamp string with better error handling."""
        try:
            # Handle both 'Z' suffix and '+00:00' timezone formats
            if ts_str.endswith('Z'):
                ts_str = ts_str[:-1] + '+00:00'
            
            parsed_ts = datetime.fromisoformat(ts_str)
            
            # Ensure timezone awareness
            if parsed_ts.tzinfo is None:
                parsed_ts = parsed_ts.replace(tzinfo=pytz.UTC)
                
            return parsed_ts
        except Exception as e:
            logger.warning(f"Could not parse timestamp '{ts_str}': {e}. Using current time.")
            return datetime.now(tz=pytz.UTC)

    def _should_flush_buffer(self, metric_type, messages):
        """Determine if buffer should be flushed based on various criteria."""
        if not messages:
            return False
            
        # Flush if buffer is too large
        if len(messages) >= self.max_buffer_size:
            return True
            
        # Flush if oldest message is too old
        try:
            oldest_msg = min(messages, key=lambda m: self._parse_timestamp_safely(m["data"]["timestamp"]))
            oldest_ts = self._parse_timestamp_safely(oldest_msg["data"]["timestamp"])
            age = (datetime.now(tz=pytz.UTC) - oldest_ts).total_seconds()
            
            if age > self.max_buffer_age:
                return True
        except Exception as e:
            logger.warning(f"Error checking buffer age for {metric_type}: {e}")
            return True  # Flush on error to be safe
            
        return False

    def _batch_processor(self):
        """Enhanced batch processor with better ordering logic."""
        while self.running:
            try:
                time.sleep(self.batch_interval)
                
                buffers_to_process = defaultdict(list)
                
                with self.buffer_lock:
                    for metric, messages in self.message_buffers.items():
                        if messages and self._should_flush_buffer(metric, messages):
                            buffers_to_process[metric].extend(messages)
                            self.message_buffers[metric].clear()
                
                if not buffers_to_process:
                    continue

                logger.debug(f"Processing batch for metrics: {list(buffers_to_process.keys())}")
                
                for metric, messages in buffers_to_process.items():
                    self._process_metric_batch(metric, messages)
                    
            except Exception as e:
                logger.error(f"Error in batch processor loop: {e}")
                time.sleep(self.batch_interval)

    def _process_metric_batch(self, metric_type, messages):
        """Process a batch of messages for a specific metric type."""
        if not messages:
            return
            
        try:
            # Sort messages by timestamp
            sorted_messages = sorted(
                messages, 
                key=lambda msg: self._parse_timestamp_safely(msg["data"]["timestamp"])
            )
            
            # Filter out messages older than the last sent timestamp for this metric
            last_sent = self.last_sent_timestamps[metric_type]
            filtered_messages = []
            
            for msg in sorted_messages:
                msg_ts = self._parse_timestamp_safely(msg["data"]["timestamp"])
                if msg_ts > last_sent:
                    filtered_messages.append(msg)
                else:
                    logger.debug(f"Skipping old message for {metric_type}: {msg_ts} <= {last_sent}")
            
            if not filtered_messages:
                logger.debug(f"No new messages to send for {metric_type} after filtering")
                return
            
            # Send filtered and sorted messages
            group_name = f"{metric_type}_metrics"
            
            logger.debug(f"Sending {len(filtered_messages)} sorted messages for {metric_type}")
            
            for message_payload in filtered_messages:
                try:
                    # Send to specific metric group
                    async_to_sync(self.channel_layer.group_send)(group_name, {
                        "type": message_payload["type"],
                        "data": {
                                "metric": metric_type,
                                "timestamp": message_payload["data"]["timestamp"],
                                "values": message_payload["data"]["values"],
                                "id": message_payload["data"]["id"]
    }
})
                    
                    # Send to general group
                    async_to_sync(self.channel_layer.group_send)("all_metrics", {
                        "type": "metric.update",
                        "data": message_payload["data"]
                    })
                    
                    # Update last sent timestamp
                    msg_ts = self._parse_timestamp_safely(message_payload["data"]["timestamp"])
                    self.last_sent_timestamps[metric_type] = max(
                        self.last_sent_timestamps[metric_type], 
                        msg_ts
                    )
                    
                except Exception as e:
                    logger.error(f"Error sending message to group {group_name}: {e}")
                    
        except Exception as e:
            logger.error(f"Error processing batch for {metric_type}: {e}")

    def stop(self):
        """Stops the consumer and the batch processor thread."""
        logger.info("Stopping MetricConsumer...")
        self.running = False
        if self.consumer:
            self.consumer.close()
            logger.info("Kafka Consumer closed.")
        if self.batch_thread.is_alive():
            self.batch_thread.join(timeout=self.batch_interval * 2)
            if self.batch_thread.is_alive():
                logger.warning("Batch processing thread did not exit cleanly.")
        logger.info("MetricConsumer stopped.")

    def process_message(self, msg):
        """Enhanced message processing with better timestamp handling."""
        if not self.running:
            logger.warning("Consumer is stopping, ignoring message.")
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
            
            # Validate timestamp early
            original_timestamp = data.get("timestamp")
            if not original_timestamp:
                logger.warning(f"Message missing timestamp for {topic}")
                self.consumer.commit(msg)
                return
            
            # Parse and validate timestamp
            parsed_ts = self._parse_timestamp_safely(original_timestamp)
            
            # Check if message is too old (older than 1 hour)
            now = datetime.now(tz=pytz.UTC)
            age = (now - parsed_ts).total_seconds()
            if age > 3600:  # 1 hour
                logger.warning(f"Dropping very old message for {topic}: {age} seconds old")
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

            # Prepare WebSocket payload
            websocket_payload = {
                "type": f"{metric_type}_update",  # Fixed: use underscore instead of dot
                "data": {
                    "metric": metric_type,
                    "timestamp": original_timestamp,
                    "values": instance_data,
                    "id": db_id,
                    "parsed_timestamp": parsed_ts.isoformat()  # For debugging
                }
            }
            
            # Add to buffer
            with self.buffer_lock:
                self.message_buffers[metric_type].append(websocket_payload)
            
            logger.debug(f"Buffered message for {metric_type} with timestamp {original_timestamp}")
            
            # Commit the Kafka message
            self.consumer.commit(msg)
            
        except json.JSONDecodeError as json_err:
            logger.error(f"Failed to decode JSON from {msg.topic()}: {json_err}")
            self.consumer.commit(msg)
        except Exception as e:
            logger.error(f"Error processing message from {msg.topic()}: {e}")
            # Don't commit on processing errors to allow retry

    def consume_loop(self):
        """Main loop to consume messages from Kafka."""
        if not self.consumer:
            logger.error("Consumer not initialized. Exiting consume loop.")
            return
            
        topics = ["metrics_vmstat", "metrics_iostat", "metrics_netstat", "metrics_process"]
        try:
            self.consumer.subscribe(topics)
            logger.info(f"Subscribed to Kafka topics: {topics}")
            
            while self.running:
                msg = self.consumer.poll(timeout=1.0)
                
                if msg is None:
                    continue
                if msg.error():
                    logger.error(f"Kafka consumer error: {msg.error()}")
                    time.sleep(5)
                    continue
                
                self.process_message(msg)
                
        except Exception as e:
            logger.error(f"Exception in consume loop: {e}")
        finally:
            self.stop()