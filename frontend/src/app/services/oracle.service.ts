// src/app/services/oracle.service.ts

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, interval } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface OracleDatabase {
  id: number;
  server_id: string;
  server_name: string;
  name: string;
  host: string;
  port: number;
  sid: string;
  username: string;
  password?: string;
  connection_timeout?: number;
  connection_status: string;
  connection_status_display: string;
  last_connection_test: string;
  monitored_tables_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;

}

export interface OracleTable {
  id: number;
  database_id: number;
  database_name: string;
  server_name: string;
  table_name: string;
  schema_name: string;
  full_table_name: string;
  is_active: boolean;
  polling_interval: number;
  columns_to_monitor: string[];
  where_clause: string;
  order_by: string;
  timestamp_column: string;
  primary_key_columns: string[];
  last_poll_time: string;
  last_record_count: number;
  monitoring_status: string;
  latest_snapshot: OracleSnapshot;
  created_at: string;
  updated_at: string;
}

export interface OracleSnapshot {
  id: number;
  record_count: number;
  timestamp: string;
  collection_duration: number;
}

export interface OracleTableData {
  id: number;
  table_id: number;
  table_name: string;
  database_name: string;
  server_name: string;
  data: any[];
  data_preview: any[];
  record_count: number;
  checksum: string;
  timestamp: string;
  collection_duration: number;
  errors: string;
}

export interface OracleMonitoringTask {
  id: number;
  table_id: number;
  table_name: string;
  database_name: string;
  server_name: string;
  status: string;
  status_display: string;
  started_at: string;
  completed_at: string;
  duration: number;
  duration_formatted: string;
  records_processed: number;
  changes_detected: boolean;
  error_message: string;
  created_at: string;
}

