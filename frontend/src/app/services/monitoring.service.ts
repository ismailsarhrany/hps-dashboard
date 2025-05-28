// src/app/services/monitoring.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, interval, BehaviorSubject } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = 'http://localhost:8000/api/metrics';
  private realtimeSubject = new BehaviorSubject<any>(null);
  private isMonitoring = false;

  constructor(private http: HttpClient) {}

  // Realtime Data Methods
  startRealtimeMonitoring(): Observable<any> {
    if (!this.isMonitoring) {
      this.isMonitoring = true;
      interval(5000).subscribe(() => {
        this.fetchRealtimeData().subscribe(data => {
          this.realtimeSubject.next(data);
        });
      });
      // Initial fetch
      this.fetchRealtimeData().subscribe(data => {
        this.realtimeSubject.next(data);
      });
    }
    return this.realtimeSubject.asObservable();
  }

  stopRealtimeMonitoring(): void {
    this.isMonitoring = false;
  }

  private fetchRealtimeData(): Observable<ApiResponse<VmstatData>> {
    const params = new HttpParams().set('metric', 'vmstat');
    return this.http.get<ApiResponse<VmstatData>>(`${this.baseUrl}/realtime/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching realtime data:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  getRealtimeVmstat(): Observable<ApiResponse<VmstatData>> {
    return this.fetchRealtimeData();
  }

  getRealtimeNetstat(): Observable<ApiResponse<NetstatData>> {
    const params = new HttpParams().set('metric', 'netstat');
    return this.http.get<ApiResponse<NetstatData>>(`${this.baseUrl}/realtime/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching realtime netstat:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  getRealtimeIostat(): Observable<ApiResponse<IostatData>> {
    const params = new HttpParams().set('metric', 'iostat');
    return this.http.get<ApiResponse<IostatData>>(`${this.baseUrl}/realtime/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching realtime iostat:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  getRealtimeProcess(): Observable<ApiResponse<ProcessData>> {
    const params = new HttpParams().set('metric', 'process');
    return this.http.get<ApiResponse<ProcessData>>(`${this.baseUrl}/realtime/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching realtime process:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  // Historical Data Methods
  getHistoricalVmstat(dateRange: DateTimeRange): Observable<ApiResponse<VmstatData>> {
    const params = new HttpParams()
      .set('metric', 'vmstat')
      .set('start', dateRange.start)
      .set('end', dateRange.end);
    
    return this.http.get<ApiResponse<VmstatData>>(`${this.baseUrl}/historical/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching historical vmstat:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  getHistoricalNetstat(dateRange: DateTimeRange): Observable<ApiResponse<NetstatData>> {
    const params = new HttpParams()
      .set('metric', 'netstat')
      .set('start', dateRange.start)
      .set('end', dateRange.end);
    
    return this.http.get<ApiResponse<NetstatData>>(`${this.baseUrl}/historical/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching historical netstat:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  getHistoricalIostat(dateRange: DateTimeRange): Observable<ApiResponse<IostatData>> {
    const params = new HttpParams()
      .set('metric', 'iostat')
      .set('start', dateRange.start)
      .set('end', dateRange.end);
    
    return this.http.get<ApiResponse<IostatData>>(`${this.baseUrl}/historical/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching historical iostat:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  getHistoricalProcesses(dateRange: DateTimeRange, pid?: number): Observable<ApiResponse<ProcessData>> {
    let params = new HttpParams()
      .set('metric', 'process')
      .set('start', dateRange.start)
      .set('end', dateRange.end);
    
    if (pid) {
      params = params.set('pid', pid.toString());
    }
    
    return this.http.get<ApiResponse<ProcessData>>(`${this.baseUrl}/historical/`, { params })
      .pipe(
        catchError(error => {
          console.error('Error fetching historical process:', error);
          return of({ status: 'error', data: [], timestamp: new Date().toISOString() });
        })
      );
  }

  // Utility Methods
  getProcessList(): Observable<ProcessData[]> {
    return this.getRealtimeProcess().pipe(
      map(response => response.data || []),
      map(process => process.filter(p => p.cpu > 0 || p.mem > 0))
    );
  }

  calculateSystemSummary(vmstatData: VmstatData[], netstatData: NetstatData[], iostatData: IostatData[]): SystemSummary {
    if (!vmstatData.length) {
      return {
        cpu_usage: 0,
        memory_usage: 0,
        disk_read: 0,
        disk_write: 0,
        network_packets: 0,
        network_errors: 0,
        system_load: 0,
        process_count: 0,
        uptime: 0
      };
    }

    const latestVmstat = vmstatData[vmstatData.length - 1];
    const cpuUsage = 100 - latestVmstat.idle;
    const totalMemory = latestVmstat.avm + latestVmstat.fre;
    const memoryUsage = totalMemory > 0 ? (latestVmstat.avm / totalMemory) * 100 : 0;

    const totalDiskRead = iostatData.reduce((sum, data) => sum + data.kb_read, 0);
    const totalDiskWrite = iostatData.reduce((sum, data) => sum + data.kb_wrtn, 0);

    const totalNetworkPackets = netstatData.reduce((sum, data) => sum + data.ipkts + data.opkts, 0);
    const totalNetworkErrors = netstatData.reduce((sum, data) => sum + data.ierrs + data.oerrs, 0);
    return {
      cpu_usage: Math.round(cpuUsage * 100) / 100,
      memory_usage: Math.round(memoryUsage * 100) / 100,
      disk_read: totalDiskRead,
      disk_write: totalDiskWrite,
      network_packets: totalNetworkPackets,
      network_errors: totalNetworkErrors,
      system_load: latestVmstat.r,
      process_count: 0, // Will be updated by process data
      uptime: 0
    };
  }

  // Date/Time Utility Methods
  formatDateTimeForApi(date: Date, time: string = '00:00:00'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
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
      end: end.toISOString()
    };
  }
}