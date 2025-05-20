import { Component, OnInit, OnDestroy } from '@angular/core';
import { MonitoringService, MetricData } from '../../services/monitoring.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'ngx-realtime',
  templateUrl: './realtime.component.html',
  styleUrls: ['./realtime.component.scss']
})
export class RealtimeComponent implements OnInit, OnDestroy {
  metrics: MetricData[] = [];
  cpuData: MetricData[] = [];
  memoryData: MetricData[] = [];
  private dataSubscription: Subscription | null = null;

  get cpuChartData() {
    return [{
      name: 'CPU Usage',
      series: this.cpuData.map(d => ({ name: d.timestamp, value: d.value }))
    }];
  }

  get memoryChartData() {
    return [{
      name: 'Memory Usage',
      series: this.memoryData.map(d => ({ name: d.timestamp, value: d.value }))
    }];
  }

  constructor(private monitoringService: MonitoringService) { }

  ngOnInit(): void {
    this.dataSubscription = this.monitoringService.getMetricsData()
      .subscribe(data => {
        this.metrics = data;
        this.cpuData = data.filter(metric => metric.name === 'CPU Usage');
        this.memoryData = data.filter(metric => metric.name === 'Memory Usage (GB)');
      });
  }

  ngOnDestroy(): void {
    this.dataSubscription?.unsubscribe();
  }
}