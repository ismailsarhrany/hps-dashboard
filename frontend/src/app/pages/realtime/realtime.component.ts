import { Component, OnInit, OnDestroy } from "@angular/core";
import { Subscription } from "rxjs";
import { NbThemeService } from "@nebular/theme";
import {
  RealtimeService,
  VmstatData,
  RealtimeConnectionStatus,
  ProcessData,
  NetstatData,
  IostatData
} from "../../services/realtime.service";
import { ServerService, Server } from '../../services/server.service';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

interface RatePoint {
  timestamp: number;
  rate: number;
  id?: string;
}

interface WebSocketData {
  metric: string;
  timestamp: string;
  values: any;
  id?: number;
  sequence_id?: number;
}

@Component({
  selector: "ngx-realtime",
  templateUrl: "./realtime.component.html",
  styleUrls: ["./realtime.component.scss"],
})
export class RealtimeComponent implements OnInit, OnDestroy {
  // Server management
  currentServerId: string | null = null;
  currentServer: Server | null = null;
  servers: Server[] = [];

  // Existing properties
  private vmstatSubscription: Subscription;
  private netstatSubscription: Subscription;
  private iostatSubscription: Subscription;
  private processSubscription: Subscription;
  private connectionSubscription: Subscription;
  private themeSubscription: Subscription;
  private colors: any;
  private echartTheme: any;
  private destroy$ = new Subject<void>();

  cpuData: VmstatData[] = [];
  memoryData: VmstatData[] = [];
  diskReadRatePoints: RatePoint[] = [];
  diskWriteRatePoints: RatePoint[] = [];
  networkInputRatePoints: RatePoint[] = [];
  networkOutputRatePoints: RatePoint[] = [];
  networkInputErrorRatePoints: RatePoint[] = [];
  networkOutputErrorRatePoints: RatePoint[] = [];

  cpuChartOption: any = {};
  memoryChartOption: any = {};
  diskReadChartOption: any = {};
  diskWriteChartOption: any = {};
  networkPacketsChartOption: any = {};
  networkErrorsChartOption: any = {};

  currentCpuUsage: number = 0;
  currentMemoryUsage: number = 0;
  diskStatus: string = "Normal";
  networkStatus: string = "Active";
  currentDiskReadRate: number = 0;
  currentDiskWriteRate: number = 0;
  currentNetInputRate: number = 0;
  currentNetOutputRate: number = 0;
  currentTotalNetworkRate: number = 0;
  currentTotalErrorRate: number = 0;

  systemLoad: number = 0;
  processCount: number = 0;
  lastUpdateTime: Date = new Date();

  private readonly timeWindowSeconds: number = 60;
  private readonly maxPointsPerSeries: number = 200;

  constructor(
    private theme: NbThemeService,
    private realtimeService: RealtimeService,
    private serverService: ServerService
  ) { }

  ngOnInit() {
    this.themeSubscription = this.theme.getJsTheme().subscribe((config) => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
      // Only start monitoring if we have a selected server
      if (this.currentServerId) {
        this.startRealtimeMonitoring();
      }
    });

    // Initialize and fetch servers
    this.serverService.fetchServers();

    // Subscribe to servers list
    this.serverService.servers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(servers => {
        this.servers = servers || [];
      });

    // Handle server selection changes
    this.serverService.selectedServerId$
      .pipe(takeUntil(this.destroy$))
      .subscribe(serverId => {
        if (serverId !== this.currentServerId) {
          this.currentServerId = serverId;
          this.updateCurrentServer();
          this.resetData();

          // Only start monitoring if we have a valid server ID
          if (serverId) {
            this.startRealtimeMonitoring();
          }
        }
      });

