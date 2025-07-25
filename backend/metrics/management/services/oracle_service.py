# backend/services/oracle_service.py

import cx_Oracle
import json
import hashlib
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from django.conf import settings
from django.utils import timezone
from kafka import KafkaProducer
import redis

from metrics.models import OracleDatabase, OracleTable, OracleTableData, OracleMonitoringTask

logger = logging.getLogger(__name__)

class OracleService:
    def __init__(self):
        self.kafka_producer = KafkaProducer(
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: str(k).encode('utf-8')
        )
        self.redis_client = redis.from_url(settings.REDIS_URL)
        
    def test_connection(self, database: OracleDatabase) -> Dict[str, Any]:
        """Test connection to Oracle database"""
        try:
            connection = self._get_connection(database)
            cursor = connection.cursor()
            cursor.execute("SELECT 1 FROM DUAL")
            result = cursor.fetchone()
            cursor.close()
            connection.close()
            
            # Update connection status
            database.connection_status = 'connected'
            database.last_connection_test = timezone.now()
            database.save()
            
            return {
                'success': True,
                'message': 'Connection successful',
                'timestamp': timezone.now().isoformat()
            }
            
        except cx_Oracle.Error as e:
            error_msg = str(e)
            logger.error(f"Oracle connection failed for {database}: {error_msg}")
            
            database.connection_status = 'failed'
            database.last_connection_test = timezone.now()
            database.save()
            
            return {
                'success': False,
                'message': f'Connection failed: {error_msg}',
                'timestamp': timezone.now().isoformat()
            }
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Unexpected error testing connection for {database}: {error_msg}")
            
            database.connection_status = 'failed'
            database.last_connection_test = timezone.now()
            database.save()
            
            return {
                'success': False,
                'message': f'Unexpected error: {error_msg}',
                'timestamp': timezone.now().isoformat()
            }

    def _get_connection(self, database: OracleDatabase):
        """Create Oracle database connection"""
        dsn = cx_Oracle.makedsn(
            host=database.host,
            port=database.port,
            service_name=database.service_name
        )
        
        connection = cx_Oracle.connect(
            user=database.username,
            password=database.password,
            dsn=dsn,
            encoding="UTF-8"
        )
        
        return connection

    def get_table_data(self, table: OracleTable) -> Dict[str, Any]:
        """Fetch data from Oracle table"""
        start_time = time.time()
        
        try:
            connection = self._get_connection(table.database)
            cursor = connection.cursor()
            
            # Build query
            query = self._build_query(table)
            logger.info(f"Executing query for {table}: {query}")
            
            cursor.execute(query)
            
            # Get column names
            columns = [col[0] for col in cursor.description]
            
            # Fetch data
            rows = cursor.fetchall()
            
            # Convert to list of dictionaries
            data = []
            for row in rows:
                row_dict = {}
                for i, value in enumerate(row):
                    # Handle Oracle-specific types
                    if isinstance(value, cx_Oracle.LOB):
                        value = value.read()
                    elif hasattr(value, 'isoformat'):  # datetime objects
                        value = value.isoformat()
                    row_dict[columns[i]] = value
                data.append(row_dict)
            
            cursor.close()
            connection.close()
            
            collection_duration = time.time() - start_time
            
            # Calculate checksum for change detection
            data_str = json.dumps(data, sort_keys=True, default=str)
            checksum = hashlib.md5(data_str.encode()).hexdigest()
            
            result = {
                'success': True,
                'data': data,
                'record_count': len(data),
                'checksum': checksum,
                'collection_duration': collection_duration,
                'timestamp': timezone.now().isoformat(),
                'columns': columns
            }
            
            # Update table metadata
            table.last_poll_time = timezone.now()
            table.last_record_count = len(data)
            table.save()
            
            return result
            
        except cx_Oracle.Error as e:
            error_msg = str(e)
            logger.error(f"Oracle query failed for {table}: {error_msg}")
            
            return {
                'success': False,
                'error': error_msg,
                'collection_duration': time.time() - start_time,
                'timestamp': timezone.now().isoformat()
            }
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Unexpected error querying {table}: {error_msg}")
            
            return {
                'success': False,
                'error': error_msg,
                'collection_duration': time.time() - start_time,
                'timestamp': timezone.now().isoformat()
            }

    def _build_query(self, table: OracleTable) -> str:
        """Build SQL query for table data collection"""
        # Determine columns to select
        if table.columns_to_monitor:
            columns = ', '.join(table.columns_to_monitor)
        else:
            columns = '*'
        
        # Base query
        query = f"SELECT {columns} FROM {table.get_full_table_name()}"
        
        # Add WHERE clause if specified
        if table.where_clause:
            query += f" WHERE {table.where_clause}"
        
        # Add ORDER BY if specified
        if table.order_by:
            query += f" ORDER BY {table.order_by}"
        
        return query

    def monitor_table(self, table: OracleTable) -> Dict[str, Any]:
        """Monitor a single table and detect changes"""
        # Create monitoring task
        task = OracleMonitoringTask.objects.create(
            table=table,
            status='running',
            started_at=timezone.now()
        )
        
        try:
            # Get current data
            result = self.get_table_data(table)
            
            if not result['success']:
                task.status = 'failed'
                task.error_message = result.get('error', 'Unknown error')
                task.completed_at = timezone.now()
                task.duration = time.time() - task.started_at.timestamp()
                task.save()
                return result
            
            # Check for changes
            current_checksum = result['checksum']
            changes_detected = False
            
            # Get last data snapshot
            last_snapshot = OracleTableData.objects.filter(table=table).first()
            
            if not last_snapshot or last_snapshot.checksum != current_checksum:
                changes_detected = True
                
                # Save new snapshot
                OracleTableData.objects.create(
                    table=table,
                    data=result['data'],
                    record_count=result['record_count'],
                    checksum=current_checksum,
                    collection_duration=result['collection_duration']
                )
                
                # Send to Kafka
                self._send_to_kafka(table, result, changes_detected)
                
                # Send to Redis for real-time updates
                self._send_to_redis(table, result, changes_detected)
            
            # Update task
            task.status = 'completed'
            task.completed_at = timezone.now()
            task.duration = time.time() - task.started_at.timestamp()
            task.records_processed = result['record_count']
            task.changes_detected = changes_detected
            task.save()
            
            result['changes_detected'] = changes_detected
            result['task_id'] = task.id
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Error monitoring table {table}: {error_msg}")
            
            task.status = 'failed'
            task.error_message = error_msg
            task.completed_at = timezone.now()
            task.duration = time.time() - task.started_at.timestamp()
            task.save()
            
            return {
                'success': False,
                'error': error_msg,
                'task_id': task.id
            }

    def _send_to_kafka(self, table: OracleTable, data: Dict[str, Any], changes_detected: bool):
        """Send data to Kafka topic"""
        try:
            topic = f"oracle_data_{table.database.server.name}_{table.database.name}"
            
            message = {
                'server_id': table.database.server.id,
                'server_name': table.database.server.name,
                'database_id': table.database.id,
                'database_name': table.database.name,
                'table_id': table.id,
                'table_name': table.table_name,
                'schema_name': table.schema_name,
                'data': data['data'],
                'record_count': data['record_count'],
                'checksum': data['checksum'],
                'changes_detected': changes_detected,
                'timestamp': data['timestamp'],
                'collection_duration': data['collection_duration']
            }
            
            # Send to Kafka
            future = self.kafka_producer.send(
                topic,
                key=f"{table.database.server.id}_{table.id}",
                value=message
            )
            
            # Wait for confirmation (optional, for reliability)
            future.get(timeout=10)
            
            logger.info(f"Sent Oracle data to Kafka topic {topic}")
            
        except Exception as e:
            logger.error(f"Failed to send Oracle data to Kafka: {e}")

    def _send_to_redis(self, table: OracleTable, data: Dict[str, Any], changes_detected: bool):
        """Send data to Redis for real-time WebSocket updates"""
        try:
            # Redis key for this table's data
            redis_key = f"oracle_data:{table.database.server.id}:{table.database.id}:{table.id}"
            
            # Message for WebSocket
            message = {
                'type': 'oracle_data_update',
                'server_id': table.database.server.id,
                'server_name': table.database.server.name,
                'database_id': table.database.id,
                'database_name': table.database.name,
                'table_id': table.id,
                'table_name': table.table_name,
                'schema_name': table.schema_name,
                'data': data['data'],
                'record_count': data['record_count'],
                'changes_detected': changes_detected,
                'timestamp': data['timestamp']
            }
            
            # Store latest data in Redis
            self.redis_client.setex(
                redis_key,
                3600,  # 1 hour expiry
                json.dumps(message)
            )
            
            # Publish to WebSocket channel if changes detected
            if changes_detected:
                channel = f"oracle_updates_{table.database.server.id}"
                self.redis_client.publish(channel, json.dumps(message))
            
            logger.info(f"Sent Oracle data to Redis key {redis_key}")
            
        except Exception as e:
            logger.error(f"Failed to send Oracle data to Redis: {e}")

    def monitor_all_active_tables(self):
        """Monitor all active Oracle tables"""
        active_tables = OracleTable.objects.filter(
            is_active=True,
            database__is_active=True,
            database__server__is_active=True
        )
        
        results = []
        for table in active_tables:
            # Check if it's time to poll this table
            if self._should_poll_table(table):
                result = self.monitor_table(table)
                results.append({
                    'table_id': table.id,
                    'table_name': str(table),
                    'result': result
                })
            
        return results

    def _should_poll_table(self, table: OracleTable) -> bool:
        """Check if table should be polled based on polling interval"""
        if not table.last_poll_time:
            return True
        
        next_poll_time = table.last_poll_time + timedelta(seconds=table.polling_interval)
        return timezone.now() >= next_poll_time

    def get_table_history(self, table: OracleTable, limit: int = 10) -> List[Dict[str, Any]]:
        """Get historical data for a table"""
        snapshots = OracleTableData.objects.filter(table=table)[:limit]
        
        history = []
        for snapshot in snapshots:
            history.append({
                'id': snapshot.id,
                'data': snapshot.data,
                'record_count': snapshot.record_count,
                'checksum': snapshot.checksum,
                'timestamp': snapshot.timestamp.isoformat(),
                'collection_duration': snapshot.collection_duration
            })
        
        return history