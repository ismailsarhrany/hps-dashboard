import { Injectable } from '@angular/core';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { catchError, map } from 'rxjs/operators';

export interface MetricData {
  timestamp: Date;
  value: number;
  name: string;
}

export interface ProcessData {
  id: number;
  name: string;
  status: string;
  usage: {
    cpu: number;
    memory: number;
  };
  startTime: Date;
}

// Interface for vmstat metrics from API
export interface VmstatMetric {
  timestamp: string;
  r: number;
  b: number;
  avm: number;
  fre: number;
  pi: number;
  po: number;
  fr: number;
  interface_in: number;
  cs: number;
  us: number;
  sy: number;
  idle: number;
}

// Interface for process metrics from API
export interface ApiProcessMetric {
  timestamp: string;
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

@Injectable({
  providedIn: 'root'
})
export class MonitoringService {
  private metricsSubject = new BehaviorSubject<MetricData[]>([]);
  private processesSubject = new BehaviorSubject<ProcessData[]>([]);
  private apiUrl = '/api/metrics';
  
  constructor(private http: HttpClient) {
    // Initialize with data
    this.refreshData();
  }

  getMetricsData(): Observable<MetricData[]> {
    return this.metricsSubject.asObservable();
  }

  getProcessData(): Observable<ProcessData[]> {
    return this.processesSubject.asObservable();
  }

  refreshData() {
    this.fetchRealtimeMetrics();
    this.fetchProcessData();
  }

  private fetchRealtimeMetrics() {
    this.http.get<VmstatMetric[]>(`${this.apiUrl}/realtime/?metric=vmstat`)
      .pipe(
        map(data => this.transformVmstatToMetrics(data)),
        catchError(error => {
          console.error('Error fetching metrics data:', error);
          return this.getMockMetricsData();
        })
      )
      .subscribe(transformedData => {
        this.metricsSubject.next(transformedData);
      });
  }

  private fetchProcessData() {
    this.http.get<ApiProcessMetric[]>(`${this.apiUrl}/realtime/?metric=process`)
      .pipe(
        map(data => this.transformApiProcessesToProcessData(data)),
        catchError(error => {
          console.error('Error fetching process data:', error);
          return this.getMockProcessData();
        })
      )
      .subscribe(transformedData => {
        this.processesSubject.next(transformedData);
      });
  }

  private transformVmstatToMetrics(vmstatData: VmstatMetric[]): MetricData[] {
    const result: MetricData[] = [];
    
    vmstatData.forEach(item => {
      // CPU Usage metric (100 - idle%)
      result.push({
        timestamp: new Date(item.timestamp),
        value: 100 - item.idle,
        name: 'CPU Usage'
      });
      
      // Memory Usage (using avm as approximate memory usage)
      result.push({
        timestamp: new Date(item.timestamp),
        value: item.avm / 1024, // Convert to GB if necessary
        name: 'Memory Usage (GB)'
      });
    });
    
    return result;
  }

  private transformApiProcessesToProcessData(apiProcesses: ApiProcessMetric[]): ProcessData[] {
    return apiProcesses.map(proc => ({
      id: proc.pid,
      name: proc.command,
      status: 'running', // Assuming all returned processes are running
      usage: {
        cpu: proc.cpu,
        memory: proc.mem
      },
      startTime: new Date(proc.timestamp)
    }));
  }

  // Fallback mock data generators
  private getMockMetricsData(): Observable<MetricData[]> {
    const metrics: MetricData[] = [];
    const now = new Date();
    
    // CPU metrics
    for (let i = 0; i < 24; i++) {
      metrics.push({
        timestamp: new Date(now.getTime() - (24 - i) * 3600000),
        value: Math.random() * 100,
        name: 'CPU Usage'
      });
    }
    
    // Memory metrics
    for (let i = 0; i < 24; i++) {
      metrics.push({
        timestamp: new Date(now.getTime() - (24 - i) * 3600000),
        value: Math.random() * 16,
        name: 'Memory Usage (GB)'
      });
    }
    
    return of(metrics);
  }

  private getMockProcessData(): Observable<ProcessData[]> {
    const now = new Date();
    const processes: ProcessData[] = [
      {
        id: 1,
        name: 'nginx',
        status: 'running',
        usage: { cpu: 2.5, memory: 1.2 },
        startTime: new Date(now.getTime() - 86400000)
      },
      {
        id: 2,
        name: 'mongodb',
        status: 'running',
        usage: { cpu: 5.2, memory: 3.7 },
        startTime: new Date(now.getTime() - 72000000)
      },
      {
        id: 3,
        name: 'node',
        status: 'running',
        usage: { cpu: 8.1, memory: 2.5 },
        startTime: new Date(now.getTime() - 43200000)
      },
      {
        id: 4,
        name: 'postgres',
        status: 'stopped',
        usage: { cpu: 0, memory: 0 },
        startTime: new Date(now.getTime() - 129600000)
      }
    ];
    
    return of(processes);
  }

  // Method for fetching historical data with date range
  getHistoricalData(startDate: Date, endDate: Date): Observable<MetricData[]> {
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    
    return this.http.get<VmstatMetric[]>(`${this.apiUrl}/historical/?metric=vmstat&start=${start}&end=${end}`)
      .pipe(
        map(data => this.transformVmstatToMetrics(data)),
        catchError(error => {
          console.error('Error fetching historical data:', error);
          return this.getMockMetricsData();
        })
      );
  }
}