    // Subscribe to current server details
    this.serverService.getSelectedServer()
      .pipe(takeUntil(this.destroy$))
      .subscribe(server => {
        this.currentServer = server;
      });
  }

  ngOnDestroy() {
    this.stopAllSubscriptions();
    this.realtimeService.disconnectAll();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Server management methods
  private updateCurrentServer(): void {
    if (this.currentServerId) {
      this.currentServer = this.servers.find(s => s.id === this.currentServerId) || null;
    } else {
      this.currentServer = null;
    }
  }

  onServerChange(serverId: string): void {
    // This is handled automatically by the ServerService
    console.log('Server changed to:', serverId);
  }

  // Add trackBy function for better performance
  trackByServerId(index: number, server: Server): string {
    return server.id;
  }

  private resetData() {
    this.stopAllSubscriptions();
    this.realtimeService.disconnectAll();

    // Reset all data arrays
    this.cpuData = [];
    this.memoryData = [];
    this.diskReadRatePoints = [];
    this.diskWriteRatePoints = [];
    this.networkInputRatePoints = [];
    this.networkOutputRatePoints = [];
    this.networkInputErrorRatePoints = [];
    this.networkOutputErrorRatePoints = [];

    // Reset summary values
    this.currentCpuUsage = 0;
    this.currentMemoryUsage = 0;
    this.diskStatus = "Normal";
    this.networkStatus = "Active";
    this.currentDiskReadRate = 0;
    this.currentDiskWriteRate = 0;
    this.currentNetInputRate = 0;
    this.currentNetOutputRate = 0;
    this.currentTotalNetworkRate = 0;
    this.currentTotalErrorRate = 0;
    this.systemLoad = 0;
    this.processCount = 0;
    this.lastUpdateTime = new Date();
  }

  private stopAllSubscriptions() {
    [
      this.vmstatSubscription,
      this.netstatSubscription,
      this.iostatSubscription,
      this.processSubscription,
      this.connectionSubscription,
    ].forEach((sub) => sub?.unsubscribe());
  }

  private startRealtimeMonitoring() {
    if (!this.currentServerId) {
      console.warn("No server selected for realtime monitoring");
      return;
    }

    console.log(`Starting realtime monitoring for server: ${this.currentServerId}`);

    this.realtimeService.connectToMetrics(this.currentServerId, [
      'vmstat', 'iostat', 'netstat', 'process'
    ]);

    this.connectionSubscription = this.realtimeService
      .getOverallConnectionStatus()
      .subscribe((status) => {
        if (status === RealtimeConnectionStatus.CONNECTED) {
          this.lastUpdateTime = new Date();
        }
      });

    this.vmstatSubscription = this.realtimeService
      .getRealtimeVmstat(this.currentServerId)
      .subscribe((data) => this.processVmstatData(data as VmstatData));

    this.netstatSubscription = this.realtimeService
      .getRealtimeNetstat(this.currentServerId)
      .subscribe((data) => this.processNetstatData(data as NetstatData));

    this.iostatSubscription = this.realtimeService
      .getRealtimeIostat(this.currentServerId)
      .subscribe((data) => this.processIostatData(data as IostatData));

    this.processSubscription = this.realtimeService
      .getRealtimeProcess(this.currentServerId)
      .subscribe((data) => this.processProcessData(data as ProcessData));
  }

  // Rest of your existing methods remain unchanged...
  private processProcessData(data: ProcessData) {
    this.processCount++;
  }

  private processVmstatData(data: VmstatData) {
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) return;
    this.cpuData.push(data);
    this.memoryData.push(data);
    this.currentCpuUsage = Math.round((100 - data.idle) * 100) / 100;
    const totalMemory = data.avm + data.fre;
    this.currentMemoryUsage =
      totalMemory > 0
        ? Math.round((data.avm / totalMemory) * 100 * 100) / 100
        : 0;
    this.systemLoad = data.r;
    this.trimAndSortDataArrays();
    this.updateCharts();
    this.lastUpdateTime = new Date();
  }

  private processNetstatData(data: NetstatData) {
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;
    const interfaceKey = data.interface || "default";

    const inputRate = data.ipkts_rate ?? 0;
    const outputRate = data.opkts_rate ?? 0;
    const inputErrorRate = data.ierrs_rate ?? 0;
    const outputErrorRate = data.oerrs_rate ?? 0;

    this.networkInputRatePoints.push({
      timestamp: currentTimestamp,
      rate: inputRate,
      id: interfaceKey,
    });
    this.networkOutputRatePoints.push({
      timestamp: currentTimestamp,
      rate: outputRate,
      id: interfaceKey,
    });
    this.networkInputErrorRatePoints.push({
      timestamp: currentTimestamp,
      rate: inputErrorRate,
      id: interfaceKey,
    });
    this.networkOutputErrorRatePoints.push({
      timestamp: currentTimestamp,
      rate: outputErrorRate,
      id: interfaceKey,
    });

    this.currentTotalNetworkRate =
      this.networkInputRatePoints.reduce((sum, p) => sum + p.rate, 0) +
      this.networkOutputRatePoints.reduce((sum, p) => sum + p.rate, 0);
    this.currentTotalErrorRate =
      this.networkInputErrorRatePoints.reduce((sum, p) => sum + p.rate, 0) +
      this.networkOutputErrorRatePoints.reduce((sum, p) => sum + p.rate, 0);
    this.networkStatus =
      this.currentTotalErrorRate > 0.1 ? "Errors Detected" : "Active";

    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private processIostatData(data: IostatData) {
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;
    const diskKey = data.disk || "default";

    const readRate = data.kb_read_rate ?? 0;
    const writeRate = data.kb_wrtn_rate ?? 0;

    this.diskReadRatePoints.push({
      timestamp: currentTimestamp,
      rate: readRate,
      id: diskKey,
    });
    this.diskWriteRatePoints.push({
      timestamp: currentTimestamp,
      rate: writeRate,
      id: diskKey,
    });

    this.currentDiskReadRate = this.diskReadRatePoints.reduce(
      (sum, p) => sum + p.rate,
      0
    );
    this.currentDiskWriteRate = this.diskWriteRatePoints.reduce(
      (sum, p) => sum + p.rate,
      0
    );
    const totalActivityRate =
      this.currentDiskReadRate + this.currentDiskWriteRate;
    this.diskStatus = totalActivityRate > 10000 ? "High Load" : "Normal";

    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private trimAndSortDataArrays() {
    const now = new Date().getTime();
    const cutoffTime = now - this.timeWindowSeconds * 1000;

    const filterAndSort = <T extends { timestamp: number | string }>(
      arr: T[]
    ): T[] => {
      let filtered = arr.filter((item) => {
        const itemTime =
          typeof item.timestamp === "string"
            ? new Date(item.timestamp).getTime()
            : item.timestamp;
        return !isNaN(itemTime) && itemTime >= cutoffTime;
      });
      filtered.sort((a, b) => {
        const timeA =
          typeof a.timestamp === "string"
            ? new Date(a.timestamp).getTime()
            : a.timestamp;
        const timeB =
          typeof b.timestamp === "string"
            ? new Date(b.timestamp).getTime()
            : b.timestamp;
        return timeA - timeB;
      });
      if (filtered.length > this.maxPointsPerSeries) {
        filtered = filtered.slice(filtered.length - this.maxPointsPerSeries);
      }
      return filtered;
    };

    this.cpuData = filterAndSort(this.cpuData);
    this.memoryData = filterAndSort(this.memoryData);
    this.diskReadRatePoints = filterAndSort(this.diskReadRatePoints);
    this.diskWriteRatePoints = filterAndSort(this.diskWriteRatePoints);
    this.networkInputRatePoints = filterAndSort(this.networkInputRatePoints);
    this.networkOutputRatePoints = filterAndSort(this.networkOutputRatePoints);
    this.networkInputErrorRatePoints = filterAndSort(
      this.networkInputErrorRatePoints
    );
    this.networkOutputErrorRatePoints = filterAndSort(
      this.networkOutputErrorRatePoints
    );
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === "white" ? "#222b45" : "#ffffff",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          label: {
            backgroundColor: "#ffffff",
          },
        },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          let tooltip = `${new Date(
            params[0].axisValue
          ).toLocaleString()}<br/>`;
          params.forEach((param) => {
            const value =
              param.value && typeof param.value[1] === "number"
                ? param.value[1].toFixed(2)
                : "N/A";
            tooltip += `${param.marker} ${param.seriesName}: ${value}<br/>`;
          });
          return tooltip;
        },
      },
      legend: {
        data: [],
        type: "scroll",
        orient: "horizontal",
        top: "top",
        textStyle: {
          color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "10%",
        containLabel: true,
      },
      xAxis: {
        type: "time",
        boundaryGap: false,
        axisLine: {
          lineStyle: {
            color: this.echartTheme === "dark" ? "#484b58" : "#e0e0e0",
          },
        },
        axisLabel: {
          color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
        },
      },
      yAxis: {
        type: "value",
        axisLine: {
          lineStyle: {
            color: this.echartTheme === "dark" ? "#484b58" : "#e0e0e0",
          },
        },
        axisLabel: {
          color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
          formatter: "{value}",
        },
        splitLine: {
          lineStyle: {
            color: this.echartTheme === "dark" ? "#3c3f4c" : "#eee",
          },
        },
      },
    };

    this.cpuChartOption = {
      ...baseOption,
      yAxis: {
        ...baseOption.yAxis,
        max: 100,
        axisLabel: { formatter: "{value} %" },
      },
      legend: { ...baseOption.legend, data: ["User CPU", "System CPU"] },
      series: [
        {
          name: "User CPU",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#3366ff" },
          areaStyle: { opacity: 0.3 },
        },
        {
          name: "System CPU",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#ff3d71" },
          areaStyle: { opacity: 0.3 },
        },
      ],
    };
    this.memoryChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} MiB" } },
      legend: { ...baseOption.legend, data: ["Used Memory", "Free Memory"] },
      series: [
        {
          name: "Used Memory",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#00d68f" },
          areaStyle: { opacity: 0.3 },
        },
        {
          name: "Free Memory",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#0095ff" },
          areaStyle: { opacity: 0.3 },
        },
      ],
    };
    this.diskReadChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} KB/s" } },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.diskWriteChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} KB/s" } },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.networkPacketsChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} pps" } },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.networkErrorsChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} eps" } },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
  }

  private updateCharts() {
    if (!this.echartTheme) return;

    const now = new Date();
    const startTime = now.getTime() - this.timeWindowSeconds * 1000;
    const endTime = now.getTime();
    const xAxisRange = { min: startTime, max: endTime };

    this.cpuChartOption = {
      ...this.cpuChartOption,
      xAxis: { ...this.cpuChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.cpuChartOption.series[0],
          data: this.cpuData.map((item) => [
            new Date(item.timestamp).getTime(),
            item.us,
          ]),
        },
        {
          ...this.cpuChartOption.series[1],
          data: this.cpuData.map((item) => [
            new Date(item.timestamp).getTime(),
            item.sy,
          ]),
        },
      ],
    };

    this.memoryChartOption = {
      ...this.memoryChartOption,
      xAxis: { ...this.memoryChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.memoryChartOption.series[0],
          data: this.memoryData.map((item) => [
            new Date(item.timestamp).getTime(),
            Math.round((item.avm / 1024 / 1024) * 100) / 100,
          ]),
        },
        {
          ...this.memoryChartOption.series[1],
          data: this.memoryData.map((item) => [
            new Date(item.timestamp).getTime(),
            Math.round((item.fre / 1024 / 1024) * 100) / 100,
          ]),
        },
      ],
    };

    const createSeriesDataWithPadding = (
      points: RatePoint[],
      entityId: string,
      startTime: number,
      endTime: number
    ): [number, number][] => {
      const currentEntityPoints = points
        .filter(
          (p) =>
            p.id === entityId &&
            p.timestamp >= startTime &&
            p.timestamp <= endTime
        )
        .sort((a, b) => a.timestamp - b.timestamp);

      let echartsData: [number, number][] = [];
      const startPoint: [number, number] = [startTime, 0];
      const endPoint: [number, number] = [endTime, 0];

      if (currentEntityPoints.length > 0) {
        const firstPointTime = currentEntityPoints[0].timestamp;
        const lastPointTime =
          currentEntityPoints[currentEntityPoints.length - 1].timestamp;

        if (firstPointTime > startTime) {
          echartsData.push(startPoint);
        }

        echartsData.push(
          ...currentEntityPoints.map((p): [number, number] => [
            p.timestamp,
            p.rate,
          ])
        );

        if (lastPointTime < endTime) {
          const lastRate =
            currentEntityPoints[currentEntityPoints.length - 1].rate;
          echartsData.push([endTime, lastRate]);
        }
      } else {
        echartsData.push(startPoint);
        echartsData.push(endPoint);
      }
      return echartsData;
    };

    const allDisks = [
      ...new Set(
        [...this.diskReadRatePoints, ...this.diskWriteRatePoints].map(
          (p) => p.id || "default"
        )
      ),
    ];

    const diskReadSeries = allDisks.map((disk) => ({
      name: `${disk} Read`,
      type: "line",
      data: createSeriesDataWithPadding(
        this.diskReadRatePoints,
        disk,
        startTime,
        endTime
      ),
      smooth: true,
      itemStyle: { color: this.getRandomColor(disk + "_read") },
    }));

    this.diskReadChartOption = {
      ...this.diskReadChartOption,
      xAxis: { ...this.diskReadChartOption.xAxis, ...xAxisRange },
      legend: {
        ...this.diskReadChartOption.legend,
        data: diskReadSeries.map((s) => s.name),
      },
      series: diskReadSeries,
    };

    const diskWriteSeries = allDisks.map((disk) => ({
      name: `${disk} Write`,
      type: "line",
      data: createSeriesDataWithPadding(
        this.diskWriteRatePoints,
        disk,
        startTime,
        endTime
      ),
      smooth: true,
      itemStyle: { color: this.getRandomColor(disk + "_write") },
    }));

    this.diskWriteChartOption = {
      ...this.diskWriteChartOption,
      xAxis: { ...this.diskWriteChartOption.xAxis, ...xAxisRange },
      legend: {
        ...this.diskWriteChartOption.legend,
        data: diskWriteSeries.map((s) => s.name),
      },
      series: diskWriteSeries,
    };

    const allInterface = [
      ...new Set(
        [
          ...this.networkInputRatePoints,
          ...this.networkOutputRatePoints,
          ...this.networkInputErrorRatePoints,
          ...this.networkOutputErrorRatePoints,
        ].map((p) => p.id || "default")
      ),
    ];

    const networkPacketSeries = allInterface.reduce((acc, iface) => {
      return acc.concat([
        {
          name: `${iface} Input`,
          type: "line",
          data: createSeriesDataWithPadding(
            this.networkInputRatePoints,
            iface,
            startTime,
            endTime
          ),
          smooth: true,
          itemStyle: { color: this.getRandomColor(iface + "_in_pkt") },
        },
        {
          name: `${iface} Output`,
          type: "line",
          data: createSeriesDataWithPadding(
            this.networkOutputRatePoints,
            iface,
            startTime,
            endTime
          ),
          smooth: true,
          itemStyle: { color: this.getRandomColor(iface + "_out_pkt") },
        },
      ]);
    }, [] as any[]);

    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      xAxis: { ...this.networkPacketsChartOption.xAxis, ...xAxisRange },
      legend: {
        ...this.networkPacketsChartOption.legend,
        data: networkPacketSeries.map((s) => s.name),
      },
      series: networkPacketSeries,
    };

    const networkErrorSeries = allInterface.reduce((acc, iface) => {
      return acc.concat([
        {
          name: `${iface} Input Error`,
          type: "line",
          data: createSeriesDataWithPadding(
            this.networkInputErrorRatePoints,
            iface,
            startTime,
            endTime
          ),
          smooth: true,
          itemStyle: { color: this.getRandomColor(iface + "_in_err") },
        },
        {
          name: `${iface} Output Error`,
          type: "line",
          data: createSeriesDataWithPadding(
            this.networkOutputErrorRatePoints,
            iface,
            startTime,
            endTime
          ),
          smooth: true,
          itemStyle: { color: this.getRandomColor(iface + "_out_err") },
        },
      ]);
    }, [] as any[]);

    this.networkErrorsChartOption = {
      ...this.networkErrorsChartOption,
      xAxis: { ...this.networkErrorsChartOption.xAxis, ...xAxisRange },
      legend: {
        ...this.networkErrorsChartOption.legend,
        data: networkErrorSeries.map((s) => s.name),
      },
      series: networkErrorSeries,
    };
  }

  private getRandomColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash;
    }
    const colors = [
      "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
      "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc", "#3366ff",
      "#00d68f", "#ff3d71", "#ffaa00", "#42aaff", "#8061ef",
      "#ff6b6b", "#00d9bf"
    ];
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  getCpuStatusColor(): string {
    if (this.currentCpuUsage > 80) return "danger";
    if (this.currentCpuUsage > 60) return "warning";
    return "success";
  }
  getMemoryStatusColor(): string {
    if (this.currentMemoryUsage > 90) return "danger";
    if (this.currentMemoryUsage > 70) return "warning";
    return "success";
  }
  getSystemLoadColor(): string {
    if (this.systemLoad > 5) return "danger";
    if (this.systemLoad > 2) return "warning";
    return "success";
  }
  getStatusColor(status: string): string {
    switch (status) {
      case "High Load":
      case "Errors Detected":
        return "warning";
      case "Critical":
        return "danger";
      default:
        return "success";
    }
  }
}