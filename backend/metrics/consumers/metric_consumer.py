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
from metrics.utils.rate_service import RateCalculatorService

logger = logging.getLogger(__name__)


class MetricConsumer:
    def __init__(self):
        bootstrap_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
        self.conf = {
            "bootstrap.servers": bootstrap_servers,
            "group.id": "metric_consumer_group",
            "auto.offset.reset": "earliest",
            "enable.auto.commit": "false",
            "max.poll.interval.ms": 300000,
            "session.timeout.ms": 10000
        }
        
        try:
            self.consumer = Consumer(self.conf)
            logger.info(f"Kafka Consumer initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Kafka Consumer: {e}")
            return

        self.channel_layer = get_channel_layer()
        self.running = True
        self.rate_calculator = RateCalculatorService(min_time_diff_seconds=0.5)
        self.last_sent_sequence = defaultdict(int)

    def _send_message_immediately(self, server_id, metric_type, message_data):
        """Send to both metric-specific and all-metrics groups"""
        try:
            sequence_id = message_data.get("sequence_id", 0)
            
            # Server-specific metric group
            metric_group = f"{metric_type}_metrics_{server_id}"
            async_to_sync(self.channel_layer.group_send)(metric_group, {
                "type": f"{metric_type}_update",
                "server_id": server_id,
                "data": message_data
            })
            
            # All-metrics group for the server
            all_group = f"all_metrics_{server_id}"
            async_to_sync(self.channel_layer.group_send)(all_group, {
                "type": "metric_update",
                "server_id": server_id,
                "data": {
                    "metric": metric_type,
                    "timestamp": message_data["timestamp"],
                    "values": message_data["values"],
                    "id": message_data.get("id"),
                    "sequence_id": sequence_id
                }
            })
            
            self.last_sent_sequence[(server_id, metric_type)] = sequence_id
            
        except Exception as e:
            logger.error(f"Error sending message: {e}")

    def process_message(self, msg):
        try:
            data = json.loads(msg.value().decode("utf-8"))
            topic = msg.topic()
            
            # Extract server_id and metric_type from topic
            parts = topic.split('_')
            if len(parts) < 3:
                logger.error(f"Invalid topic format: {topic}")
                return
                
            metric_type = parts[1]
            server_id = parts[-1]
            
            model_map = {
                "vmstat": "VmstatMetric",
                "iostat": "IostatMetric",
                "netstat": "NetstatMetric",
                "process": "ProcessMetric"
            }
            
            if metric_type not in model_map:
                logger.warning(f"Unsupported metric type: {metric_type}")
                return
                
            model = apps.get_model("metrics", model_map[metric_type])
            original_timestamp = data.get("timestamp")
            if isinstance(original_timestamp, str):
                # Convert ISO string to datetime
                timestamp = datetime.fromisoformat(original_timestamp)
            else:
                timestamp = original_timestamp

            # Use this timestamp when creating model instances
            instance_data = {"timestamp": timestamp, **data["data"]}            
            sequence_id = data.get("sequence_id", 0)
            
            if not original_timestamp:
                logger.warning("Missing timestamp in message")
                return
                
            # Prepare data
            instance_data = {"timestamp": original_timestamp, **data["data"]}
            
            # Add calculated rates
            self._add_calculated_rates(metric_type, instance_data)
            
            # Save to database
            try:
                # Handle special field mapping
                if metric_type == "vmstat" and "in" in instance_data:
                    instance_data["interface_in"] = instance_data.pop("in")
                    
                instance = model.objects.create(**instance_data)
                db_id = instance.id
            except Exception as e:
                logger.error(f"Database save error: {e}")
                db_id = None
                
            # Prepare and send message
            message_data = {
                "timestamp": original_timestamp,
                "values": instance_data,
                "id": db_id,
                "sequence_id": sequence_id
            }
            self._send_message_immediately(server_id, metric_type, message_data)
            
            # Commit message
            self.consumer.commit(msg)
            
        except json.JSONDecodeError:
            logger.error(f"JSON decode error for topic: {msg.topic()}")
        except Exception as e:
            logger.error(f"Message processing error: {e}")



    def _add_calculated_rates(self, metric_type, data_dict):
        """Add calculated rates to the data dictionary based on metric type."""
        try:
            if metric_type == "netstat":
                rates = self.rate_calculator.calculate_netstat_rates(data_dict)
                data_dict.update(rates)
                logger.debug(f"Added netstat rates: {rates}")
                
            elif metric_type == "iostat":
                rates = self.rate_calculator.calculate_iostat_rates(data_dict)
                data_dict.update(rates)
                logger.debug(f"Added iostat rates: {rates}")
                
            # vmstat and process metrics don't need rate calculations
            # as they already represent instantaneous values
            
        except Exception as e:
            logger.error(f"Error calculating rates for {metric_type}: {e}")
            # Continue without rates if calculation fails


    def cleanup_old_cache_entries(self):
        """Periodically clean up old cache entries to prevent memory leaks."""
        try:
            self.rate_calculator.clear_old_entries(max_age_seconds=3600)  # 1 hour
        except Exception as e:
            logger.error(f"Error cleaning up cache entries: {e}")

    def get_stats(self):
        """Get consumer and rate calculator statistics."""
        try:
            return {
                "consumer_running": self.running,
                "rate_calculator_stats": self.rate_calculator.get_cache_stats()
            }
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {"error": str(e)}