// src/app/pages/historic/historic.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { NbThemeService } from '@nebular/theme';
import { MockMonitoringService } from '../../services/mock-monitoring.service';
import { FormControl, FormGroup } from '@angular/forms';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'ngx-historic',
  templateUrl: './historic.component.html',
  styleUrls: ['./historic.component.scss']
})
export class HistoricComponent implements OnInit {
  dateRange = new FormGroup({
    start: new FormControl<Date | null>(null),
    end: new FormControl<Date | null>(null),
  });

  // Chart options (similar to realtime but with historical data)
  cpuChartOption: any = {};
  memoryChartOption: any = {};
  diskReadChartOption: any = {};
  diskWriteChartOption: any = {};
  networkPacketsChartOption: any = {};
  networkErrorsChartOption: any = {};

  private colors: any;
  private echartTheme: any;

  constructor(
    private theme: NbThemeService,
    private monitoringService: MockMonitoringService,
    private datePipe: DatePipe
  ) {}

  ngOnInit() {
    this.theme.getJsTheme().subscribe(config => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
    });
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === 'dark' ? '#222b45' : '#ffffff',
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'time', boundaryGap: false },
      yAxis: { type: 'value' }
    };

    // Initialize all charts with empty data
    this.cpuChartOption = { ...baseOption, title: { text: 'CPU Usage History' } };
    this.memoryChartOption = { ...baseOption, title: { text: 'Memory Usage History' } };
    this.diskReadChartOption = { ...baseOption, title: { text: 'Disk Read History' } };
    this.diskWriteChartOption = { ...baseOption, title: { text: 'Disk Write History' } };
    this.networkPacketsChartOption = { ...baseOption, title: { text: 'Network Packets History' } };
    this.networkErrorsChartOption = { ...baseOption, title: { text: 'Network Errors History' } };
  }

  loadHistoricalData() {
    if (!this.dateRange.valid) return;

    const start = this.datePipe.transform(this.dateRange.value.start, 'yyyy-MM-dd');
    const end = this.datePipe.transform(this.dateRange.value.end, 'yyyy-MM-dd');

    // Load data for each metric
    this.loadMetricData('vmstat', start, end);
    this.loadMetricData('iostat', start, end);
    this.loadMetricData('netstat', start, end);
  }

  private loadMetricData(metric: string, start: string, end: string) {
    this.monitoringService.getHistoricalMetrics(metric, start, end).subscribe(data => {
      switch(metric) {
        case 'vmstat':
          this.updateCpuMemoryCharts(data);
          break;
        case 'iostat':
          this.updateDiskCharts(data);
          break;
        case 'netstat':
          this.updateNetworkCharts(data);
          break;
      }
    });
  }

  private updateCpuMemoryCharts(data: any[]) {
    this.cpuChartOption = {
      ...this.cpuChartOption,
      series: [{
        name: 'CPU Usage',
        type: 'line',
        data: data.map(d => [d.timestamp, d.us + d.sy])
      }]
    };

    this.memoryChartOption = {
      ...this.memoryChartOption,
      series: [{
        name: 'Memory Usage',
        type: 'line',
        data: data.map(d => [d.timestamp, (d.avm / (d.avm + d.fre)) * 100])
      }]
    };
  }

  private updateDiskCharts(data: any[]) {
    const diskReadData = this.aggregateDiskData(data, 'kb_read');
    const diskWriteData = this.aggregateDiskData(data, 'kb_wrtn');

    this.diskReadChartOption = {
      ...this.diskReadChartOption,
      series: [{
        name: 'Disk Read',
        type: 'line',
        data: diskReadData
      }]
    };

    this.diskWriteChartOption = {
      ...this.diskWriteChartOption,
      series: [{
        name: 'Disk Write',
        type: 'line',
        data: diskWriteData
      }]
    };
  }

  private updateNetworkCharts(data: any[]) {
    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      series: [{
        name: 'Packets',
        type: 'line',
        data: data.map(d => [d.timestamp, d.ipkts + d.opkts])
      }]
    };

    this.networkErrorsChartOption = {
      ...this.networkErrorsChartOption,
      series: [{
        name: 'Errors',
        type: 'line',
        data: data.map(d => [d.timestamp, d.ierrs + d.oerrs])
      }]
    };
  }

  private aggregateDiskData(data: any[], field: string): any[] {
    const aggregated = {};
    data.forEach(item => {
      const timestamp = item.timestamp;
      aggregated[timestamp] = (aggregated[timestamp] || 0) + item[field];
    });
    return Object.entries(aggregated).map(([ts, val]) => [ts, val]);
  }
}