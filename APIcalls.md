# API and WebSocket Documentation

## Table of Contents

1. [Base Information](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#base-information)
2. [Metrics APIs](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#metrics-apis)
3. [Server Management APIs](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#server-management-apis)
4. [Oracle Monitoring APIs](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#oracle-monitoring-apis)
5. [Health & Debug APIs](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#health--debug-apis)
6. [WebSocket Endpoints](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#websocket-endpoints)
7. [Error Handling](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#error-handling)
8. [Authentication](https://claude.ai/chat/a3072371-346d-4565-9aba-275feab3d729#authentication)

## Base Information

**Base URL**: `http://your-domain.com/` **Content-Type**: `application/json` **Authentication**: Currently disabled (AllowAll permission)

---

## Metrics APIs

### 1. Realtime Metrics

**GET** `/api/metrics/realtime/`

Get the last 1 minute of data for a given metric.

**Query Parameters:**

- `metric` (required): One of `vmstat`, `iostat`, `netstat`, `process`
- `server_id` (optional): UUID of the server
- `hostname` (optional): Hostname of the server

**Example Request:**

```http
GET /api/metrics/realtime/?metric=vmstat&server_id=550e8400-e29b-41d4-a716-446655440000
```

**Success Response (200):**

```json
{
  "data": [
    {
      "id": 1,
      "server_id": "550e8400-e29b-41d4-a716-446655440000",
      "server_hostname": "web-server-01",
      "server_alias": "Web Server 1",
      "timestamp": "2024-08-07T10:30:00Z",
      "r": 2,
      "b": 0,
      "avm": 1024000,
      "fre": 512000,
      "pi": 10,
      "po": 5,
      "fr": 100,
      "interface_in": 50,
      "cs": 200,
      "us": 25.5,
      "sy": 15.2,
      "idle": 59.3
    }
  ],
  "count": 1,
  "start_time": "2024-08-07T10:29:00Z",
  "end_time": "2024-08-07T10:30:00Z",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": null
}
```

**Error Response (400):**

```json
{
  "error": "Invalid or missing metric parameter",
  "available_metrics": ["vmstat", "iostat", "netstat", "process"]
}
```

**Error Response (404):**

```json
{
  "message": "No recent data available for metric: vmstat",
  "start_time": "2024-08-07T10:29:00Z",
  "end_time": "2024-08-07T10:30:00Z",
  "server_id": null,
  "hostname": null
}
```

### 2. Historical Metrics

**GET** `/api/metrics/historical/`

Get historical data for a given metric within a time range.

**Query Parameters:**

- `metric` (required): One of `vmstat`, `iostat`, `netstat`, `process`
- `start` (required): ISO datetime string (e.g., `2024-08-07T00:00:00Z`)
- `end` (required): ISO datetime string
- `server_id` (optional): UUID of the server
- `hostname` (optional): Hostname of the server
- `interval` (optional): Aggregation interval in seconds (for process metrics)
- `pids` (optional): Comma-separated list of PIDs to filter (for process metrics)
- `page` (optional): Page number for pagination (default: 1)

**Example Request:**

```http
GET /api/metrics/historical/?metric=process&start=2024-08-07T00:00:00Z&end=2024-08-07T01:00:00Z&interval=300&pids=1234,5678
```

**Success Response (200) - Raw Data:**

```json
{
  "data": [
    {
      "id": 1,
      "server_id": "550e8400-e29b-41d4-a716-446655440000",
      "server_hostname": "web-server-01",
      "timestamp": "2024-08-07T00:00:00Z",
      "pid": 1234,
      "user": "root",
      "cpu": 15.5,
      "mem": 8.2,
      "command": "/usr/bin/python app.py"
    }
  ],
  "count": 1,
  "start_time": "2024-08-07T00:00:00Z",
  "end_time": "2024-08-07T01:00:00Z",
  "metric": "Process Metric"
}
```

**Success Response (200) - Process Aggregated Data:**

```json
{
  "data": [
    {
      "timestamp": "2024-08-07T00:00:00Z",
      "pid": 1234,
      "command": "/usr/bin/python app.py",
      "user": "root",
      "avg_cpu": 15.5,
      "max_cpu": 20.0,
      "min_cpu": 10.0,
      "avg_mem": 8.2,
      "max_mem": 10.5,
      "min_mem": 6.0,
      "count": 12,
      "server": {
        "server_id": "550e8400-e29b-41d4-a716-446655440000",
        "hostname": "web-server-01",
        "alias": "Web Server 1"
      }
    }
  ],
  "count": 1,
  "start_time": "2024-08-07T00:00:00Z",
  "end_time": "2024-08-07T01:00:00Z",
  "metric": "process",
  "interval_seconds": 300,
  "pids_filtered": [1234, 5678]
}
```

**Error Response (400):**

```json
{
  "error": "Missing required parameters",
  "required": ["metric", "start", "end"]
}
```

---

## Server Management APIs

### 1. List Servers

**GET** `/api/servers/`

Get a paginated list of all servers.

**Query Parameters:**

- `status` (optional): Filter by status (`active`, `inactive`, `maintenance`, `error`)
- `monitoring_enabled` (optional): Filter by monitoring status (`true`, `false`)
- `environment` (optional): Filter by environment
- `page` (optional): Page number (default: 1)
- `per_page` (optional): Items per page (max: 100, default: 25)

**Example Request:**

```http
GET /api/servers/?status=active&monitoring_enabled=true&page=1&per_page=10
```

**Success Response (200):**

```json
{
  "count": 50,
  "page": 1,
  "total_pages": 5,
  "servers": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "hostname": "web-server-01",
      "ip_address": "192.168.1.100",
      "alias": "Web Server 1",
      "os_type": "linux",
      "os_version": "Ubuntu 20.04",
      "architecture": "x86_64",
      "ssh_port": 22,
      "ssh_username": "admin",
      "status": "active",
      "monitoring_enabled": true,
      "monitoring_interval": 60,
      "description": "Production web server",
      "location": "Data Center 1",
      "environment": "production",
      "created_at": "2024-08-01T10:00:00Z",
      "updated_at": "2024-08-07T10:00:00Z",
      "last_seen": "2024-08-07T10:30:00Z"
    }
  ]
}
```

### 2. Create Server

**POST** `/api/servers/create/`

Create a new server instance.

**Request Body:**

```json
{
  "hostname": "web-server-02",
  "ip_address": "192.168.1.101",
  "ssh_username": "admin",
  "os_type": "linux",
  "ssh_port": 22,
  "alias": "Web Server 2",
  "os_version": "Ubuntu 22.04",
  "architecture": "x86_64",
  "ssh_key_path": "/path/to/key",
  "ssh_password": "password123",
  "status": "active",
  "monitoring_enabled": true,
  "monitoring_interval": 60,
  "description": "New production server",
  "location": "Data Center 1",
  "environment": "production"
}
```

**Success Response (201):**

```json
{
  "status": "created",
  "server": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "hostname": "web-server-02",
    "ip_address": "192.168.1.101",
    "ssh_username": "admin",
    "os_type": "linux",
    "ssh_port": 22,
    "status": "active",
    "monitoring_enabled": true,
    "created_at": "2024-08-07T10:30:00Z"
  }
}
```

**Error Response (400):**

```json
{
  "error": "Missing required field: 'hostname'",
  "required_fields": ["hostname", "ip_address", "ssh_username"]
}
```

### 3. Get Server Details

**GET** `/api/servers/{server_id}/`

Retrieve details of a specific server.

**Path Parameters:**

- `server_id`: UUID of the server

**Success Response (200):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "web-server-01",
  "ip_address": "192.168.1.100",
  "alias": "Web Server 1",
  "os_type": "linux",
  "ssh_port": 22,
  "ssh_username": "admin",
  "status": "active",
  "monitoring_enabled": true,
  "created_at": "2024-08-01T10:00:00Z",
  "updated_at": "2024-08-07T10:00:00Z"
}
```

**Error Response (404):**

```json
{
  "error": "Server with ID '550e8400-e29b-41d4-a716-446655440000' not found"
}
```

### 4. Update Server

**PUT** `/api/servers/{server_id}/`

Update an existing server.

**Path Parameters:**

- `server_id`: UUID of the server

**Request Body:**

```json
{
  "hostname": "updated-web-server-01",
  "status": "maintenance",
  "monitoring_enabled": false,
  "description": "Updated description"
}
```

**Success Response (200):**

```json
{
  "status": "updated",
  "server": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hostname": "updated-web-server-01",
    "status": "maintenance",
    "monitoring_enabled": false,
    "updated_at": "2024-08-07T10:35:00Z"
  }
}
```

### 5. Delete Server

**DELETE** `/api/servers/{server_id}/`

Delete a server.

**Path Parameters:**

- `server_id`: UUID of the server

**Success Response (204):**

```json
{
  "status": "deleted",
  "server_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 6. Test Server Connection

**POST** `/api/servers/{server_id}/test-connection/`

Test SSH connection to a server.

**Path Parameters:**

- `server_id`: UUID of the server

**Success Response (200):**

```json
{
  "status": "success",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "web-server-01",
  "output": "Connection test successful"
}
```

**Error Response (400):**

```json
{
  "status": "error",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "web-server-01",
  "error": "Authentication failed"
}
```

### 7. Bulk Update Server Status

**POST** `/api/servers/bulk-status/`

Update status for multiple servers.

**Request Body:**

```json
{
  "server_ids": [
    "550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440001"
  ],
  "status": "maintenance"
}
```

**Success Response (200):**

```json
{
  "status": "success",
  "updated_count": 2,
  "new_status": "maintenance"
}
```

---

## Oracle Monitoring APIs

### 1. Oracle Databases

#### List Databases

**GET** `/api/oracle-databases/`

**Query Parameters:**

- `server_id` (optional): Filter by server ID

**Success Response (200):**

```json
[
  {
    "id": 1,
    "server": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "hostname": "db-server-01"
    },
    "server_id": "550e8400-e29b-41d4-a716-446655440000",
    "server_name": "db-server-01",
    "name": "ProductionDB",
    "host": "192.168.1.200",
    "port": 1521,
    "sid": "PROD",
    "username": "monitor_user",
    "connection_timeout": 30,
    "is_active": true,
    "created_at": "2024-08-01T10:00:00Z",
    "updated_at": "2024-08-07T10:00:00Z",
    "last_connection_test": "2024-08-07T10:30:00Z",
    "connection_status": "connected",
    "connection_status_display": "Connected",
    "monitored_tables_count": 5
  }
]
```

#### Create Database

**POST** `/api/oracle-databases/`

**Request Body:**

```json
{
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ProductionDB",
  "host": "192.168.1.200",
  "port": 1521,
  "sid": "PROD",
  "username": "monitor_user",
  "password": "password123",
  "connection_timeout": 30,
  "is_active": true
}
```

#### Test Database Connection

**POST** `/api/oracle-databases/{id}/test_connection/`

**Success Response (200):**

```json
{
  "success": true,
  "message": "Connection successful",
  "connection_time": 0.5,
  "database_version": "Oracle Database 19c"
}
```

#### Get Database Tables

**GET** `/api/oracle-databases/{id}/tables/`

**Success Response (200):**

```json
[
  {
    "id": 1,
    "database": 1,
    "table_name": "USERS",
    "schema_name": "HR",
    "full_table_name": "HR.USERS",
    "is_active": true,
    "polling_interval": 30,
    "last_record_count": 1500,
    "monitoring_status": "active"
  }
]
```

#### Get Database Status

**GET** `/api/oracle-databases/{id}/status/`

**Success Response (200):**

```json
{
  "database": {
    "id": 1,
    "name": "ProductionDB",
    "connection_status": "connected"
  },
  "statistics": {
    "table_count": 5,
    "recent_tasks": 12,
    "connection_status": "connected",
    "last_connection_test": "2024-08-07T10:30:00Z"
  },
  "latest_snapshots": []
}
```

### 2. Oracle Tables

#### List Tables

**GET** `/api/oracle-tables/`

**Query Parameters:**

- `database_id` (optional): Filter by database ID
- `server_id` (optional): Filter by server ID

#### Monitor Table Now

**POST** `/api/oracle-tables/{id}/monitor_now/`

**Success Response (200):**

```json
{
  "success": true,
  "message": "Monitoring task started",
  "task_id": 123,
  "records_collected": 1500,
  "collection_time": 2.5
}
```

#### Get Current Table Data

**GET** `/api/oracle-tables/{id}/current_data/`

**Success Response (200):**

```json
{
  "table": {
    "id": 1,
    "table_name": "USERS",
    "schema_name": "HR"
  },
  "data": [
    {
      "ID": 1,
      "NAME": "John Doe",
      "EMAIL": "john@example.com",
      "CREATED_DATE": "2024-08-01T10:00:00Z"
    }
  ],
  "record_count": 1500,
  "timestamp": "2024-08-07T10:30:00Z",
  "collection_duration": 2.5
}
```

#### Get Table History

**GET** `/api/oracle-tables/{id}/history/`

**Query Parameters:**

- `limit` (optional): Number of historical records (default: 10)

#### Get Monitoring Tasks

**GET** `/api/oracle-tables/{id}/monitoring_tasks/`

**Query Parameters:**

- `limit` (optional): Number of tasks (default: 20)

#### Update Table Configuration

**POST** `/api/oracle-tables/{id}/update_config/`

**Request Body:**

```json
{
  "polling_interval": 60,
  "columns_to_monitor": ["ID", "NAME", "EMAIL"],
  "where_clause": "CREATED_DATE > SYSDATE - 1",
  "order_by": "ID DESC",
  "is_active": true
}
```

### 3. Oracle Data

#### List Data Snapshots

**GET** `/api/oracle-data/`

**Query Parameters:**

- `table_id` (optional): Filter by table ID
- `database_id` (optional): Filter by database ID
- `server_id` (optional): Filter by server ID

#### Get Latest Data by Table

**GET** `/api/oracle-data/latest_by_table/`

**Success Response (200):**

```json
[
  {
    "id": 100,
    "table": 1,
    "table_name": "USERS",
    "database_name": "ProductionDB",
    "server_name": "db-server-01",
    "record_count": 1500,
    "timestamp": "2024-08-07T10:30:00Z",
    "collection_duration": 2.5,
    "data_preview": [
      {
        "ID": 1,
        "NAME": "John Doe",
        "EMAIL": "john@example.com"
      }
    ]
  }
]
```

### 4. Oracle Monitoring Tasks

#### List Tasks

**GET** `/api/oracle-tasks/`

**Query Parameters:**

- `table_id` (optional): Filter by table ID
- `database_id` (optional): Filter by database ID
- `status` (optional): Filter by status

#### Get Task Statistics

**GET** `/api/oracle-tasks/statistics/`

**Success Response (200):**

```json
{
  "total_tasks": 1250,
  "status_breakdown": {
    "completed": 1000,
    "failed": 50,
    "running": 10,
    "pending": 190
  },
  "recent_tasks_24h": 150,
  "recent_failures_1h": 2
}
```

### 5. Oracle Dashboard

**GET/POST** `/api/oracle/dashboard/`

Get comprehensive dashboard data for Oracle monitoring.

**Success Response (200):**

```json
{
  "databases": {
    "total": 10,
    "connected": 9,
    "connection_rate": 90.0
  },
  "tables": {
    "total": 50,
    "actively_monitored": 45
  },
  "activity": {
    "recent_snapshots": 25,
    "recent_tasks": {
      "completed": 20,
      "failed": 2,
      "running": 3
    }
  },
  "latest_data": [
    {
      "table_name": "HR.USERS",
      "server_name": "db-server-01",
      "database_name": "ProductionDB",
      "record_count": 1500,
      "timestamp": "2024-08-07T10:30:00Z",
      "collection_duration": 2.5
    }
  ]
}
```

---

## Health & Debug APIs

### 1. Health Check

**GET** `/health/`

Check application health and database connectivity.

**Success Response (200):**

```json
{
  "status": "healthy",
  "timestamp": "2024-08-07T10:30:00Z",
  "database": "connected"
}
```

**Error Response (500):**

```json
{
  "status": "unhealthy",
  "error": "Database connection failed",
  "timestamp": "2024-08-07T10:30:00Z"
}
```

### 2. Debug

**GET** `/debug/`

Test URL routing.

**Success Response (200):**

```
Debug view is working! Your Django URL routing is correct.
```

---

## WebSocket Endpoints

### Base WebSocket URL Structure

`ws://your-domain.com/ws/`

### 1. VMStat Metrics WebSocket

**URL**: `ws://your-domain.com/ws/metrics/vmstat/{server_id}/`

**Connection**:

- Joins group: `vmstat_metrics_{server_id}`

**Message Format:**

```json
{
  "metric": "vmstat",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-08-07T10:30:00Z",
  "values": {
    "r": 2,
    "b": 0,
    "avm": 1024000,
    "fre": 512000,
    "pi": 10,
    "po": 5,
    "fr": 100,
    "interface_in": 50,
    "cs": 200,
    "us": 25.5,
    "sy": 15.2,
    "idle": 59.3
  },
  "id": 12345
}
```

### 2. IOStat Metrics WebSocket

**URL**: `ws://your-domain.com/ws/metrics/iostat/{server_id}/`

**Connection**:

- Joins group: `iostat_metrics_{server_id}`

**Message Format:**

```json
{
  "metric": "iostat",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-08-07T10:30:00Z",
  "values": {
    "disk": "sda1",
    "tps": 15.5,
    "kb_read": 1024.0,
    "kb_wrtn": 512.0,
    "kb_read_rate": 100.0,
    "kb_wrtn_rate": 50.0,
    "service_time": 5.5
  },
  "id": 12346
}
```

### 3. Netstat Metrics WebSocket

**URL**: `ws://your-domain.com/ws/metrics/netstat/{server_id}/`

**Connection**:

- Joins group: `netstat_metrics_{server_id}`

**Message Format:**

```json
{
  "metric": "netstat",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-08-07T10:30:00Z",
  "values": {
    "interface": "eth0",
    "ipkts": 1000000,
    "ierrs": 10,
    "ipkts_rate": 100.5,
    "ierrs_rate": 0.1,
    "opkts": 900000,
    "opkts_rate": 90.5,
    "oerrs": 5,
    "oerrs_rate": 0.05,
    "time": 1691404200
  },
  "id": 12347
}
```

### 4. Process Metrics WebSocket

**URL**: `ws://your-domain.com/ws/metrics/process/{server_id}/`

**Connection**:

- Joins group: `process_metrics_{server_id}`

**Message Format:**

```json
{
  "metric": "process",
  "server_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-08-07T10:30:00Z",
  "values": {
    "pid": 1234,
    "user": "root",
    "cpu": 15.5,
    "mem": 8.2,
    "command": "/usr/bin/python app.py"
  },
  "id": 12348
}
```

### 5. General Metrics WebSocket

**URL**: `ws://your-domain.com/ws/metrics/{server_id}/`

**Connection**:

- Joins group: `all_metrics_{server_id}`
- Receives all metric types for the specified server

**Message Format:** Same as individual metric websockets, but can receive any metric type.

### 6. Oracle Data Updates WebSocket

**URL**: `ws://your-domain.com/ws/oracle_updates_{server_id}/`

**Connection**:

- Joins group: `oracle_updates_{server_id}`

**Message Format:**

```json
{
  "type": "oracle_data_update",
  "server_id": 1,
  "server_name": "db-server-01",
  "database_id": 1,
  "database_name": "ProductionDB",
  "table_id": 1,
  "table_name": "USERS",
  "schema_name": "HR",
  "data": [
    {
      "ID": 1,
      "NAME": "John Doe",
      "EMAIL": "john@example.com",
      "CREATED_DATE": "2024-08-07T10:30:00Z"
    }
  ],
  "record_count": 1500,
  "changes_detected": true,
  "timestamp": "2024-08-07T10:30:00Z"
}
```

---

## Error Handling

### Common HTTP Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **204 No Content**: Request successful, no content returned
- **400 Bad Request**: Invalid request parameters or body
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error occurred

### Standard Error Response Format

```json
{
  "error": "Error message description",
  "details": "Additional error details (optional)",
  "timestamp": "2024-08-07T10:30:00Z"
}
```

### Validation Error Response Format

```json
{
  "error": "Validation error",
  "details": {
    "field_name": ["Error message for this field"],
    "another_field": ["Another error message"]
  }
}
```

---

## Authentication

Currently, all endpoints are configured with `AllowAll` permission, meaning no authentication is required. In a production environment, you would typically implement:

- Token-based authentication
- Session authentication
- JWT authentication
- API key authentication

The code includes commented imports for `TokenAuthentication` and `IsAuthenticated` which can be enabled when authentication is needed.

### Example Authentication Header (when enabled):

```http
Authorization: Token your-api-token-here
```

---

## Rate Limiting

Currently, no rate limiting is implemented. Consider implementing rate limiting for production use to prevent abuse.

## Pagination

Many list endpoints support pagination with these parameters:

- `page`: Page number (default: 1)
- `per_page`: Items per page (max varies by endpoint)

Pagination responses include:

- `count`: Total number of items
- `page`: Current page number
- `total_pages`: Total number of pages
- `has_next`: Whether there's a next page
- `has_previous`: Whether there's a previous page