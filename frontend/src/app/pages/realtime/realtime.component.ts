import { Component, OnInit, OnDestroy } from "@angular/core";
import { Subscription } from "rxjs";
import { NbThemeService } from "@nebular/theme";
import {
  RealtimeService,
  VmstatData,
  NetstatData, // Keep for type hint, even if rates are separate
  IostatData, // Keep for type hint
  ProcessData,
  RealtimeConnectionStatus,
} from "../../services/realtime.service";

// Interface pour stocker les points de taux (reçus du backend)
interface RatePoint {
  timestamp: number;
  rate: number;
  id?: string; // disk name or interface name
}

// Interface pour les données WebSocket enrichies (type plus précis)
interface WebSocketData {
  metric: string;
  timestamp: string; // ISO string from backend
  values: any; // Contient les données brutes ET les taux calculés par le backend
  id?: number;
  sequence_id?: number;
}

@Component({
  selector: "ngx-realtime",
  templateUrl: "./realtime.component.html",
  styleUrls: ["./realtime.component.scss"],
})
export class RealtimeComponent implements OnInit, OnDestroy {
  private vmstatSubscription: Subscription;
  private netstatSubscription: Subscription;
  private iostatSubscription: Subscription;
  private processSubscription: Subscription;
  private connectionSubscription: Subscription;
  private themeSubscription: Subscription;
  private colors: any;
  private echartTheme: any;

  // --- Données pour les graphiques ---
  cpuData: VmstatData[] = [];
  memoryData: VmstatData[] = [];
  diskReadRatePoints: RatePoint[] = [];
  diskWriteRatePoints: RatePoint[] = [];
  networkInputRatePoints: RatePoint[] = [];
  networkOutputRatePoints: RatePoint[] = [];
  networkInputErrorRatePoints: RatePoint[] = [];
  networkOutputErrorRatePoints: RatePoint[] = [];

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
  diskStatus: string = "Normal";
  networkStatus: string = "Active";
  currentDiskReadRate: number = 0;
  currentDiskWriteRate: number = 0;
  currentNetInputRate: number = 0; // Note: This might become less meaningful with multiple interfaces
  currentNetOutputRate: number = 0; // Note: This might become less meaningful with multiple interfaces
  currentTotalNetworkRate: number = 0;
  currentTotalErrorRate: number = 0;

  // Additional metrics
  systemLoad: number = 0;
  processCount: number = 0;
  lastUpdateTime: Date = new Date();

  // Configuration
  private readonly timeWindowSeconds: number = 60;
  private readonly maxPointsPerSeries: number = 200;

  constructor(
    private theme: NbThemeService,
    private realtimeService: RealtimeService
  ) {}

