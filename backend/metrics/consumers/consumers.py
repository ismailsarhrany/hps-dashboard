# metrics/consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
import json
import logging
import redis

logger = logging.getLogger(__name__)

class VmstatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Extract server_id from URL
        self.server_id = self.scope['url_route']['kwargs']['server_id']
        group_name = f"vmstat_metrics_{self.server_id}"
        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.accept()
        logger.info(f"VMStat WebSocket connected for server {self.server_id}: {self.channel_name}")

    async def disconnect(self, close_code):
        group_name = f"vmstat_metrics_{self.server_id}"
        await self.channel_layer.group_discard(group_name, self.channel_name)
        logger.info(f"VMStat WebSocket disconnected for server {self.server_id}: {self.channel_name}")

    async def vmstat_update(self, event):
        # Only send if server_id matches
        if event["server_id"] == self.server_id:
            try:
                await self.send(text_data=json.dumps({
                    "metric": event["data"]["metric"],
                    "server_id": event["server_id"],
                    "timestamp": event["data"]["timestamp"],
                    "values": event["data"]["values"],
                    "id": event["data"].get("id")
                }))
            except Exception as e:
                logger.error(f"Error sending vmstat data: {e}")




class IostatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.server_id = self.scope['url_route']['kwargs'].get('server_id')
        group_name = f"iostat_metrics_{self.server_id}" if self.server_id else "iostat_metrics"
        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.accept()
        logger.info(f"IOStat WebSocket connected{f' for server {self.server_id}' if self.server_id else ''}: {self.channel_name}")

    async def disconnect(self, close_code):
        group_name = f"iostat_metrics_{self.server_id}" if self.server_id else "iostat_metrics"
        await self.channel_layer.group_discard(group_name, self.channel_name)
        logger.info(f"IOStat WebSocket disconnected{f' for server {self.server_id}' if self.server_id else ''}: {self.channel_name}")

    async def iostat_update(self, event):
        if not self.server_id or event.get("server_id") == self.server_id:
            try:
                await self.send(text_data=json.dumps({
                    "metric": event["data"]["metric"],
                    "server_id": event.get("server_id"),
                    "timestamp": event["data"]["timestamp"],
                    "values": event["data"]["values"],
                    "id": event["data"].get("id")
                }))
            except Exception as e:
                logger.error(f"Error sending iostat data: {e}")

class NetstatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.server_id = self.scope['url_route']['kwargs'].get('server_id')
        group_name = f"netstat_metrics_{self.server_id}" if self.server_id else "netstat_metrics"
        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.accept()
        logger.info(f"Netstat WebSocket connected{f' for server {self.server_id}' if self.server_id else ''}: {self.channel_name}")

    async def disconnect(self, close_code):
        group_name = f"netstat_metrics_{self.server_id}" if self.server_id else "netstat_metrics"
        await self.channel_layer.group_discard(group_name, self.channel_name)
        logger.info(f"Netstat WebSocket disconnected{f' for server {self.server_id}' if self.server_id else ''}: {self.channel_name}")

    async def netstat_update(self, event):
        if not self.server_id or event.get("server_id") == self.server_id:
            try:
                await self.send(text_data=json.dumps({
                    "metric": event["data"]["metric"],
                    "server_id": event.get("server_id"),
                    "timestamp": event["data"]["timestamp"],
                    "values": event["data"]["values"],
                    "id": event["data"].get("id")
                }))
            except Exception as e:
                logger.error(f"Error sending netstat data: {e}")

class ProcessConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.server_id = self.scope['url_route']['kwargs'].get('server_id')
        group_name = f"process_metrics_{self.server_id}" if self.server_id else "process_metrics"
        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.accept()
        logger.info(f"Process WebSocket connected{f' for server {self.server_id}' if self.server_id else ''}: {self.channel_name}")

    async def disconnect(self, close_code):
        group_name = f"process_metrics_{self.server_id}" if self.server_id else "process_metrics"
        await self.channel_layer.group_discard(group_name, self.channel_name)
        logger.info(f"Process WebSocket disconnected{f' for server {self.server_id}' if self.server_id else ''}: {self.channel_name}")

    async def process_update(self, event):
        if not self.server_id or event.get("server_id") == self.server_id:
            try:
                await self.send(text_data=json.dumps({
                    "metric": event["data"]["metric"],
                    "server_id": event.get("server_id"),
                    "timestamp": event["data"]["timestamp"],
                    "values": event["data"]["values"],
                    "id": event["data"].get("id")
                }))
            except Exception as e:
                logger.error(f"Error sending process data: {e}")


class MetricConsumer(AsyncWebsocketConsumer):
    """General metrics consumer for backwards compatibility"""
    async def connect(self):
        self.server_id = self.scope['url_route']['kwargs']['server_id']
        group_name = f"all_metrics_{self.server_id}"
        await self.channel_layer.group_add(group_name, self.channel_name)
        await self.accept()
        logger.info(f"General Metrics WebSocket connected for server {self.server_id}: {self.channel_name}")

    async def disconnect(self, close_code):
        group_name = f"all_metrics_{self.server_id}"
        await self.channel_layer.group_discard(group_name, self.channel_name)
        logger.info(f"General Metrics WebSocket disconnected for server {self.server_id}: {self.channel_name}")

    async def metric_update(self, event):
        if event["server_id"] == self.server_id:
            try:
                await self.send(text_data=json.dumps({
                    "metric": event["data"]["metric"],
                    "server_id": event["server_id"],
                    "timestamp": event["data"]["timestamp"],
                    "values": event["data"]["values"],
                    "id": event["data"].get("id")
                }))
            except Exception as e:
                logger.error(f"Error sending general metric data: {e}")


class OracleDataConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.server_id = self.scope['url_route']['kwargs']['server_id']
        self.redis_group = f'oracle_updates_{self.server_id}'
        
        # Join Redis channel group
        await self.channel_layer.group_add(
            self.redis_group,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        # Leave Redis group
        await self.channel_layer.group_discard(
            self.redis_group,
            self.channel_name
        )

    async def oracle_data_update(self, event):
        # Send data to WebSocket
        await self.send(text_data=json.dumps(event['data']))

