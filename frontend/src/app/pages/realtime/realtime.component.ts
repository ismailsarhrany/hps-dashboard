// src/app/pages/realtime/realtime.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { MockMonitoringService, VmstatData, NetstatData, IostatData, ProcessData } from '../../services/mock-monitoring.service';

@Component({
  selector: 'ngx-realtime',
  templateUrl: './realtime.component.html',
  styleUrls: ['./realtime.component.scss']
})
export class RealtimeComponent implements OnInit, OnDestroy {
  
  private dataSubscription: Subscription;
  private summarySubscription: Subscription;
  private colors: any;
  private echartTheme: any;

  // Chart data arrays
  cpuData: VmstatData[] = [];
  memoryData: VmstatData[] = [];
  diskReadData: IostatData[] = [];
  diskWriteData: IostatData[] = [];
  networkPacketsData: NetstatData[] = [];
  networkErrorsData: NetstatData[] = [];

  // Chart options
  cpuChartOption: any = {};
  memoryChartOption: any = {};
  diskReadChartOption: any = {};
  diskWriteChartOption: any = {};
  networkPacketsChartOption: any = {};
  networkErrorsChartOption: any = {};

  // Summary widgets data
  currentCpuUsage: number = 0;
  currentMemoryUsage: number = 0;
  diskStatus: string = 'Normal';
  networkStatus: string = 'Active';
  totalDiskRead: number = 0;
  totalDiskWrite: number = 0;
  totalNetworkPackets: number = 0;
  totalNetworkErrors: number = 0;

  // Additional metrics
  systemLoad: number = 0;
  processCount: number = 0;
  lastUpdateTime: Date = new Date();

  constructor(
    private theme: NbThemeService,
    private monitoringService: MockMonitoringService
  ) {}

