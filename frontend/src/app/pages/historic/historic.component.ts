import { Component, OnInit, OnDestroy } from '@angular/core';
import { MonitoringService, MetricData, ProcessData } from '../../services/monitoring.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'ngx-historic',
  templateUrl: './historic.component.html',
  styleUrls: ['./historic.component.scss']
})
export class HistoricComponent implements OnInit, OnDestroy {
  historicalMetrics: MetricData[] = [];
  processes: ProcessData[] = [];
  private metricsSubscription: Subscription | null = null;
  private processesSubscription: Subscription | null = null;

  constructor(private monitoringService: MonitoringService) { }

  get chartData() {
    return [
      {
        name: 'CPU Usage',
        series: this.historicalMetrics
          .filter(m => m.name === 'CPU Usage')
          .map(d => ({ name: d.timestamp, value: d.value }))
      },
      {
        name: 'Memory Usage',
        series: this.historicalMetrics
          .filter(m => m.name === 'Memory Usage (GB)')
          .map(d => ({ name: d.timestamp, value: d.value }))
      }
    ];
  }

  ngOnInit(): void {
    this.metricsSubscription = this.monitoringService.getMetricsData()
      .subscribe(data => {
        this.historicalMetrics = data;
      });
      
    this.processesSubscription = this.monitoringService.getProcessData()
      .subscribe(data => {
        this.processes = data;
      });
  }

  ngOnDestroy(): void {
    this.metricsSubscription?.unsubscribe();
    this.processesSubscription?.unsubscribe();
  }
}