// src/app/services/monitoring.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Data interfaces
export interface VmstatData {
  timestamp: string;
  r: number;
  b: number;
  avm: number;
  fre: number;
  us: number;
  sy: number;
  idle: number;
}
export interface NetstatData {
  timestamp: string;
  interface: string;
  ipkts: number;
  ierrs: number;
  opkts: number;
  oerrs: number;
  ipkts_rate: number;
  opkts_rate: number;
  ierrs_rate: number;
  oerrs_rate: number;
  time: string;
}

export interface IostatData {
  timestamp: string;
  disk: string;
  tps: number;
  kb_read: number;
  kb_wrtn: number;
  service_time: number;
}

export interface ProcessData {
  pid: number;
  command: string;
  user: string;
  cpu: number;
  mem: number;
  timestamp: string;
}

export interface AggregatedProcessData {
  pid: number;
  command: string;
  user: string;
  avg_cpu: number;
  max_cpu: number;
  avg_mem: number;
  max_mem: number;
  count: number;
  timestamp: string;
}

export interface DateTimeRange {
  start: string;
  end: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
  server_id?: string;
  server_hostname?: string;
}

export interface MetricType {
  vmstat: 'vmstat';
  iostat: 'iostat';
  netstat: 'netstat';
  process: 'process';
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = `${environment.apiUrl}/api/metrics`;

  constructor(private http: HttpClient) {}

  // --- Historical Data Methods (Server-Aware) ---

  /**
   * Get historical vmstat data for a specific server
   */
  getHistoricalVmstat(
    serverId: string, 
    dateRange: DateTimeRange, 
    interval?: number
  ): Observable<ApiResponse<VmstatData[]>> {
    let params = new HttpParams()
      .set('server_id', serverId)
      .set('metric', 'vmstat')
      .set('start', dateRange.start)
      .set('end', dateRange.end);

    if (interval) {
      params = params.set('interval', interval.toString());
    }

    return this.http.get<ApiResponse<VmstatData[]>>(`${this.baseUrl}/historical/`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get historical process data for a specific server
   */
  getHistoricalProcesses(
    serverId: string, 
    dateRange: DateTimeRange
  ): Observable<ApiResponse<AggregatedProcessData[]>> {
    const params = new HttpParams()
      .set('server_id', serverId)
      .set('metric', 'process')
      .set('start', dateRange.start)
      .set('end', dateRange.end);

    return this.http.get<ApiResponse<AggregatedProcessData[]>>(`${this.baseUrl}/historical/`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get historical iostat data for a specific server
   */
  getHistoricalIostat(
    serverId: string, 
    dateRange: DateTimeRange
  ): Observable<ApiResponse<any[]>> {
    const params = new HttpParams()
      .set('server_id', serverId)
      .set('metric', 'iostat')
      .set('start', dateRange.start)
      .set('end', dateRange.end);

    return this.http.get<ApiResponse<any[]>>(`${this.baseUrl}/historical/`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get historical netstat data for a specific server
   */
  getHistoricalNetstat(
    serverId: string, 
    dateRange: DateTimeRange
  ): Observable<ApiResponse<any[]>> {
    const params = new HttpParams()
      .set('server_id', serverId)
      .set('metric', 'netstat')
      .set('start', dateRange.start)  
      .set('end', dateRange.end);

    return this.http.get<ApiResponse<any[]>>(`${this.baseUrl}/historical/`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Generic method to get any historical metric
   */
  getHistoricalMetric<T = any>(
    serverId: string,
    metric: keyof MetricType,
    dateRange: DateTimeRange,
    options?: {
      interval?: number;
      limit?: number;
      offset?: number;
    }
  ): Observable<ApiResponse<T[]>> {
    let params = new HttpParams()
      .set('server_id', serverId)
      .set('metric', metric)
      .set('start', dateRange.start)
      .set('end', dateRange.end);

    if (options?.interval) {
      params = params.set('interval', options.interval.toString());
    }
    if (options?.limit) {
      params = params.set('limit', options.limit.toString());
    }
    if (options?.offset) {
      params = params.set('offset', options.offset.toString());
    }

    return this.http.get<ApiResponse<T[]>>(`${this.baseUrl}/historical/`, { params })
      .pipe(catchError(this.handleError));
  }

  // --- Realtime Data Methods (Server-Aware) ---

  /**
   * Get current realtime snapshot for a specific server
   */
  getRealtimeSnapshot(
    serverId: string,
    metrics?: (keyof MetricType)[]
  ): Observable<ApiResponse<any>> {
    let params = new HttpParams().set('server_id', serverId);
    
    if (metrics && metrics.length > 0) {
      params = params.set('metrics', metrics.join(','));
    }

    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/realtime/`, { params })
      .pipe(catchError(this.handleError));
  }

  // --- Utility Methods ---

  /**
   * Generate date range for common periods
   */
  getDateRange(hours: number): DateTimeRange {
    const end = new Date();
    const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
    
    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  }

  /**
   * Generate date range for days
   */
  getDateRangeDays(days: number): DateTimeRange {
    const end = new Date();
    const start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));
    
    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  }

  /**
   * Validate date range
   */
  validateDateRange(dateRange: DateTimeRange): boolean {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return false;
    }
    
    return start < end;
  }

  /**
   * Format date for API consumption
   */
  formatDateForApi(date: Date): string {
    return date.toISOString();
  }

  /**
   * Parse API date response
   */
  parseApiDate(dateString: string): Date {
    return new Date(dateString);
  }

  // --- Health Check ---
  
  /**
   * Check if metrics API is healthy for a server
   */
  checkServerHealth(serverId: string): Observable<{status: string; message: string}> {
    const params = new HttpParams().set('server_id', serverId);
    
    return this.http.get<{status: string; message: string}>(`${environment.apiUrl}/health/`, { params })
      .pipe(catchError(this.handleError));
  }

  // --- Error Handling ---

  private handleError = (error: HttpErrorResponse) => {
    console.error('MonitoringService Error:', error);
    
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Client Error: ${error.error.message}`;
    } else {
      // Server-side error
      errorMessage = `Server Error: ${error.status} - ${error.message}`;
      
      // Handle specific API error responses
      if (error.error?.message) {
        errorMessage = error.error.message;
      } else if (error.error?.error) {
        errorMessage = error.error.error;
      }
      
      // Handle common HTTP status codes
      switch (error.status) {
        case 400:
          errorMessage = 'Bad Request: ' + (error.error?.message || 'Invalid parameters provided');
          break;
        case 404:
          errorMessage = 'Server or data not found';
          break;
        case 500:
          errorMessage = 'Internal Server Error: Please try again later';
          break; 
        case 503:
          errorMessage = 'Service Unavailable: Server monitoring service is down';
          break;
      }
    }
    
    return throwError(() => new Error(errorMessage));
  };

  // --- Backward Compatibility Methods (deprecated) ---
  
  /**
   * @deprecated Use getHistoricalVmstat with serverId instead
   */
  getHistoricalVmstatLegacy(dateRange: DateTimeRange): Observable<ApiResponse<VmstatData[]>> {
    console.warn('getHistoricalVmstat without serverId is deprecated');
    // Assume first server or throw error
    throw new Error('Server ID is required for historical data requests');
  }

  /**
   * @deprecated Use getHistoricalProcesses with serverId instead
   */
  getHistoricalProcessesLegacy(dateRange: DateTimeRange): Observable<ApiResponse<AggregatedProcessData[]>> {
    console.warn('getHistoricalProcesses without serverId is deprecated');
    throw new Error('Server ID is required for historical data requests');
  }
}