export interface DashboardData {
  databases: {
    total: number;
    connected: number;
    connection_rate: number;
  };
  tables: {
    total: number;
    actively_monitored: number;
  };
  activity: {
    recent_snapshots: number;
    recent_tasks: { [key: string]: number };
  };
  latest_data: Array<{
    table_name: string;
    server_name: string;
    database_name: string;
    record_count: number;
    timestamp: string;
    collection_duration: number;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class OracleService {
  private readonly apiUrl = environment.apiUrl || 'http://localhost:8000';

  // Real-time data subjects
  private dashboardDataSubject = new BehaviorSubject<DashboardData | null>(null);
  private tablesSubject = new BehaviorSubject<OracleTable[]>([]);
  private databasesSubject = new BehaviorSubject<OracleDatabase[]>([]);

  // Public observables
  dashboardData$ = this.dashboardDataSubject.asObservable();
  tables$ = this.tablesSubject.asObservable();
  databases$ = this.databasesSubject.asObservable();

  constructor(private http: HttpClient) {
    // Start auto-refresh for dashboard data
    this.startAutoRefresh();
  }

  // Dashboard Data
  getDashboardData(): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.apiUrl}/api/oracle/dashboard/`)
      .pipe(
        map(data => {
          this.dashboardDataSubject.next(data);
          return data;
        }),
        catchError(this.handleError)
      );
  }

  // Oracle Databases
  getDatabases(serverId?: string): Observable<OracleDatabase[]> {
    let params = new HttpParams();
    if (serverId) {
      params = params.set('server_id', serverId);
    }
    params = params.set('ordering', 'id');

    return this.http.get<OracleDatabase[]>(`${this.apiUrl}/api/oracle-databases/`, { params })
      .pipe(
        map(data => {
          this.databasesSubject.next(data);
          return data;
        }),
        catchError(this.handleError)
      );
  }

  getDatabase(id: number): Observable<OracleDatabase> {
    return this.http.get<OracleDatabase>(`${this.apiUrl}/api/oracle-databases/${id}/`)
      .pipe(catchError(this.handleError));
  }

  createDatabase(database: Partial<OracleDatabase>): Observable<OracleDatabase> {
    return this.http.post<OracleDatabase>(`${this.apiUrl}/api/oracle-databases/`, database)
      .pipe(catchError(this.handleError));
  }

  updateDatabase(id: number, database: Partial<OracleDatabase>): Observable<OracleDatabase> {
    return this.http.put<OracleDatabase>(`${this.apiUrl}/api/oracle-databases/${id}/`, database)
      .pipe(catchError(this.handleError));
  }

  deleteDatabase(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/api/oracle-databases/${id}/`)
      .pipe(catchError(this.handleError));
  }

  testDatabaseConnection(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/oracle-databases/${id}/test_connection/`, {})
      .pipe(catchError(this.handleError));
  }

  getDatabaseStatus(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/oracle-databases/${id}/status/`)
      .pipe(catchError(this.handleError));
  }

  // Oracle Tables
  getTables(filters?: { database_id?: number; server_id?: string }): Observable<OracleTable[]> {
    let params = new HttpParams();
    if (filters?.database_id) {
      params = params.set('database_id', filters.database_id.toString());
    }
    if (filters?.server_id) {
      params = params.set('server_id', filters.server_id);
    }

    // Add ordering
    params = params.set('ordering', 'id');

    return this.http.get<OracleTable[]>(`${this.apiUrl}/api/oracle-tables/`, { params })
      .pipe(
        map(data => {
          this.tablesSubject.next(data);
          return data;
        }),
        catchError(this.handleError)
      );
  }

  getTable(id: number): Observable<OracleTable> {
    return this.http.get<OracleTable>(`${this.apiUrl}/api/oracle-tables/${id}/`)
      .pipe(catchError(this.handleError));
  }

  createTable(table: Partial<OracleTable>): Observable<OracleTable> {
    return this.http.post<OracleTable>(`${this.apiUrl}/api/oracle-tables/`, table)
      .pipe(catchError(this.handleError));
  }

  updateTable(id: number, table: Partial<OracleTable>): Observable<OracleTable> {
    return this.http.put<OracleTable>(`${this.apiUrl}/api/oracle-tables/${id}/`, table)
      .pipe(catchError(this.handleError));
  }

  deleteTable(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/api/oracle-tables/${id}/`)
      .pipe(catchError(this.handleError));
  }

  monitorTableNow(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/api/oracle-tables/${id}/monitor_now/`, {})
      .pipe(catchError(this.handleError));
  }

  getCurrentTableData(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/oracle-tables/${id}/current_data/`)
      .pipe(catchError(this.handleError));
  }

  getTableHistory(id: number, limit: number = 10): Observable<any> {
    const params = new HttpParams().set('limit', limit.toString());
    return this.http.get(`${this.apiUrl}/api/oracle-tables/${id}/history/`, { params })
      .pipe(catchError(this.handleError));
  }

  getTableMonitoringTasks(id: number, limit: number = 20): Observable<OracleMonitoringTask[]> {
    const params = new HttpParams().set('limit', limit.toString());
    return this.http.get<OracleMonitoringTask[]>(`${this.apiUrl}/api/oracle-tables/${id}/monitoring_tasks/`, { params })
      .pipe(catchError(this.handleError));
  }

  updateTableConfig(id: number, config: any): Observable<OracleTable> {
    return this.http.post<OracleTable>(`${this.apiUrl}/api/oracle-tables/${id}/update_config/`, config)
      .pipe(catchError(this.handleError));
  }

  // Oracle Table Data
  getTableData(filters?: { table_id?: number; database_id?: number; server_id?: string }): Observable<OracleTableData[]> {
    let params = new HttpParams();
    if (filters?.table_id) {
      params = params.set('table_id', filters.table_id.toString());
    }
    if (filters?.database_id) {
      params = params.set('database_id', filters.database_id.toString());
    }
    if (filters?.server_id) {
      params = params.set('server_id', filters.server_id);
    }

    return this.http.get<OracleTableData[]>(`${this.apiUrl}/api/oracle-data/`, { params })
      .pipe(catchError(this.handleError));
  }

  getLatestDataByTable(): Observable<OracleTableData[]> {
    return this.http.get<OracleTableData[]>(`${this.apiUrl}/api/oracle-data/latest_by_table/`)
      .pipe(catchError(this.handleError));
  }

  // Monitoring Tasks
  getMonitoringTasks(filters?: { table_id?: number; database_id?: number; status?: string }): Observable<OracleMonitoringTask[]> {
    let params = new HttpParams();
    if (filters?.table_id) {
      params = params.set('table_id', filters.table_id.toString());
    }
    if (filters?.database_id) {
      params = params.set('database_id', filters.database_id.toString());
    }
    if (filters?.status) {
      params = params.set('status', filters.status);
    }

    return this.http.get<OracleMonitoringTask[]>(`${this.apiUrl}/api/oracle-tasks/`, { params })
      .pipe(catchError(this.handleError));
  }

  getMonitoringTaskStatistics(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/oracle-tasks/statistics/`)
      .pipe(catchError(this.handleError));
  }

  // Utility methods
  private startAutoRefresh(): void {
    // Refresh dashboard data every 30 seconds
    interval(30000).subscribe(() => {
      this.getDashboardData().subscribe();
    });

    // Refresh tables every 60 seconds
    interval(60000).subscribe(() => {
      this.getTables().subscribe();
    });
  }

  refreshData(): void {
    this.getDashboardData().subscribe();
    this.getTables().subscribe();
    this.getDatabases().subscribe();
  }

  // Get monitoring status with color coding
  getMonitoringStatusColor(status: string): string {
    const statusColors = {
      'active': 'success',
      'running': 'info',
      'inactive': 'basic',
      'never_polled': 'warning',
      'overdue': 'danger',
      'error': 'danger'
    };
    return statusColors[status] || 'basic';
  }

  // Get connection status with color coding
  getConnectionStatusColor(status: string): string {
    const statusColors = {
      'connected': 'success',
      'testing': 'info',
      'failed': 'danger',
      'timeout': 'warning',
      'unknown': 'basic'
    };
    return statusColors[status] || 'basic';
  }

  // Format duration
  formatDuration(seconds: number): string {
    if (seconds < 1) {
      return `${(seconds * 1000).toFixed(0)}ms`;
    } else if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.floor(seconds % 60);
      return `${minutes}m ${remainingSeconds}s`;
    }
  }

  // Error handler
  private handleError = (error: any): Observable<never> => {
    console.error('Oracle Service Error:', error);
    throw error;
  };
}