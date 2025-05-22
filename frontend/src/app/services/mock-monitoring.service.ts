// src/app/services/mock-monitoring.service.ts
import { Injectable } from '@angular/core';
import { Observable, interval, BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';

export interface VmstatData {
  id: number;
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

export interface NetstatData {
  id: number;
  timestamp: string;
  interface: string;
  ipkts: number;
  ierrs: number;
  opkts: number;
  oerrs: number;
  time: number;
}

export interface IostatData {
  id: number;
  timestamp: string;
  disk: string;
  tps: number;
  kb_read: number;
  kb_wrtn: number;
  service_time: number;
}

export interface ProcessData {
  id: number;
  timestamp: string;
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

export interface MetricsResponse {
  vmstat?: VmstatData[];
  netstat?: NetstatData[];
  iostat?: IostatData[];
  process?: ProcessData[];
}

@Injectable({
  providedIn: 'root'
})
export class MockMonitoringService {
  
  private vmstatCounter = 99434;
  private netstatCounter = 275281;
  private iostatCounter = 407549;
  private processCounter = 1193642;

  // BehaviorSubjects for real-time data streaming
  private realtimeDataSubject = new BehaviorSubject<MetricsResponse>({});
  
  // Base network packet counters for realistic increments
  private baseInPackets = 484123605;
  private baseOutPackets = 726573119;

  // Process names for variety
  private processCommands = [
    'sudo vi /etc/g',
    'python manage.py',
    'nginx: worker',
    'postgres: writer',
    'java -jar app.jar',
    'node server.js',
    'docker-compose',
    'systemd --user',
    '/usr/bin/ssh',
    'mysqld --default'
  ];

  private users = ['root', 'ubuntu', 'postgres', 'nginx', 'app', 'system'];
  private diskNames = ['hdisk1', 'hdisk2', 'hdisk3', 'sda1', 'sdb1', 'cd0'];
  private interfaces = ['en0', 'eth0', 'wlan0', 'lo0'];

  constructor() {
    // Start generating real-time data every 5 seconds
    this.startRealtimeDataGeneration();
  }

  /**
   * Get real-time metrics stream
   */
  getRealtimeMetrics(): Observable<MetricsResponse> {
    return this.realtimeDataSubject.asObservable();
  }

  /**
   * Simulate API call for real-time data by metric type
   */
  getRealtimeMetricsByType(metric: string): Observable<any[]> {
    return this.realtimeDataSubject.pipe(
      map(data => {
        switch (metric) {
          case 'vmstat':
            return data.vmstat || [];
          case 'netstat':
            return data.netstat || [];
          case 'iostat':
            return data.iostat || [];
          case 'process':
            return data.process || [];
          default:
            return [];
        }
      })
    );
  }

  /**
   * Simulate historical data API call
   */
  getHistoricalMetrics(metric: string, startDate: string, endDate: string): Observable<any[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffHours = Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const dataPoints = Math.min(Math.floor(diffHours * 12), 1000); // 12 points per hour, max 1000

    const historicalData = [];
    for (let i = 0; i < dataPoints; i++) {
      const timestamp = new Date(start.getTime() + (i * (end.getTime() - start.getTime()) / dataPoints));
      
      switch (metric) {
        case 'vmstat':
          historicalData.push(this.generateVmstatData(timestamp));
          break;
        case 'netstat':
          historicalData.push(this.generateNetstatData(timestamp));
          break;
        case 'iostat':
          // Generate multiple disk entries
          this.diskNames.forEach(disk => {
            historicalData.push(this.generateIostatData(timestamp, disk));
          });
          break;
        case 'process':
          // Generate multiple process entries
          for (let j = 0; j < 5; j++) {
            historicalData.push(this.generateProcessData(timestamp));
          }
          break;
      }
    }

    return new Observable(observer => {
      // Simulate network delay
      setTimeout(() => {
        observer.next(historicalData);
        observer.complete();
      }, Math.random() * 1000 + 500);
    });
  }

  /**
   * Start generating real-time data
   */
  private startRealtimeDataGeneration(): void {
    interval(5000).subscribe(() => {
      const now = new Date();
      const metrics: MetricsResponse = {
        vmstat: [this.generateVmstatData(now)],
        netstat: [this.generateNetstatData(now)],
        iostat: this.generateMultipleIostatData(now),
        process: this.generateMultipleProcessData(now)
      };
      
      this.realtimeDataSubject.next(metrics);
    });

    // Generate initial data
    const now = new Date();
    const initialMetrics: MetricsResponse = {
      vmstat: [this.generateVmstatData(now)],
      netstat: [this.generateNetstatData(now)],
      iostat: this.generateMultipleIostatData(now),
      process: this.generateMultipleProcessData(now)
    };
    this.realtimeDataSubject.next(initialMetrics);
  }

  /**
   * Generate realistic vmstat data
   */
  private generateVmstatData(timestamp: Date): VmstatData {
    // Simulate daily patterns - higher CPU usage during work hours
    const hour = timestamp.getHours();
    const workHourMultiplier = (hour >= 9 && hour <= 17) ? 1.5 : 0.8;
    
    return {
      id: ++this.vmstatCounter,
      timestamp: timestamp.toISOString(),
      r: Math.floor(Math.random() * 8) + 1,
      b: Math.floor(Math.random() * 3),
      avm: Math.floor(800000 + Math.random() * 200000), // Active virtual memory
      fre: Math.floor(1200000 + Math.random() * 300000), // Free memory
      pi: Math.floor(Math.random() * 10),
      po: Math.floor(Math.random() * 10),
      fr: Math.floor(Math.random() * 5),
      interface_in: Math.floor(40 + Math.random() * 30),
      cs: Math.floor(60000 + Math.random() * 20000), // Context switches
      us: Math.floor((15 + Math.random() * 25) * workHourMultiplier), // User CPU
      sy: Math.floor((5 + Math.random() * 15) * workHourMultiplier), // System CPU
      idle: Math.floor(60 + Math.random() * 30)
    };
  }

  /**
   * Generate realistic netstat data
   */
  private generateNetstatData(timestamp: Date): NetstatData {
    // Increment packet counters realistically
    this.baseInPackets += Math.floor(Math.random() * 1000) + 100;
    this.baseOutPackets += Math.floor(Math.random() * 1500) + 150;

    return {
      id: ++this.netstatCounter,
      timestamp: timestamp.toISOString(),
      interface: this.interfaces[Math.floor(Math.random() * this.interfaces.length)],
      ipkts: this.baseInPackets,
      ierrs: Math.floor(Math.random() * 5), // Input errors (usually low)
      opkts: this.baseOutPackets,
      oerrs: Math.floor(Math.random() * 3), // Output errors (usually low)
      time: 0
    };
  }

  /**
   * Generate realistic iostat data for a specific disk
   */
  private generateIostatData(timestamp: Date, disk?: string): IostatData {
    const selectedDisk = disk || this.diskNames[Math.floor(Math.random() * this.diskNames.length)];
    
    // Different disks have different patterns
    const isSystemDisk = selectedDisk.includes('hdisk1') || selectedDisk.includes('sda1');
    const activityMultiplier = isSystemDisk ? 1.5 : 0.7;

    return {
      id: ++this.iostatCounter,
      timestamp: timestamp.toISOString(),
      disk: selectedDisk,
      tps: Math.random() * 100 * activityMultiplier, // Transactions per second
      kb_read: Math.random() * 1000 * activityMultiplier,
      kb_wrtn: Math.random() * 500 * activityMultiplier,
      service_time: Math.random() * 15 // Service time in ms
    };
  }

  /**
   * Generate multiple iostat entries (different disks)
   */
  private generateMultipleIostatData(timestamp: Date): IostatData[] {
    return this.diskNames.slice(0, 3).map(disk => this.generateIostatData(timestamp, disk));
  }

  /**
   * Generate realistic process data
   */
  private generateProcessData(timestamp: Date): ProcessData {
    const pid = Math.floor(Math.random() * 30000) + 1000;
    const command = this.processCommands[Math.floor(Math.random() * this.processCommands.length)];
    const user = this.users[Math.floor(Math.random() * this.users.length)];

    // Generate realistic CPU and memory usage
    const cpuUsage = Math.random() * 15; // Most processes use little CPU
    const memUsage = Math.random() * 5;  // Most processes use little memory

    return {
      id: ++this.processCounter,
      timestamp: timestamp.toISOString(),
      pid: pid,
      user: user,
      cpu: Math.round(cpuUsage * 10) / 10,
      mem: Math.round(memUsage * 10) / 10,
      command: `${pid}:${Math.floor(Math.random() * 99)} ${command}`
    };
  }

  /**
   * Generate multiple process entries
   */
  private generateMultipleProcessData(timestamp: Date): ProcessData[] {
    const processCount = Math.floor(Math.random() * 8) + 5; // 5-12 processes
    return Array.from({ length: processCount }, () => this.generateProcessData(timestamp));
  }

  /**
   * Generate system summary for widgets
   */
  getSystemSummary(): Observable<any> {
    return this.realtimeDataSubject.pipe(
      map(data => {
        const vmstat = data.vmstat?.[0];
        const netstat = data.netstat?.[0];
        const iostat = data.iostat || [];
        const processes = data.process || [];

        return {
          cpu: {
            usage: vmstat ? Math.round(vmstat.us + vmstat.sy) : 0,
            user: vmstat?.us || 0,
            system: vmstat?.sy || 0,
            idle: vmstat?.idle || 0
          },
          memory: {
            total: vmstat ? vmstat.avm + vmstat.fre : 2000000,
            used: vmstat?.avm || 800000,
            free: vmstat?.fre || 1200000,
            usage_percent: vmstat ? Math.round((vmstat.avm / (vmstat.avm + vmstat.fre)) * 100) : 0
          },
          disk: {
            total_read: iostat.reduce((sum, disk) => sum + disk.kb_read, 0),
            total_write: iostat.reduce((sum, disk) => sum + disk.kb_wrtn, 0),
            status: iostat.some(disk => disk.tps > 50) ? 'High Load' : 'Normal'
          },
          network: {
            total_packets: netstat ? netstat.ipkts + netstat.opkts : 0,
            total_errors: netstat ? netstat.ierrs + netstat.oerrs : 0,
            status: netstat && (netstat.ierrs + netstat.oerrs) > 10 ? 'Errors Detected' : 'Active'
          },
          processes: {
            total: processes.length,
            high_cpu: processes.filter(p => p.cpu > 5).length,
            high_memory: processes.filter(p => p.mem > 2).length
          }
        };
      })
    );
  }

// Add inside the MockMonitoringService class (before the last closing brace)

  /**
   * Generate mock prediction data
   */
  generatePredictions(days: number): { predictions: any[], confidenceBand: any[] } {
    const predictions = [];
    const confidenceBand = [];
    const baseDate = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      const value = 50 + Math.random() * 30 + Math.sin(i) * 10;
      
      predictions.push([date.toISOString(), value]);
      confidenceBand.push([
        date.toISOString(),
        value - 5 - Math.random() * 5,
        value + 5 + Math.random() * 5
      ]);
    }

    return { predictions, confidenceBand };
  }

  /**
   * Generate mock anomaly data
   */
  getAnomalies(): any[] {
    const anomalies = [];
    const baseDate = new Date();
    
    for (let i = 0; i < 30; i++) {
      if (Math.random() > 0.8) {
        const date = new Date(baseDate);
        date.setDate(date.getDate() - i);
        anomalies.push({
          timestamp: date.toISOString(),
          value: 80 + Math.random() * 20,
          metricValue: 50 + Math.random() * 20,
          type: ['CPU Spike', 'Memory Leak', 'Disk Overload'][Math.floor(Math.random() * 3)]
        });
      }
    }
    
    return anomalies;
  }

}