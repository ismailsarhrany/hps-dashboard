// src/app/pages/historic/historic.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, FormBuilder } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { MockMonitoringService, VmstatData, NetstatData, IostatData } from '../../services/mock-monitoring.service';

@Component({
  selector: 'ngx-historic',
  templateUrl: './historic.component.html',
  styleUrls: ['./historic.component.scss']
})
export class HistoricComponent implements OnInit, OnDestroy {
  private themeSubscription: Subscription;
  private dataSubscriptions: Subscription[] = [];
  private colors: any;
  private echartTheme: any;

  // Chart options
  cpuChartOption: any = {};
  memoryChartOption: any = {};
  diskReadChartOption: any = {};
  diskWriteChartOption: any = {};
  networkPacketsChartOption: any = {};
  networkErrorsChartOption: any = {};

  // Date form
  dateRangeForm: FormGroup;
  loading = false;

  constructor(
    private theme: NbThemeService,
    private monitoringService: MockMonitoringService,
    private fb: FormBuilder
  ) {
    this.dateRangeForm = this.fb.group({
      startDate: [''],
      endDate: ['']
    });
  }

  ngOnInit() {
    this.themeSubscription = this.theme.getJsTheme().subscribe(config => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
    });
  }

  ngOnDestroy() {
    this.themeSubscription.unsubscribe();
    this.dataSubscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === 'dark' ? '#222b45' : '#ffffff',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'time',
        axisLine: {
          lineStyle: {
            color: this.echartTheme === 'dark' ? '#484b58' : '#e0e0e0'
          }
        },
        axisLabel: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      yAxis: {
        type: 'value',
        axisLine: {
          lineStyle: {
            color: this.echartTheme === 'dark' ? '#484b58' : '#e0e0e0'
          }
        },
        axisLabel: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      }
    };

    // CPU Chart
    this.cpuChartOption = {
      ...baseOption,
      title: { text: 'CPU Usage History (%)' },
      series: [{
        name: 'User CPU',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#3366ff' }
      }, {
        name: 'System CPU',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#ff3d71' }
      }]
    };

    // Memory Chart
    this.memoryChartOption = {
      ...baseOption,
      title: { text: 'Memory Usage History (GB)' },
      series: [{
        name: 'Used Memory',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#00d68f' }
      }, {
        name: 'Free Memory',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#0095ff' }
      }]
    };

    // Disk Charts
    this.diskReadChartOption = {
      ...baseOption,
      title: { text: 'Disk Read History (KB/s)' },
      series: [{
        name: 'Read Rate',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#ff9f43' }
      }]
    };

    this.diskWriteChartOption = {
      ...baseOption,
      title: { text: 'Disk Write History (KB/s)' },
      series: [{
        name: 'Write Rate',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#ee5a52' }
      }]
    };

    // Network Charts
    this.networkPacketsChartOption = {
      ...baseOption,
      title: { text: 'Network Packets History' },
      series: [{
        name: 'Input Packets',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#8061ef' }
      }, {
        name: 'Output Packets',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#42aaff' }
      }]
    };

    this.networkErrorsChartOption = {
      ...baseOption,
      title: { text: 'Network Errors History' },
      series: [{
        name: 'Input Errors',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#ff3d71' }
      }, {
        name: 'Output Errors',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#ff6b6b' }
      }]
    };
  }

  loadHistoricalData() {
    if (!this.dateRangeForm.valid) return;
    this.loading = true;

    const { startDate, endDate } = this.dateRangeForm.value;
    this.dataSubscriptions.forEach(sub => sub.unsubscribe());
    this.dataSubscriptions = [];

    // Load CPU data
    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalMetrics('vmstat', startDate, endDate)
        .subscribe((data: VmstatData[]) => {
          this.cpuChartOption = {
            ...this.cpuChartOption,
            series: [{
              ...this.cpuChartOption.series[0],
              data: data.map(d => [d.timestamp, d.us])
            }, {
              ...this.cpuChartOption.series[1],
              data: data.map(d => [d.timestamp, d.sy])
            }]
          };
        })
    );

    // Load Memory data
    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalMetrics('vmstat', startDate, endDate)
        .subscribe((data: VmstatData[]) => {
          this.memoryChartOption = {
            ...this.memoryChartOption,
            series: [{
              ...this.memoryChartOption.series[0],
              data: data.map(d => [d.timestamp, Math.round(d.avm / 1024 / 1024 * 100) / 100])
            }, {
              ...this.memoryChartOption.series[1],
              data: data.map(d => [d.timestamp, Math.round(d.fre / 1024 / 1024 * 100) / 100])
            }]
          };
        })
    );

    // Load Disk data
    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalMetrics('iostat', startDate, endDate)
        .subscribe((data: IostatData[]) => {
          const diskRead = this.aggregateDiskData(data, 'kb_read');
          const diskWrite = this.aggregateDiskData(data, 'kb_wrtn');

          this.diskReadChartOption = {
            ...this.diskReadChartOption,
            series: [{
              ...this.diskReadChartOption.series[0],
              data: Object.entries(diskRead).map(([ts, val]) => [ts, val])
            }]
          };

          this.diskWriteChartOption = {
            ...this.diskWriteChartOption,
            series: [{
              ...this.diskWriteChartOption.series[0],
              data: Object.entries(diskWrite).map(([ts, val]) => [ts, val])
            }]
          };
        })
    );

    // Load Network data
    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalMetrics('netstat', startDate, endDate)
        .subscribe((data: NetstatData[]) => {
          this.networkPacketsChartOption = {
            ...this.networkPacketsChartOption,
            series: [{
              ...this.networkPacketsChartOption.series[0],
              data: data.map(d => [d.timestamp, d.ipkts])
            }, {
              ...this.networkPacketsChartOption.series[1],
              data: data.map(d => [d.timestamp, d.opkts])
            }]
          };

          this.networkErrorsChartOption = {
            ...this.networkErrorsChartOption,
            series: [{
              ...this.networkErrorsChartOption.series[0],
              data: data.map(d => [d.timestamp, d.ierrs])
            }, {
              ...this.networkErrorsChartOption.series[1],
              data: data.map(d => [d.timestamp, d.oerrs])
            }]
          };
        })
    );

    this.loading = false;
  }

  private aggregateDiskData(diskData: IostatData[], field: keyof IostatData): { [timestamp: string]: number } {
    const aggregated: { [timestamp: string]: number } = {};
    diskData.forEach(item => {
      const ts = item.timestamp;
      aggregated[ts] = (aggregated[ts] || 0) + Number(item[field]);
    });
    return aggregated;
  }
}
