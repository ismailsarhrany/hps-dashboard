import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { RealtimeService, VmstatData, NetstatData, IostatData, ProcessData, RealtimeConnectionStatus } from '../../services/realtime.service';

@Component({
  selector: 'ngx-realtime',
  templateUrl: './realtime.component.html',
  styleUrls: ['./realtime.component.scss']
})
export class RealtimeComponent implements OnInit, OnDestroy {
  
  private dataSubscription: Subscription;
  private vmstatSubscription: Subscription;
  private netstatSubscription: Subscription;
  private iostatSubscription: Subscription;
  private processSubscription: Subscription;
  private connectionSubscription: Subscription;
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

  // Configuration pour la fenêtre temporelle
  private readonly timeWindowSeconds: number = 60; // Fenêtre de 60 secondes

  constructor(
    private theme: NbThemeService,
    private realtimeService: RealtimeService
  ) {}

  ngOnInit() {
    this.theme.getJsTheme().subscribe(config => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
      this.startRealtimeMonitoring();
    });
  }

  ngOnDestroy() {
    this.stopAllSubscriptions();
    this.realtimeService.stopRealtimeMonitoring();
  }

  private stopAllSubscriptions() {
    [
      this.vmstatSubscription,
      this.netstatSubscription,
      this.iostatSubscription,
      this.processSubscription,
      this.connectionSubscription
    ].forEach(sub => sub?.unsubscribe());
  }

  private startRealtimeMonitoring() {
    this.realtimeService.startRealtimeMonitoring();

    // Handle connection status changes
    this.connectionSubscription = this.realtimeService.getOverallConnectionStatus().subscribe(status => {
      if (status === RealtimeConnectionStatus.CONNECTED) {
        this.lastUpdateTime = new Date();
      }
    });

    // Process individual data points
    this.vmstatSubscription = this.realtimeService.getRealtimeVmstat().subscribe(
      data => this.processVmstatData(data)
    );

    this.netstatSubscription = this.realtimeService.getRealtimeNetstat().subscribe(
      data => this.processNetstatData(data)
    );

    this.iostatSubscription = this.realtimeService.getRealtimeIostat().subscribe(
      data => this.processIostatData(data)
    );

    this.processSubscription = this.realtimeService.getRealtimeProcess().subscribe(
      data => this.processProcessData(data)
    );
  }

  private processProcessData(data: ProcessData) {
    this.processCount++;
    this.trimAndSortDataArrays();
  }

  private processVmstatData(data: VmstatData) {
    // Validate timestamp before adding
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) {
      console.warn('Invalid timestamp in vmstat data:', data.timestamp);
      return;
    }

    // Check for duplicate or out-of-order data
    const lastItem = this.cpuData[this.cpuData.length - 1];
    if (lastItem) {
      const lastTimestamp = new Date(lastItem.timestamp);
      if (timestamp <= lastTimestamp) {
        console.warn('Out of order or duplicate vmstat data detected:', {
          current: data.timestamp,
          last: lastItem.timestamp
        });
      }
    }

    this.cpuData.push(data);
    this.memoryData.push(data);
    
    this.currentCpuUsage = Math.round((100 - data.idle) * 100) / 100;
    const totalMemory = data.avm + data.fre;
    this.currentMemoryUsage = totalMemory > 0 
      ? Math.round((data.avm / totalMemory) * 100 * 100) / 100 
      : 0;
    this.systemLoad = data.r;
    
    this.trimAndSortDataArrays();
    this.updateCharts();
    this.lastUpdateTime = new Date();
  }

  private processNetstatData(data: NetstatData) {
    // Validate timestamp
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) {
      console.warn('Invalid timestamp in netstat data:', data.timestamp);
      return;
    }

    this.networkPacketsData.push(data);
    this.networkErrorsData.push(data);
    
    this.totalNetworkPackets += data.ipkts + data.opkts;
    this.totalNetworkErrors += data.ierrs + data.oerrs;
    this.networkStatus = this.totalNetworkErrors > 0 ? 'Errors Detected' : 'Active';
    
    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private processIostatData(data: IostatData) {
    // Validate timestamp
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) {
      console.warn('Invalid timestamp in iostat data:', data.timestamp);
      return;
    }

    this.diskReadData.push(data);
    this.diskWriteData.push(data);
    
    this.totalDiskRead += data.kb_read;
    this.totalDiskWrite += data.kb_wrtn;
    
    const totalActivity = this.totalDiskRead + this.totalDiskWrite;
    this.diskStatus = totalActivity > 10000 ? 'High Load' : 'Normal';
    
    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private trimAndSortDataArrays() {
    const maxPoints = 50;
    const maxTimeWindow = this.timeWindowSeconds * 1000; // 60 secondes en millisecondes
    
    // Calculer le timestamp de coupure (60 secondes dans le passé)
    const now = new Date().getTime();
    const cutoffTime = now - maxTimeWindow;
    
    // Fonction générique pour filtrer par timestamp
    const filterByTimestamp = <T extends { timestamp: string }>(arr: T[]): T[] => {
      return arr.filter(item => {
        const itemTime = new Date(item.timestamp).getTime();
        return !isNaN(itemTime) && itemTime >= cutoffTime;
      });
    };
    
    // Fonction générique pour trier par timestamp
    const sortByTimestamp = <T extends { timestamp: string }>(arr: T[]): T[] => {
      return [...arr].sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        
        if (isNaN(dateA) || isNaN(dateB)) {
          return 0;
        }
        
        return dateA - dateB;
      });
    };
    
    // Traiter chaque type de données séparément pour éviter les problèmes de typage
    
    // CPU Data (VmstatData)
    this.cpuData = sortByTimestamp(filterByTimestamp(this.cpuData));
    if (this.cpuData.length > maxPoints) {
      this.cpuData = this.cpuData.slice(this.cpuData.length - maxPoints);
    }
    
    // Memory Data (VmstatData)
    this.memoryData = sortByTimestamp(filterByTimestamp(this.memoryData));
    if (this.memoryData.length > maxPoints) {
      this.memoryData = this.memoryData.slice(this.memoryData.length - maxPoints);
    }
    
    // Disk Read Data (IostatData)
    this.diskReadData = sortByTimestamp(filterByTimestamp(this.diskReadData));
    if (this.diskReadData.length > maxPoints) {
      this.diskReadData = this.diskReadData.slice(this.diskReadData.length - maxPoints);
    }
    
    // Disk Write Data (IostatData)
    this.diskWriteData = sortByTimestamp(filterByTimestamp(this.diskWriteData));
    if (this.diskWriteData.length > maxPoints) {
      this.diskWriteData = this.diskWriteData.slice(this.diskWriteData.length - maxPoints);
    }
    
    // Network Packets Data (NetstatData)
    this.networkPacketsData = sortByTimestamp(filterByTimestamp(this.networkPacketsData));
    if (this.networkPacketsData.length > maxPoints) {
      this.networkPacketsData = this.networkPacketsData.slice(this.networkPacketsData.length - maxPoints);
    }
    
    // Network Errors Data (NetstatData)
    this.networkErrorsData = sortByTimestamp(filterByTimestamp(this.networkErrorsData));
    if (this.networkErrorsData.length > maxPoints) {
      this.networkErrorsData = this.networkErrorsData.slice(this.networkErrorsData.length - maxPoints);
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
      yAxis: {
        ...baseOption.yAxis,
        max: 1 // Set max to 1 since errors are small values
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

  private updateCharts() {
    // Calculer la fenêtre temporelle pour les graphiques
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - this.timeWindowSeconds * 1000);

    // Update CPU chart with validation
    this.cpuChartOption = {
      ...this.cpuChartOption,
      xAxis: {
        ...this.cpuChartOption.xAxis,
        min: oneMinuteAgo.getTime(),
        max: now.getTime()
      },
      series: [{
        ...this.cpuChartOption.series[0],
        data: this.cpuData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, item.us])
      }, {
        ...this.cpuChartOption.series[1],
        data: this.cpuData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, item.sy])
      }]
    };

    // Update Memory chart (convert to GB) with validation
    this.memoryChartOption = {
      ...this.memoryChartOption,
      xAxis: {
        ...this.memoryChartOption.xAxis,
        min: oneMinuteAgo.getTime(),
        max: now.getTime()
      },
      series: [{
        ...this.memoryChartOption.series[0],
        data: this.memoryData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, Math.round(item.avm / 1024 / 1024 * 100) / 100])
      }, {
        ...this.memoryChartOption.series[1],
        data: this.memoryData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, Math.round(item.fre / 1024 / 1024 * 100) / 100])
      }]
    };

    // Update disk charts with proper aggregation and sorting
    const validDiskReadData = this.diskReadData.filter(item => !isNaN(new Date(item.timestamp).getTime()));
    const validDiskWriteData = this.diskWriteData.filter(item => !isNaN(new Date(item.timestamp).getTime()));
    
    const disks = [...new Set(this.diskReadData.map(d => d.disk))];
    this.diskReadChartOption = {
        ...this.diskReadChartOption,
        xAxis: {
          ...this.diskReadChartOption.xAxis,
          min: oneMinuteAgo.getTime(),
          max: now.getTime()
        },
        legend: {
            ...this.diskReadChartOption.legend,
            data: disks
        },
        series: disks.map(disk => ({
            name: disk,
            type: 'line',
            data: this.diskReadData
                .filter(d => d.disk === disk)
                .map(item => [item.timestamp, item.kb_read]),
            smooth: true,
            itemStyle: { color: this.getRandomColor(disk) }
        }))
    };
    this.diskWriteChartOption = {
        ...this.diskWriteChartOption,
        xAxis: {
          ...this.diskWriteChartOption.xAxis,
          min: oneMinuteAgo.getTime(),
          max: now.getTime()
        },
        legend: {
            ...this.diskWriteChartOption.legend,
            data: disks
        },
        series: disks.map(disk => ({
            name: disk,
            type: 'line',
            data: this.diskReadData
                .filter(d => d.disk === disk)
                .map(item => [item.timestamp, item.kb_read]),
            smooth: true,
            itemStyle: { color: this.getRandomColor(disk) }
        }))
    };
    
    // Update Network charts with validation and explicit time window
    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      xAxis: {
        ...this.networkPacketsChartOption.xAxis,
        min: oneMinuteAgo.getTime(),
        max: now.getTime()
      },
      series: [{
        ...this.networkPacketsChartOption.series[0],
        data: this.networkPacketsData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, item.ipkts])
      }, {
        ...this.networkPacketsChartOption.series[1],
        data: this.networkPacketsData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, item.opkts])
      }]
    };

    this.networkErrorsChartOption = {
      ...this.networkErrorsChartOption,
      xAxis: {
        ...this.networkErrorsChartOption.xAxis,
        min: oneMinuteAgo.getTime(),
        max: now.getTime()
      },
      series: [{
        ...this.networkErrorsChartOption.series[0],
        data: this.networkErrorsData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, item.ierrs])
      }, {
        ...this.networkErrorsChartOption.series[1],
        data: this.networkErrorsData
          .filter(item => !isNaN(new Date(item.timestamp).getTime()))
          .map(item => [item.timestamp, item.oerrs])
      }]
    };
  }

  // Fonction utilitaire pour générer des couleurs cohérentes pour les disques
  private getRandomColor(seed: string): string {
    // Générer une couleur basée sur le nom du disque pour la cohérence
    const colors = [
      '#3366ff', '#00d68f', '#ff3d71', '#ffaa00', 
      '#42aaff', '#8061ef', '#ff6b6b', '#00d9bf'
    ];
    
    // Utiliser une somme simple des codes de caractères comme hachage
    const hash = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  // Status color getters
  getCpuStatusColor(): string {
    if (this.currentCpuUsage > 80) return 'danger';
    if (this.currentCpuUsage > 60) return 'warning';
    return 'success';
  }

  getMemoryStatusColor(): string {
    if (this.currentMemoryUsage > 90) return 'danger';
    if (this.currentMemoryUsage > 70) return 'warning';
    return 'success';
  }

  getSystemLoadColor(): string {
    if (this.systemLoad > 5) return 'danger';
    if (this.systemLoad > 2) return 'warning';
    return 'success';
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'High Load':
      case 'Errors Detected':
        return 'warning';
      case 'Critical':
        return 'danger';
      default:
        return 'success';
    }
  }
}
