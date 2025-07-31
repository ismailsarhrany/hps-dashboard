// src/app/services/monitoring.service.ts
import { Injectable } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { Observable } from "rxjs";
import { map, catchError, tap } from "rxjs/operators";
import { of } from "rxjs";

// Data Interfaces - Updated with server information
export interface VmstatData {
  timestamp: string;
  us: number;
  sy: number;
  idle: number;
  avm: number;
  r: number;
  b: number;
  fre: number;
  pi: number;
  po: number;
  fr: number;
  interface_in: number;
  cs: number;
  server_hostname?: string; // Added for multi-server support
  server_id?: string;
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
  server_hostname?: string;
  server_id?: string;
}

export interface IostatData {
  timestamp: string;
  disk: string;
  tps: number;
  kb_read: number;
  kb_wrtn: number;
  service_time: number;
  server_hostname?: string;
  server_id?: string;
}

export interface ProcessData {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
  timestamp: string;
  server_hostname?: string;
  server_id?: string;
  // For aggregated data
  avg_cpu?: number;
  max_cpu?: number;
  min_cpu?: number;
  avg_mem?: number;
  max_mem?: number;
  min_mem?: number;
  count?: number;
  // Legacy stats property for backward compatibility
  stats?: {
    avgCpu: number;
    peakCpu: number;
    avgMem: number;
    peakMem: number;
  };
}

// New interface for server management
export interface Server {
  id: string;
  hostname: string;
  ip_address: string;
  ssh_username: string;
  os_type: 'linux' | 'windows' | 'aix';
  status: 'active' | 'inactive';
  monitoring_interval: number;
  created_at: string;
  updated_at: string;
}

// New interface specifically for aggregated process data
export interface AggregatedProcessData {
  timestamp: string;
  pid: number;
  command: string;
  user: string;
  avg_cpu: number;
  max_cpu: number;
  min_cpu: number;
  avg_mem: number;
  max_mem: number;
  min_mem: number;
  count: number;
  server_hostname?: string;
  server_id?: string;
}

export interface SystemSummary {
  cpu_usage: number;
  memory_usage: number;
  disk_read: number;
  disk_write: number;
  network_packets: number;
  network_errors: number;
  system_load: number;
  process_count: number;
  uptime: number;
  server_hostname?: string;
  server_id?: string;
}

export interface ApiResponse<T> {
  status: string;
  data: T[];
  timestamp: string;
  count?: number;
  total_count?: number;
  page?: number;
  total_pages?: number;
  has_next?: boolean;
  has_previous?: boolean;
  metric?: string;
  interval_seconds?: number;
  pids_filtered?: number[];
  warning?: string;
  start_time?: string;
  end_time?: string;
}

// New interface for server list response
export interface ServerListResponse {
  count: number;
  page: number;
  total_pages: number;
  servers: Server[];
}

export interface DateTimeRange {
  start: string;
  end: string;
}

export type MetricType = 'vmstat' | 'netstat' | 'iostat' | 'process';

@Injectable({
  providedIn: "root",
})
export class ApiService {
  private readonly baseUrl = "http://localhost:8000/api";

  constructor(private http: HttpClient) { }

  // Server Management Methods
  getServers(status?: 'active' | 'inactive', page: number = 1, perPage: number = 20): Observable<ServerListResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('per_page', perPage.toString());

    if (status) {
      params = params.set('status', status);
    }