  ngOnInit() {
    this.themeSubscription = this.theme.getJsTheme().subscribe((config) => {
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
      this.connectionSubscription,
      this.themeSubscription,
    ].forEach((sub) => sub?.unsubscribe());
  }

  private startRealtimeMonitoring() {
    this.realtimeService.startRealtimeMonitoring();
    this.connectionSubscription = this.realtimeService
      .getOverallConnectionStatus()
      .subscribe((status) => {
        if (status === RealtimeConnectionStatus.CONNECTED) {
          this.lastUpdateTime = new Date();
        }
      });

    this.vmstatSubscription = this.realtimeService
      .getRealtimeVmstat()
      .subscribe((data) => this.processVmstatData(data as VmstatData));

    this.netstatSubscription = this.realtimeService
      .getRealtimeNetstat()
      .subscribe((data) => this.processNetstatData(data as WebSocketData));

    this.iostatSubscription = this.realtimeService
      .getRealtimeIostat()
      .subscribe((data) => this.processIostatData(data as WebSocketData));

    this.processSubscription = this.realtimeService
      .getRealtimeProcess()
      .subscribe((data) => this.processProcessData(data as ProcessData));
  }

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

  private processNetstatData(wsData: WebSocketData) {
    const data = wsData.values;
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;
    const interfaceKey = data.interface || "default"; // Use 'default' if interface is missing

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

    // Update summary widgets (consider how to aggregate/display with multiple interfaces)
    // For now, let's sum all interfaces for the total widgets
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

  private processIostatData(wsData: WebSocketData) {
    const data = wsData.values;
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;
    const diskKey = data.disk || "default"; // Use 'default' if disk is missing

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

    // Update summary widgets (summing across disks)
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
      // Sort is crucial for line charts
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
      // Limit points *after* sorting and filtering by time
      if (filtered.length > this.maxPointsPerSeries) {
        // Keep the most recent points
        filtered = filtered.slice(filtered.length - this.maxPointsPerSeries);
      }
      return filtered;
    };

    // Apply to all data arrays
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
        data: [], // Will be populated dynamically
        type: "scroll", // Allow scrolling if many items
        orient: "horizontal",
        top: "top",
        textStyle: {
          color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "10%", // Adjust bottom to make space for scrollable legend
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

    // Initialize options - series and legend data will be overwritten in updateCharts
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
      legend: { ...baseOption.legend, data: [] }, // Dynamic
      series: [], // Dynamic
    };
    this.diskWriteChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} KB/s" } },
      legend: { ...baseOption.legend, data: [] }, // Dynamic
      series: [], // Dynamic
    };
    this.networkPacketsChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} pps" } },
      legend: { ...baseOption.legend, data: [] }, // Dynamic
      series: [], // Dynamic
    };
    this.networkErrorsChartOption = {
      ...baseOption,
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} eps" } },
      legend: { ...baseOption.legend, data: [] }, // Dynamic
      series: [], // Dynamic
    };
  }

  private updateCharts() {
    if (!this.echartTheme) return;

    const now = new Date();
    const startTime = now.getTime() - this.timeWindowSeconds * 1000;
    const endTime = now.getTime();
    const xAxisRange = { min: startTime, max: endTime };

    // --- CPU Chart ---
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

    // --- Memory Chart ---
    this.memoryChartOption = {
      ...this.memoryChartOption,
      xAxis: { ...this.memoryChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.memoryChartOption.series[0],
          data: this.memoryData.map((item) => [
            new Date(item.timestamp).getTime(),
            Math.round((item.avm / 1024 / 1024) * 100) / 100, // Convert KiB to MiB
          ]),
        },
        {
          ...this.memoryChartOption.series[1],
          data: this.memoryData.map((item) => [
            new Date(item.timestamp).getTime(),
            Math.round((item.fre / 1024 / 1024) * 100) / 100, // Convert KiB to MiB
          ]),
        },
      ],
    };

    // --- Helper function to create series data with padding ---
    const createSeriesDataWithPadding = (
      points: RatePoint[],
      entityId: string, // disk or interface ID
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
        .sort((a, b) => a.timestamp - b.timestamp); // Ensure sorted by time

      let echartsData: [number, number][] = [];
      const startPoint: [number, number] = [startTime, 0]; // Use 0 for padding
      const endPoint: [number, number] = [endTime, 0]; // Use 0 for padding

      if (currentEntityPoints.length > 0) {
        const firstPointTime = currentEntityPoints[0].timestamp;
        const lastPointTime =
          currentEntityPoints[currentEntityPoints.length - 1].timestamp;

        // Add start padding point if the first actual point is after the window start
        if (firstPointTime > startTime) {
          echartsData.push(startPoint);
        }

        // Add actual points
        echartsData.push(
          ...currentEntityPoints.map((p): [number, number] => [
            p.timestamp,
            p.rate,
          ])
        );

        // Add end padding point if the last actual point is before the window end
        if (lastPointTime < endTime) {
          // Add a point with the last known rate at the end time for better visualization
          const lastRate =
            currentEntityPoints[currentEntityPoints.length - 1].rate;
          echartsData.push([endTime, lastRate]);
          // Or use 0 padding: echartsData.push(endPoint);
        }
      } else {
        // No data for this entity in the window, draw flat line at 0
        echartsData.push(startPoint);
        echartsData.push(endPoint);
      }
      return echartsData;
    };

    // --- Disk Charts ---
    const allDisks = [
      ...new Set(
        [...this.diskReadRatePoints, ...this.diskWriteRatePoints].map(
          (p) => p.id || "default" // Handle potential missing IDs
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

    // --- Network Charts (CORRECTED DYNAMIC LOGIC using reduce + concat) ---
    const allInterface = [
      ...new Set(
        [
          ...this.networkInputRatePoints,
          ...this.networkOutputRatePoints,
          ...this.networkInputErrorRatePoints,
          ...this.networkOutputErrorRatePoints,
        ].map((p) => p.id || "default") // Handle potential missing IDs
      ),
    ];

    // Network Packets Chart - Replace flatMap with reduce + concat
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
    }, [] as any[]); // Initialize accumulator as an empty array of the correct type

    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      xAxis: { ...this.networkPacketsChartOption.xAxis, ...xAxisRange },
      legend: {
        ...this.networkPacketsChartOption.legend,
        data: networkPacketSeries.map((s) => s.name),
      },
      series: networkPacketSeries,
    };

    // Network Errors Chart - Replace flatMap with reduce + concat
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
    }, [] as any[]); // Initialize accumulator as an empty array of the correct type

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
    // Simple hash function for seed -> color index
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash; // Convert to 32bit integer
    }
    // Use a predefined list of distinct colors
    const colors = [
      "#5470c6",
      "#91cc75",
      "#fac858",
      "#ee6666",
      "#73c0de",
      "#3ba272",
      "#fc8452",
      "#9a60b4",
      "#ea7ccc",
      // Add more colors if needed
      "#3366ff",
      "#00d68f",
      "#ff3d71",
      "#ffaa00",
      "#42aaff",
      "#8061ef",
      "#ff6b6b",
      "#00d9bf",
    ];
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  // --- Getters for status colors (unchanged) ---
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
