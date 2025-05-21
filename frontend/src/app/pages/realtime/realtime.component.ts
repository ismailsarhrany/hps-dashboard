import { Component, OnDestroy } from '@angular/core';
import { MockMonitoringService } from '../../services/mock-monitoring.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'ngx-realtime',
  templateUrl: './realtime.component.html',
  styleUrls: ['./realtime.component.scss']
})
export class RealtimeComponent implements OnDestroy {
  private subscription: Subscription;
  chartData: any = {};

  lineChartOptions = {
    responsive: true,
    animation: { duration: 0 },
    scales: {
      x: { display: false },
      y: { beginAtZero: true }
    }
  };

  constructor(private mockService: MockMonitoringService) {
    this.subscription = this.mockService.getRealtimeData().subscribe(data => {
      this.updateCharts(data);
    });
  }

  private updateCharts(data: any) {
    // CPU Usage
    this.chartData.cpu = {
      labels: [data.vmstat.timestamp.toLocaleTimeString()],
      datasets: [{
        label: 'CPU Usage',
        data: [data.vmstat.us + data.vmstat.sy],
        borderColor: '#4f46e5',
        fill: false
      }]
    };

    // Memory Usage
    this.chartData.memory = {
      labels: [data.vmstat.timestamp.toLocaleTimeString()],
      datasets: [{
        label: 'Memory Used',
        data: [(data.vmstat.avm / (data.vmstat.avm + data.vmstat.fre)) * 100],
        borderColor: '#10b981',
        fill: false
      }]
    };

    // Network Traffic
    this.chartData.network = {
      labels: [data.netstat.timestamp.toLocaleTimeString()],
      datasets: [
        {
          label: 'Incoming',
          data: [data.netstat.ipkts],
          borderColor: '#3b82f6'
        },
        {
          label: 'Outgoing',
          data: [data.netstat.opkts],
          borderColor: '#ef4444'
        }
      ]
    };
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }
}