  ngOnInit() {
    this.theme.getJsTheme().subscribe(config => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
      this.subscribeToRealtimeData();
      this.subscribeToSystemSummary();
    });
  }

  ngOnDestroy() {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
    if (this.summarySubscription) {
      this.summarySubscription.unsubscribe();
    }
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
      legend: {
        data: [],
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
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
        boundaryGap: false,
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
      title: {
        text: 'CPU Usage (%)',
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      yAxis: {
        ...baseOption.yAxis,
        max: 100
      },
      legend: {
        ...baseOption.legend,
        data: ['User CPU', 'System CPU']
      },
      series: [{
        name: 'User CPU',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#3366ff' },
        areaStyle: { opacity: 0.3 }
      }, {
        name: 'System CPU',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#ff3d71' },
        areaStyle: { opacity: 0.3 }
      }]
    };

    // Memory Chart
    this.memoryChartOption = {
      ...baseOption,
      title: {
        text: 'Memory Usage (GB)',
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      legend: {
        ...baseOption.legend,
        data: ['Used Memory', 'Free Memory']
      },
      series: [{
        name: 'Used Memory',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#00d68f' },
        areaStyle: { opacity: 0.3 }
      }, {
        name: 'Free Memory',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#0095ff' },
        areaStyle: { opacity: 0.3 }
      }]
    };

    // Disk Read Chart
    this.diskReadChartOption = {
      ...baseOption,
      title: {
        text: 'Disk Read Activity (KB/s)',
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      legend: {
        ...baseOption.legend,
        data: ['Read Rate']
      },
      series: [{
        name: 'Read Rate',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#ff9f43' },
        areaStyle: { opacity: 0.3 }
      }]
    };

    // Disk Write Chart
    this.diskWriteChartOption = {
      ...baseOption,
      title: {
        text: 'Disk Write Activity (KB/s)',
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      legend: {
        ...baseOption.legend,
        data: ['Write Rate']
      },
      series: [{
        name: 'Write Rate',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#ee5a52' },
        areaStyle: { opacity: 0.3 }
      }]
    };

    // Network Packets Chart
    this.networkPacketsChartOption = {
      ...baseOption,
      title: {
        text: 'Network Packets (per 5s)',
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      legend: {
        ...baseOption.legend,
        data: ['Input Packets', 'Output Packets']
      },
      series: [{
        name: 'Input Packets',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#8061ef' }
      }, {
        name: 'Output Packets',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#42aaff' }
      }]
    };

    // Network Errors Chart
    this.networkErrorsChartOption = {
      ...baseOption,
      title: {
        text: 'Network Errors',
        textStyle: {
          color: this.echartTheme === 'dark' ? '#ffffff' : '#000000'
        }
      },
      legend: {
        ...baseOption.legend,
        data: ['Input Errors', 'Output Errors']
      },
      series: [{
        name: 'Input Errors',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#ff3d71' }
      }, {
        name: 'Output Errors',
        type: 'line',
        data: [],
        smooth: true,
        itemStyle: { color: '#ff6b6b' }
      }]
    };
  }

  private subscribeToRealtimeData() {
    this.dataSubscription = this.monitoringService.getRealtimeMetrics().subscribe(data => {
      this.lastUpdateTime = new Date();
      
      // Update data arrays
      if (data.vmstat && data.vmstat.length > 0) {
        this.cpuData.push(...data.vmstat);
        this.memoryData.push(...data.vmstat);
      }

      if (data.iostat && data.iostat.length > 0) {
        this.diskReadData.push(...data.iostat);
        this.diskWriteData.push(...data.iostat);
      }

      if (data.netstat && data.netstat.length > 0) {
        this.networkPacketsData.push(...data.netstat);
        this.networkErrorsData.push(...data.netstat);
      }

      // Keep only last 50 points for performance
      this.trimDataArrays();

      // Update charts
      this.updateCharts();
    });
  }

  private subscribeToSystemSummary() {
    this.summarySubscription = this.monitoringService.getSystemSummary().subscribe(summary => {
      this.currentCpuUsage = summary.cpu.usage;
      this.currentMemoryUsage = summary.memory.usage_percent;
      this.totalDiskRead = Math.round(summary.disk.total_read);
      this.totalDiskWrite = Math.round(summary.disk.total_write);
      this.totalNetworkPackets = summary.network.total_packets;
      this.totalNetworkErrors = summary.network.total_errors;
      this.diskStatus = summary.disk.status;
      this.networkStatus = summary.network.status;
      this.processCount = summary.processes.total;
      this.systemLoad = summary.cpu.usage + (summary.memory.usage_percent / 4); // Combined load metric
    });
  }

  private trimDataArrays() {
    const maxPoints = 50;
    
    if (this.cpuData.length > maxPoints) {
      this.cpuData = this.cpuData.slice(-maxPoints);
    }
    if (this.memoryData.length > maxPoints) {
      this.memoryData = this.memoryData.slice(-maxPoints);
    }
    if (this.diskReadData.length > maxPoints) {
      this.diskReadData = this.diskReadData.slice(-maxPoints);
    }
    if (this.diskWriteData.length > maxPoints) {
      this.diskWriteData = this.diskWriteData.slice(-maxPoints);
    }
    if (this.networkPacketsData.length > maxPoints) {
      this.networkPacketsData = this.networkPacketsData.slice(-maxPoints);
    }
    if (this.networkErrorsData.length > maxPoints) {
      this.networkErrorsData = this.networkErrorsData.slice(-maxPoints);
    }
  }

  private updateCharts() {
    // Update CPU chart
    this.cpuChartOption = {
      ...this.cpuChartOption,
      series: [{
        ...this.cpuChartOption.series[0],
        data: this.cpuData.map(item => [item.timestamp, item.us])
      }, {
        ...this.cpuChartOption.series[1],
        data: this.cpuData.map(item => [item.timestamp, item.sy])
      }]
    };

    // Update Memory chart (convert to GB)
    this.memoryChartOption = {
      ...this.memoryChartOption,
      series: [{
        ...this.memoryChartOption.series[0],
        data: this.memoryData.map(item => [item.timestamp, Math.round(item.avm / 1024 / 1024 * 100) / 100])
      }, {
        ...this.memoryChartOption.series[1],
        data: this.memoryData.map(item => [item.timestamp, Math.round(item.fre / 1024 / 1024 * 100) / 100])
      }]
    };

    // Update Disk Read chart (aggregate all disks)
    const diskReadByTime = this.aggregateDiskData(this.diskReadData, 'kb_read');
    this.diskReadChartOption = {
      ...this.diskReadChartOption,
      series: [{
        ...this.diskReadChartOption.series[0],
        data: Object.entries(diskReadByTime).map(([timestamp, value]) => [timestamp, value])
      }]
    };

    // Update Disk Write chart (aggregate all disks)
    const diskWriteByTime = this.aggregateDiskData(this.diskWriteData, 'kb_wrtn');
    this.diskWriteChartOption = {
      ...this.diskWriteChartOption,
      series: [{
        ...this.diskWriteChartOption.series[0],
        data: Object.entries(diskWriteByTime).map(([timestamp, value]) => [timestamp, value])
      }]
    };

    // Update Network Packets chart
    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      series: [{
        ...this.networkPacketsChartOption.series[0],
        data: this.networkPacketsData.map(item => [item.timestamp, item.ipkts])
      }, {
        ...this.networkPacketsChartOption.series[1],
        data: this.networkPacketsData.map(item => [item.timestamp, item.opkts])
      }]
    };

    // Update Network Errors chart
    this.networkErrorsChartOption = {
      ...this.networkErrorsChartOption,
      series: [{
        ...this.networkErrorsChartOption.series[0],
        data: this.networkErrorsData.map(item => [item.timestamp, item.ierrs])
      }, {
        ...this.networkErrorsChartOption.series[1],
        data: this.networkErrorsData.map(item => [item.timestamp, item.oerrs])
      }]
    };
  }

  private aggregateDiskData(diskData: IostatData[], field: keyof IostatData): { [timestamp: string]: number } {
    const aggregated: { [timestamp: string]: number } = {};
    
    diskData.forEach(item => {
      const timestamp = item.timestamp;
      if (!aggregated[timestamp]) {
        aggregated[timestamp] = 0;
      }
      aggregated[timestamp] += Number(item[field]) || 0;
    });

    return aggregated;
  }

  // Status color methods
  getStatusColor(status: string): string {
    switch (status) {
      case 'Normal':
      case 'Active':
        return 'success';
      case 'High Load':
        return 'warning';
      case 'Errors Detected':
        return 'danger';
      default:
        return 'info';
    }
  }

  getCpuStatusColor(): string {
    if (this.currentCpuUsage > 80) return 'danger';
    if (this.currentCpuUsage > 60) return 'warning';
    return 'success';
  }

  getMemoryStatusColor(): string {
    if (this.currentMemoryUsage > 85) return 'danger';
    if (this.currentMemoryUsage > 70) return 'warning';
    return 'success';
  }

  getSystemLoadColor(): string {
    if (this.systemLoad > 80) return 'danger';
    if (this.systemLoad > 60) return 'warning';
    return 'success';
  }
}