    return this.http
      .get<ServerListResponse>(`${this.baseUrl}/servers/`, { params })
      .pipe(
        tap((response) => {
          console.log(`Servers API response:`, response);
        }),
        catchError((error) => {
          console.error('Error fetching servers:', error);
          return of({
            count: 0,
            page: 1,
            total_pages: 0,
            servers: []
          } as ServerListResponse);
        })
      );
  }

  createServer(serverData: Partial<Server>): Observable<{ status: string; server: Server }> {
    return this.http
      .post<{ status: string; server: Server }>(`${this.baseUrl}/servers/create/`, serverData)
      .pipe(
        tap((response) => {
          console.log('Server created:', response);
        }),
        catchError((error) => {
          console.error('Error creating server:', error);
          throw error;
        })
      );
  }

  testServerConnection(serverId: string): Observable<{ status: string; server_id: string; hostname: string; output: string }> {
    return this.http
      .post<{ status: string; server_id: string; hostname: string; output: string }>(`${this.baseUrl}/servers/${serverId}/test-connection/`, {})
      .pipe(
        tap((response) => {
          console.log('Connection test result:', response);
        }),
        catchError((error) => {
          console.error('Error testing connection:', error);
          throw error;
        })
      );
  }

  // Realtime Metrics Methods
  getRealtimeMetrics(metric: MetricType, serverId?: string): Observable<ApiResponse<any>> {
    let params = new HttpParams().set('metric', metric);

    if (serverId) {
      params = params.set('server_id', serverId);
    }

    return this.http
      .get<ApiResponse<any>>(`${this.baseUrl}/metrics/realtime/`, { params })
      .pipe(
        tap((response) => {
          console.log(`Realtime ${metric} API response:`, response);
        }),
        catchError((error) => {
          console.error(`Error fetching realtime ${metric}:`, error);
          return of({
            status: "error",
            data: [],
            timestamp: new Date().toISOString(),
            count: 0,
          } as ApiResponse<any>);
        })
      );
  }

  // Generic method to fetch historical data with server support
  private getHistoricalData<T>(
    metric: MetricType,
    dateRange: DateTimeRange,
    additionalParams?: { [key: string]: string }
  ): Observable<ApiResponse<T>> {
    let params = new HttpParams()
      .set("metric", metric)
      .set("start", dateRange.start)
      .set("end", dateRange.end);

    // Add any additional parameters
    if (additionalParams) {
      Object.keys(additionalParams).forEach(key => {
        params = params.set(key, additionalParams[key]);
      });
    }

    return this.http
      .get<ApiResponse<T>>(`${this.baseUrl}/metrics/historical/`, { params })
      .pipe(
        tap((response: ApiResponse<T>) => {
          console.log(`Historical ${metric} API response:`, response);
          console.log(`Data count: ${response.data?.length || 0}`);
          if (response.interval_seconds) {
            console.log(`Aggregation interval: ${response.interval_seconds} seconds`);
          }
          if (response.warning) {
            console.warn(`API Warning: ${response.warning}`);
          }
        }),
        map((response: ApiResponse<T>) => ({
          data: response.data || [],
          status: response.status || "success",
          timestamp: response.timestamp || new Date().toISOString(),
          count: response.data?.length || 0,
          total_count: response.total_count,
          page: response.page,
          total_pages: response.total_pages,
          has_next: response.has_next,
          has_previous: response.has_previous,
          metric: response.metric,
          interval_seconds: response.interval_seconds,
          pids_filtered: response.pids_filtered,
          warning: response.warning,
          start_time: response.start_time,
          end_time: response.end_time,
        } as ApiResponse<T>)),
        catchError((error) => {
          console.error(`Error fetching historical ${metric}:`, error);
          console.error("Error details:", {
            status: error.status,
            message: error.message,
            url: error.url,
            params: params.toString(),
          });
          return of({
            status: "error",
            data: [],
            timestamp: new Date().toISOString(),
            count: 0,
          } as ApiResponse<T>);
        })
      );
  }

  // Historical Data Methods with server support
  getHistoricalVmstat(dateRange: DateTimeRange, serverId?: string): Observable<ApiResponse<VmstatData>> {
    const params = serverId ? { server_id: serverId } : undefined;
    return this.getHistoricalData<VmstatData>('vmstat', dateRange, params);
  }

  getHistoricalNetstat(dateRange: DateTimeRange, serverId?: string): Observable<ApiResponse<NetstatData>> {
    const params = serverId ? { server_id: serverId } : undefined;
    return this.getHistoricalData<NetstatData>('netstat', dateRange, params);
  }

  getHistoricalIostat(dateRange: DateTimeRange, serverId?: string): Observable<ApiResponse<IostatData>> {
    const params = serverId ? { server_id: serverId } : undefined;
    return this.getHistoricalData<IostatData>('iostat', dateRange, params);
  }

  // Updated method to handle process data with aggregation support and server filtering
  getHistoricalProcesses(
    dateRange: DateTimeRange,
    options?: {
      pids?: number[];
      interval?: number;
      page?: number;
      serverId?: string;
    }
  ): Observable<ApiResponse<AggregatedProcessData>> {
    const additionalParams: { [key: string]: string } = {};

    if (options?.pids && options.pids.length > 0) {
      additionalParams['pids'] = options.pids.join(',');
    }

    if (options?.interval) {
      additionalParams['interval'] = options.interval.toString();
    }

    if (options?.page) {
      additionalParams['page'] = options.page.toString();
    }

    if (options?.serverId) {
      additionalParams['server_id'] = options.serverId;
    }

    return this.getHistoricalData<AggregatedProcessData>('process', dateRange, additionalParams);
  }

  // Get historical data for multiple metrics at once for a specific server
  getHistoricalMetrics(
    dateRange: DateTimeRange,
    serverId?: string,
    metrics: MetricType[] = ['vmstat', 'netstat', 'iostat', 'process']
  ): Observable<{
    vmstat?: ApiResponse<VmstatData>;
    netstat?: ApiResponse<NetstatData>;
    iostat?: ApiResponse<IostatData>;
    process?: ApiResponse<AggregatedProcessData>;
  }> {
    const requests: { [key: string]: Observable<ApiResponse<any>> } = {};

    if (metrics.includes('vmstat')) {
      requests['vmstat'] = this.getHistoricalVmstat(dateRange, serverId);
    }
    if (metrics.includes('netstat')) {
      requests['netstat'] = this.getHistoricalNetstat(dateRange, serverId);
    }
    if (metrics.includes('iostat')) {
      requests['iostat'] = this.getHistoricalIostat(dateRange, serverId);
    }
    if (metrics.includes('process')) {
      requests['process'] = this.getHistoricalProcesses(dateRange, { serverId });
    }

    // Use forkJoin to make parallel requests
    const { forkJoin } = require('rxjs');
    return forkJoin(requests);
  }

  // Server-specific analysis methods
  getServerSystemSummary(
    serverId: string,
    vmstatData: VmstatData[],
    netstatData: NetstatData[],
    iostatData: IostatData[],
    processData?: AggregatedProcessData[]
  ): SystemSummary {
    if (!vmstatData.length) {
      return this.getEmptySystemSummary(serverId);
    }

    const latestVmstat = vmstatData[vmstatData.length - 1];
    const cpuUsage = 100 - latestVmstat.idle;
    const totalMemory = latestVmstat.avm + latestVmstat.fre;
    const memoryUsage = totalMemory > 0 ? (latestVmstat.avm / totalMemory) * 100 : 0;

    const totalDiskRead = iostatData.reduce((sum, data) => sum + data.kb_read, 0);
    const totalDiskWrite = iostatData.reduce((sum, data) => sum + data.kb_wrtn, 0);

    const totalNetworkPackets = netstatData.reduce(
      (sum, data) => sum + data.ipkts_rate + data.opkts_rate,
      0
    );
    const totalNetworkErrors = netstatData.reduce(
      (sum, data) => sum + data.ierrs + data.oerrs,
      0
    );

    return {
      cpu_usage: Math.round(cpuUsage * 100) / 100,
      memory_usage: Math.round(memoryUsage * 100) / 100,
      disk_read: totalDiskRead,
      disk_write: totalDiskWrite,
      network_packets: totalNetworkPackets,
      network_errors: totalNetworkErrors,
      system_load: latestVmstat.r,
      process_count: processData?.length || 0,
      uptime: 0,
      server_id: serverId,
      server_hostname: latestVmstat.server_hostname,
    };
  }

  private getEmptySystemSummary(serverId?: string): SystemSummary {
    return {
      cpu_usage: 0,
      memory_usage: 0,
      disk_read: 0,
      disk_write: 0,
      network_packets: 0,
      network_errors: 0,
      system_load: 0,
      process_count: 0,
      uptime: 0,
      server_id: serverId,
    };
  }

  // Group data by server
  groupDataByServer<T extends { server_hostname?: string; server_id?: string }>(
    data: T[]
  ): { [serverHostname: string]: T[] } {
    return data.reduce((acc, item) => {
      const hostname = item.server_hostname || 'Unknown Server';
      if (!acc[hostname]) {
        acc[hostname] = [];
      }
      acc[hostname].push(item);
      return acc;
    }, {} as { [serverHostname: string]: T[] });
  }

  // Get available servers from data
  getAvailableServersFromData<T extends { server_hostname?: string; server_id?: string }>(
    data: T[]
  ): { hostname: string; serverId?: string }[] {
    const serverMap = new Map<string, string>();

    data.forEach(item => {
      if (item.server_hostname) {
        serverMap.set(item.server_hostname, item.server_id || '');
      }
    });

    return Array.from(serverMap.entries()).map(([hostname, serverId]) => ({
      hostname,
      serverId: serverId || undefined
    }));
  }

  // Existing utility methods remain the same
  formatDateTimeForApi(date: Date, time: string = "00:00:00"): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T${time}`;
  }

  getCurrentDateTime(): string {
    return new Date().toISOString();
  }

  getDateRange(days: number = 1): DateTimeRange {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  getCommonDateRanges(): { [key: string]: DateTimeRange } {
    const now = new Date();
    const ranges: { [key: string]: DateTimeRange } = {};

    // Last hour
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
    ranges['lastHour'] = {
      start: lastHour.toISOString(),
      end: now.toISOString(),
    };

    // Last 24 hours
    ranges['last24Hours'] = this.getDateRange(1);

    // Last week
    ranges['lastWeek'] = this.getDateRange(7);

    // Last month
    ranges['lastMonth'] = this.getDateRange(30);

    return ranges;
  }

  getOptimalInterval(dateRange: DateTimeRange): number {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    const rangeSeconds = (end.getTime() - start.getTime()) / 1000;

    if (rangeSeconds <= 3600) {      // 1 hour
      return 60;                     // 1 minute
    } else if (rangeSeconds <= 86400) { // 1 day
      return 300;                    // 5 minutes
    } else if (rangeSeconds <= 604800) { // 1 week
      return 1800;                   // 30 minutes
    } else if (rangeSeconds <= 2592000) { // 30 days
      return 3600;                   // 1 hour
    } else {
      return 7200;                   // 2 hours
    }
  }
}