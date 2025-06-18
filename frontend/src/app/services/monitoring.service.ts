// src/app/services/monitoring.service.ts
import { Injectable } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { Observable } from "rxjs";
import { map, catchError, tap } from "rxjs/operators";
import { of } from "rxjs";

// Data Interfaces
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
  id?: number;
  timestamp: string;
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
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
}

export interface ApiResponse<T> {
  status: string;
  data: T[];
  timestamp: string;
  count?: number;
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
  private readonly baseUrl = "http://localhost:8000/api/metrics";

  constructor(private http: HttpClient) {}

  // Generic method to fetch historical data
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
      .get<ApiResponse<T>>(`${this.baseUrl}/historical/`, { params })
      .pipe(
        tap((response: ApiResponse<T>) => {
          console.log(`Historical ${metric} API response:`, response);
          console.log(`Data count: ${response.data?.length || 0}`);
        }),
        map((response: ApiResponse<T>) => ({
          data: response.data || [],
          status: response.status || "success",
          timestamp: response.timestamp || new Date().toISOString(),
          count: response.data?.length || 0,
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

  // Historical Data Methods
  getHistoricalVmstat(dateRange: DateTimeRange): Observable<ApiResponse<VmstatData>> {
    return this.getHistoricalData<VmstatData>('vmstat', dateRange);
  }

  getHistoricalNetstat(dateRange: DateTimeRange): Observable<ApiResponse<NetstatData>> {
    return this.getHistoricalData<NetstatData>('netstat', dateRange);
  }

  getHistoricalIostat(dateRange: DateTimeRange): Observable<ApiResponse<IostatData>> {
    return this.getHistoricalData<IostatData>('iostat', dateRange);
  }

  getHistoricalProcesses(
    dateRange: DateTimeRange,
    pid?: number
  ): Observable<ApiResponse<ProcessData>> {
    const additionalParams = pid ? { pid: pid.toString() } : undefined;
    return this.getHistoricalData<ProcessData>('process', dateRange, additionalParams);
  }

  // Get historical data for multiple metrics at once
  getHistoricalMetrics(
    dateRange: DateTimeRange,
    metrics: MetricType[] = ['vmstat', 'netstat', 'iostat', 'process']
  ): Observable<{
    vmstat?: ApiResponse<VmstatData>;
    netstat?: ApiResponse<NetstatData>;
    iostat?: ApiResponse<IostatData>;
    process?: ApiResponse<ProcessData>;
  }> {
    const requests: { [key: string]: Observable<ApiResponse<any>> } = {};

    if (metrics.includes('vmstat')) {
      requests['vmstat'] = this.getHistoricalVmstat(dateRange);
    }
    if (metrics.includes('netstat')) {
      requests['netstat'] = this.getHistoricalNetstat(dateRange);
    }
    if (metrics.includes('iostat')) {
      requests['iostat'] = this.getHistoricalIostat(dateRange);
    }
    if (metrics.includes('process')) {
      requests['process'] = this.getHistoricalProcesses(dateRange);
    }

    // Use forkJoin to make parallel requests
    const { forkJoin } = require('rxjs');
    return forkJoin(requests);
  }

  // System Analysis Methods
  calculateSystemSummary(
    vmstatData: VmstatData[],
    netstatData: NetstatData[],
    iostatData: IostatData[]
  ): SystemSummary {
    if (!vmstatData.length) {
      return this.getEmptySystemSummary();
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
      process_count: 0, // Will be updated by process data
      uptime: 0,
    };
  }

  private getEmptySystemSummary(): SystemSummary {
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
    };
  }

  // Data Analysis Helpers
  getMetricTrends(data: VmstatData[]): {
    cpuTrend: 'increasing' | 'decreasing' | 'stable';
    memoryTrend: 'increasing' | 'decreasing' | 'stable';
    loadTrend: 'increasing' | 'decreasing' | 'stable';
  } {
    if (data.length < 2) {
      return { cpuTrend: 'stable', memoryTrend: 'stable', loadTrend: 'stable' };
    }

    const recent = data.slice(-5); // Last 5 data points
    const older = data.slice(-10, -5); // Previous 5 data points

    const getAverage = (arr: VmstatData[], field: keyof VmstatData): number => {
      return arr.reduce((sum, item) => sum + (item[field] as number), 0) / arr.length;
    };

    const getTrend = (recentAvg: number, olderAvg: number): 'increasing' | 'decreasing' | 'stable' => {
      const diff = Math.abs(recentAvg - olderAvg);
      const threshold = olderAvg * 0.1; // 10% threshold
      
      if (diff < threshold) return 'stable';
      return recentAvg > olderAvg ? 'increasing' : 'decreasing';
    };

    const recentCpu = 100 - getAverage(recent, 'idle');
    const olderCpu = 100 - getAverage(older, 'idle');
    
    const recentMemory = getAverage(recent, 'avm');
    const olderMemory = getAverage(older, 'avm');
    
    const recentLoad = getAverage(recent, 'r');
    const olderLoad = getAverage(older, 'r');

    return {
      cpuTrend: getTrend(recentCpu, olderCpu),
      memoryTrend: getTrend(recentMemory, olderMemory),
      loadTrend: getTrend(recentLoad, olderLoad),
    };
  }

  // Date/Time Utility Methods
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

  // Predefined date ranges for common use cases
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
}