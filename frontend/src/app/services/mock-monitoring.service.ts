import { Injectable } from '@angular/core';
import { Observable, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';

interface MetricData {
  timestamp: Date;
  [key: string]: any;
}

interface Netstat extends MetricData {
  ipkts: number;
  opkts: number;
  ierrs: number;
  oerrs: number;
}

interface Vmstat extends MetricData {
  us: number;
  sy: number;
  idle: number;
  avm: number;
  fre: number;
}

@Injectable({ providedIn: 'root' })
export class MockMonitoringService {
  generateFakeNetstat(): Netstat {
    return {
      timestamp: new Date(),
      ipkts: Math.floor(Math.random() * 1000),
      opkts: Math.floor(Math.random() * 1000),
      ierrs: Math.floor(Math.random() * 5),
      oerrs: Math.floor(Math.random() * 5)
    };
  }

  generateFakeVmstat(): Vmstat {
    return {
      timestamp: new Date(),
      us: Math.random() * 40,
      sy: Math.random() * 30,
      idle: Math.random() * 100,
      avm: Math.random() * 1000000,
      fre: Math.random() * 1000000
    };
  }

  getRealtimeData() {
    return timer(0, 2000).pipe(
      map(() => ({
        netstat: this.generateFakeNetstat(),
        vmstat: this.generateFakeVmstat()
      }))
    );
  }
}