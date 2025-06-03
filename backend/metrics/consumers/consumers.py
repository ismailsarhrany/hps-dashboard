# metrics/consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
import json
import logging

logger = logging.getLogger(__name__)

class VmstatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add("vmstat_metrics", self.channel_name)
        await self.accept()
        logger.info(f"VMStat WebSocket connected: {self.channel_name}")

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard("vmstat_metrics", self.channel_name)
        logger.info(f"VMStat WebSocket disconnected: {self.channel_name}")

    async def vmstat_update(self, event):
        """Handle vmstat_update events (underscore format)"""
        try:
            await self.send(text_data=json.dumps({
                "metric": event["data"]["metric"],
                "timestamp": event["data"]["timestamp"],
                "values": event["data"]["values"],
                "id": event["data"].get("id")
            }))
            logger.debug(f"Sent vmstat data: {event['data']['timestamp']}")
        except Exception as e:
            logger.error(f"Error sending vmstat data: {e}")


class IostatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add("iostat_metrics", self.channel_name)
        await self.accept()
        logger.info(f"IOStat WebSocket connected: {self.channel_name}")

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard("iostat_metrics", self.channel_name)
        logger.info(f"IOStat WebSocket disconnected: {self.channel_name}")

    async def iostat_update(self, event):
        """Handle iostat_update events (underscore format)"""
        try:
            await self.send(text_data=json.dumps({
                "metric": event["data"]["metric"],
                "timestamp": event["data"]["timestamp"],
                "values": event["data"]["values"],
                "id": event["data"].get("id")
            }))
            logger.debug(f"Sent iostat data: {event['data']['timestamp']}")
        except Exception as e:
            logger.error(f"Error sending iostat data: {e}")


class NetstatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add("netstat_metrics", self.channel_name)
        await self.accept()
        logger.info(f"Netstat WebSocket connected: {self.channel_name}")

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard("netstat_metrics", self.channel_name)
        logger.info(f"Netstat WebSocket disconnected: {self.channel_name}")

    async def netstat_update(self, event):
        """Handle netstat_update events (underscore format)"""
        try:
            await self.send(text_data=json.dumps({
                "metric": event["data"]["metric"],
                "timestamp": event["data"]["timestamp"],
                "values": event["data"]["values"],
                "id": event["data"].get("id")
            }))
            logger.debug(f"Sent netstat data: {event['data']['timestamp']}")
        except Exception as e:
            logger.error(f"Error sending netstat data: {e}")


class ProcessConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.channel_layer.group_add("process_metrics", self.channel_name)
        await self.accept()
        logger.info(f"Process WebSocket connected: {self.channel_name}")

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard("process_metrics", self.channel_name)
        logger.info(f"Process WebSocket disconnected: {self.channel_name}")

    async def process_update(self, event):
        """Handle process_update events (underscore format)"""
        try:
            await self.send(text_data=json.dumps({
                "metric": event["data"]["metric"],
                "timestamp": event["data"]["timestamp"],
                "values": event["data"]["values"],
                "id": event["data"].get("id")
            }))
            logger.debug(f"Sent process data: {event['data']['timestamp']}")
        except Exception as e:
            logger.error(f"Error sending process data: {e}")


class MetricConsumer(AsyncWebsocketConsumer):
    """General metrics consumer for backwards compatibility"""
    async def connect(self):
        await self.channel_layer.group_add("all_metrics", self.channel_name)
        await self.accept()
        logger.info(f"General Metrics WebSocket connected: {self.channel_name}")

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard("all_metrics", self.channel_name)
        logger.info(f"General Metrics WebSocket disconnected: {self.channel_name}")

    async def metric_update(self, event):
        """Handle general metric_update events"""
        try:
            await self.send(text_data=json.dumps({
                "metric": event["data"]["metric"],
                "timestamp": event["data"]["timestamp"],
                "values": event["data"]["values"],
                "id": event["data"].get("id")
            }))
            logger.debug(f"Sent general metric data: {event['data']['timestamp']}")
        except Exception as e:
            logger.error(f"Error sending general metric data: {e}")

