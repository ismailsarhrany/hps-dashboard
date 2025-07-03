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

// Updated ProcessData interface to handle both raw and aggregated data
export interface ProcessData {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
  timestamp: string;
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
  total_count?: number;
  page?: number;
  total_pages?: number;
  has_next?: boolean;
  has_previous?: boolean;
  metric?: string;
  interval_seconds?: number;
  pids_filtered?: number[];
  warning?: string;
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

  // Updated method to handle process data with aggregation support
  getHistoricalProcesses(
    dateRange: DateTimeRange,
    options?: {
      pids?: number[];
      interval?: number;
      page?: number;
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

    return this.getHistoricalData<AggregatedProcessData>('process', dateRange, additionalParams);
  }

  // Backward compatibility method for legacy ProcessData
  getHistoricalProcessesLegacy(
    dateRange: DateTimeRange,
    pid?: number
  ): Observable<ApiResponse<ProcessData>> {
    const options = pid ? { pids: [pid] } : undefined;
    return this.getHistoricalProcesses(dateRange, options).pipe(
      map((response: ApiResponse<AggregatedProcessData>) => ({
        ...response,
        data: response.data.map(this.convertAggregatedToLegacy),
      } as ApiResponse<ProcessData>))
    );
  }

  // Convert aggregated process data to legacy format
  private convertAggregatedToLegacy(aggregated: AggregatedProcessData): ProcessData {
    return {
      pid: aggregated.pid,
      user: aggregated.user,
      cpu: aggregated.avg_cpu, // Use average CPU for main cpu field
      mem: aggregated.avg_mem, // Use average memory for main mem field
      command: aggregated.command,
      timestamp: aggregated.timestamp,
      avg_cpu: aggregated.avg_cpu,
      max_cpu: aggregated.max_cpu,
      min_cpu: aggregated.min_cpu,
      avg_mem: aggregated.avg_mem,
      max_mem: aggregated.max_mem,
      min_mem: aggregated.min_mem,
      count: aggregated.count,
      stats: {
        avgCpu: aggregated.avg_cpu,
        peakCpu: aggregated.max_cpu,
        avgMem: aggregated.avg_mem,
        peakMem: aggregated.max_mem,
      },
    };
  }

  // Get historical data for multiple metrics at once
  getHistoricalMetrics(
    dateRange: DateTimeRange,
    metrics: MetricType[] = ['vmstat', 'netstat', 'iostat', 'process']
  ): Observable<{
    vmstat?: ApiResponse<VmstatData>;
    netstat?: ApiResponse<NetstatData>;
    iostat?: ApiResponse<IostatData>;
    process?: ApiResponse<AggregatedProcessData>;
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

  // Process Data Analysis Methods
  getTopProcessesByCpu(
    processData: AggregatedProcessData[],
    limit: number = 10
  ): AggregatedProcessData[] {
    return processData
      .sort((a, b) => b.avg_cpu - a.avg_cpu)
      .slice(0, limit);
  }

  getTopProcessesByMemory(
    processData: AggregatedProcessData[],
    limit: number = 10
  ): AggregatedProcessData[] {
    return processData
      .sort((a, b) => b.avg_mem - a.avg_mem)
      .slice(0, limit);
  }

  getProcessStats(processData: AggregatedProcessData[]): {
    totalProcesses: number;
    totalCpuUsage: number;
    totalMemUsage: number;
    avgCpuPerProcess: number;
    avgMemPerProcess: number;
    peakCpuProcess: AggregatedProcessData | null;
    peakMemProcess: AggregatedProcessData | null;
  } {
    if (processData.length === 0) {
      return {
        totalProcesses: 0,
        totalCpuUsage: 0,
        totalMemUsage: 0,
        avgCpuPerProcess: 0,
        avgMemPerProcess: 0,
        peakCpuProcess: null,
        peakMemProcess: null,
      };
    }

    const totalCpuUsage = processData.reduce((sum, p) => sum + p.avg_cpu, 0);
    const totalMemUsage = processData.reduce((sum, p) => sum + p.avg_mem, 0);
    
    const peakCpuProcess = processData.reduce((max, p) => 
      p.max_cpu > (max?.max_cpu || 0) ? p : max, processData[0]);
    
    const peakMemProcess = processData.reduce((max, p) => 
      p.max_mem > (max?.max_mem || 0) ? p : max, processData[0]);

    return {
      totalProcesses: processData.length,
      totalCpuUsage,
      totalMemUsage,
      avgCpuPerProcess: totalCpuUsage / processData.length,
      avgMemPerProcess: totalMemUsage / processData.length,
      peakCpuProcess,
      peakMemProcess,
    };
  }

  // System Analysis Methods
  calculateSystemSummary(
    vmstatData: VmstatData[],
    netstatData: NetstatData[],
    iostatData: IostatData[],
    processData?: AggregatedProcessData[]
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
      process_count: processData?.length || 0,
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

  // Process Trend Analysis
  getProcessTrends(processData: AggregatedProcessData[]): {
    [pid: number]: {
      pid: number;
      command: string;
      cpuTrend: 'increasing' | 'decreasing' | 'stable';
      memTrend: 'increasing' | 'decreasing' | 'stable';
      avgCpu: number;
      avgMem: number;
      peakCpu: number;
      peakMem: number;
    };
  } {
    const trends: { [pid: number]: any } = {};
    
    // Group by PID to analyze trends over time
    const groupedByPid = processData.reduce((acc, process) => {
      if (!acc[process.pid]) {
        acc[process.pid] = [];
      }
      acc[process.pid].push(process);
      return acc;
    }, {} as { [pid: number]: AggregatedProcessData[] });

    Object.keys(groupedByPid).forEach(pidStr => {
      const pid = parseInt(pidStr);
      const processes = groupedByPid[pid].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      if (processes.length >= 2) {
        const recent = processes.slice(-Math.ceil(processes.length / 2));
        const older = processes.slice(0, Math.floor(processes.length / 2));

        const recentAvgCpu = recent.reduce((sum, p) => sum + p.avg_cpu, 0) / recent.length;
        const olderAvgCpu = older.reduce((sum, p) => sum + p.avg_cpu, 0) / older.length;
        
        const recentAvgMem = recent.reduce((sum, p) => sum + p.avg_mem, 0) / recent.length;
        const olderAvgMem = older.reduce((sum, p) => sum + p.avg_mem, 0) / older.length;

        const getCpuTrend = (recent: number, older: number): 'increasing' | 'decreasing' | 'stable' => {
          const diff = Math.abs(recent - older);
          const threshold = older * 0.2; // 20% threshold
          
          if (diff < threshold) return 'stable';
          return recent > older ? 'increasing' : 'decreasing';
        };

        trends[pid] = {
          pid,
          command: processes[0].command,
          cpuTrend: getCpuTrend(recentAvgCpu, olderAvgCpu),
          memTrend: getCpuTrend(recentAvgMem, olderAvgMem),
          avgCpu: processes.reduce((sum, p) => sum + p.avg_cpu, 0) / processes.length,
          avgMem: processes.reduce((sum, p) => sum + p.avg_mem, 0) / processes.length,
          peakCpu: Math.max(...processes.map(p => p.max_cpu)),
          peakMem: Math.max(...processes.map(p => p.max_mem)),
        };
      }
    });

    return trends;
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

  // Utility method to get optimal interval based on date range
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