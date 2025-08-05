// src/app/pages/anomaly/anomaly.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { Subscription, forkJoin, Subject, BehaviorSubject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { NbThemeService } from "@nebular/theme";
import { EChartsOption } from "echarts";
import {
  ApiService,
  VmstatData,
  DateTimeRange,
} from "../../services/monitoring.service";
import {
  DiskDataService,
  HistoricalIostatPoint,
} from "../../services/disk-data.service";
import {
  NetworkDataService,
  HistoricalNetstatPoint,
} from "../../services/network-data.service";
import { ServerService, Server } from '../../services/server.service';

@Component({
  selector: "ngx-anomaly",
  templateUrl: "./anomaly.component.html",
  styleUrls: ["./anomaly.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DiskDataService, NetworkDataService],
})

export class AnomalyComponent implements OnInit, OnDestroy {
  dateRangeForm: FormGroup;
  loading = false;
  showAnomalies = false; // Toggle for anomaly visibility
  private destroy$ = new Subject<void>(); // For subscription cleanup
  private currentServerId: string | null = null;
  currentServer: Server | null = null;

  // Chart Options
  cpuChartOption: EChartsOption = {};
  memoryChartOption: EChartsOption = {};
  diskReadRateChartOption: EChartsOption = {};
  diskWriteRateChartOption: EChartsOption = {};
  diskOpsChartOption: EChartsOption = {};
  networkPacketsInChartOption: EChartsOption = {};
  networkPacketsOutChartOption: EChartsOption = {};
  networkErrorsInChartOption: EChartsOption = {};
  networkErrorsOutChartOption: EChartsOption = {};

  // Data Arrays
  vmstatData: VmstatData[] = [];
  netstatData: HistoricalNetstatPoint[] = [];
  iostatData: HistoricalIostatPoint[] = [];
  servers: Server[] = [];

  // Anomaly data storage
  cpuAnomalies: { user: [number, number][]; system: [number, number][] } = {
    user: [],
    system: [],
  };
  memoryAnomalies: [number, number][] = [];
  diskAnomalies: {
    readRate: { [disk: string]: [number, number][] };
    writeRate: { [disk: string]: [number, number][] };
    ops: { [disk: string]: [number, number][] };
  } = { readRate: {}, writeRate: {}, ops: {} };
  networkAnomalies: {
    packetsIn: { [iface: string]: [number, number][] };
    packetsOut: { [iface: string]: [number, number][] };
    errorsIn: { [iface: string]: [number, number][] };
    errorsOut: { [iface: string]: [number, number][] };
  } = {
      packetsIn: {},
      packetsOut: {},
      errorsIn: {},
      errorsOut: {},
    };

  private themeSubscription: Subscription;
  private dataSubscription: Subscription;
  private theme: any;
  private readonly MAX_DATA_POINTS = 1500;

  constructor(
    private fb: FormBuilder,
    private apiService: ApiService,
    private diskDataService: DiskDataService,
    private networkDataService: NetworkDataService,
    private themeService: NbThemeService,
    private cdr: ChangeDetectorRef,
    private serverService: ServerService // Injected

  ) {
    this.initializeDateForm();
  }

  ngOnInit(): void {
    this.themeSubscription = this.themeService
      .getJsTheme()
      .subscribe((theme) => {
        this.theme = theme;
        this.initializeChartOptions();
        if (
          this.vmstatData.length > 0 ||
          this.netstatData.length > 0 ||
          this.iostatData.length > 0
        ) {
          this.updateAllCharts();
        }
        this.cdr.markForCheck();
      });
    // Add server selection handling
    // Initialize and fetch servers
    this.serverService.fetchServers();

    // Subscribe to servers list
    this.serverService.servers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(servers => {
        this.servers = servers || [];
        this.cdr.markForCheck();
      });

    // Handle server selection changes
    this.serverService.selectedServerId$
      .pipe(takeUntil(this.destroy$))
      .subscribe(serverId => {
        if (serverId !== this.currentServerId) {
          this.currentServerId = serverId;
          this.updateCurrentServer();
          this.resetData();

          // Only load data if we have a valid server ID
          if (serverId) {
            this.loadHistoricalData();
          }
        }
      });

    // Subscribe to current server details
    this.serverService.getSelectedServer()
      .pipe(takeUntil(this.destroy$))
      .subscribe(server => {
        this.currentServer = server;
        this.cdr.markForCheck();
      });
    // this.loadDefaultData();
  }

  ngOnDestroy(): void {
    this.themeSubscription?.unsubscribe();
    this.dataSubscription?.unsubscribe();
  }

    private updateCurrentServer(): void {
    if (this.currentServerId) {
      this.currentServer = this.servers.find(s => s.id === this.currentServerId) || null;
    } else {
      this.currentServer = null;
    }
  }

  private resetData() {
    this.vmstatData = [];
    this.netstatData = [];
    this.iostatData = [];
    this.updateAllCharts(); // Clear charts
    this.cdr.markForCheck();
  }
  onServerChange(serverId: string): void {
    // This is handled automatically by the ServerService
    console.log('Server changed to:', serverId);
  }

  // NEW: Toggle anomaly visibility
  toggleAnomalies(): void {
    this.showAnomalies = !this.showAnomalies;
    this.updateAllCharts();
    this.cdr.markForCheck();
  }

  // initializeDateForm, formatDateForInput, getDateTimeRange remain the same
  private initializeDateForm(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.dateRangeForm = this.fb.group({
      startDate: [this.formatDateForInput(yesterday), Validators.required],
      startTime: ["00:00", Validators.required],
      endDate: [this.formatDateForInput(now), Validators.required],
      endTime: ["23:59", Validators.required],
    });
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private getDateTimeRange(): DateTimeRange {
    const form = this.dateRangeForm.value;
    const startDateTime = `${form.startDate}T${form.startTime}:00`;
    const endDateTime = `${form.endDate}T${form.endTime}:59`;
    return { start: startDateTime, end: endDateTime };
  }

  loadDefaultData(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(yesterday),
      startTime:
        now.getHours().toString().padStart(2, "0") +
        ":" +
        now.getMinutes().toString().padStart(2, "0"),
      endDate: this.formatDateForInput(now),
      endTime:
        now.getHours().toString().padStart(2, "0") +
        ":" +
        now.getMinutes().toString().padStart(2, "0"),
    });
    this.loadHistoricalData();
  }

  loadHistoricalData(dateRange?: DateTimeRange): void {
    if (!this.currentServerId) {
      console.warn("No server selected");
      return;
    }

    this.loading = true;
    this.cdr.markForCheck();
    const range = dateRange || this.getDateTimeRange();

    this.resetData(); // Clear existing data

    this.dataSubscription?.unsubscribe();

    this.dataSubscription = forkJoin({
      vmstat: this.apiService.getHistoricalVmstat(this.currentServerId, range),
      netstat: this.apiService.getHistoricalNetstat(this.currentServerId, range),
      iostat: this.apiService.getHistoricalIostat(this.currentServerId, range),
    }).subscribe({
      next: ({ vmstat, netstat, iostat }) => {
        this.vmstatData = vmstat?.data || [];
        this.netstatData = netstat?.data || [];
        this.iostatData = iostat?.data || [];
        this.updateAllCharts();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error("Error loading historical data:", error);
        this.resetData();
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  onSubmit(): void {
    if (this.dateRangeForm.valid) {
      this.loadHistoricalData();
    }
  }

  // // mapToSeriesData remains the same
  // private mapToSeriesData<
  //   T extends
  //     | { timestamp: string; id?: string }
  //     | VmstatData
  //     | HistoricalIostatPoint
  //     | HistoricalNetstatPoint
  // >(
  //   data: T[],
  //   entityId: string | null,
  //   idField: keyof T | null,
  //   timestampField: keyof T,
  //   valueField: keyof T,
  //   maxPoints: number
  // ): [number, number][] {
  //   const entityData =
  //     entityId && idField
  //       ? data.filter((item) => (item as any)[idField] === entityId)
  //       : data;
  //   const sortedData = entityData.sort(
  //     (a, b) =>
  //       new Date(a[timestampField] as string).getTime() -
  //       new Date(b[timestampField] as string).getTime()
  //   );
  //   const totalPoints = sortedData.length;
  //   if (!sortedData || totalPoints === 0) return [];
  //   if (totalPoints <= maxPoints) {
  //     return sortedData.map((item) => [
  //       new Date(item[timestampField] as string).getTime(),
  //       (item[valueField] as number) || 0,
  //     ]);
  //   }
  //   const sampledData: [number, number][] = [];
  //   const bucketSize = Math.ceil(totalPoints / maxPoints);
  //   for (let i = 0; i < totalPoints; i += bucketSize) {
  //     const bucket = sortedData.slice(i, i + bucketSize);
  //     if (bucket.length === 0) continue;
  //     const timestamp = new Date(bucket[0][timestampField] as string).getTime();
  //     const sum = bucket.reduce(
  //       (acc, curr) => acc + ((curr[valueField] as number) || 0),
  //       0
  //     );
  //     const value = sum / bucket.length;
  //     sampledData.push([timestamp, value]);
  //   }
  //   const lastOriginalPoint = sortedData[totalPoints - 1];
  //   const lastOriginalTimestamp = new Date(
  //     lastOriginalPoint[timestampField] as string
  //   ).getTime();
  //   if (
  //     sampledData.length === 0 ||
  //     sampledData[sampledData.length - 1][0] < lastOriginalTimestamp
  //   ) {
  //     sampledData.push([
  //       lastOriginalTimestamp,
  //       (lastOriginalPoint[valueField] as number) || 0,
  //     ]);
  //   }
  //   return sampledData;
  // }

  private mapToSeriesData<T extends { timestamp: string;[key: string]: any }>(
    data: T[],
    entityId: string | null,
    idField: keyof T | null,
    valueField: keyof T
  ): [number, number][] {
    let filteredData = data;
    if (entityId && idField) {
      filteredData = data.filter(item => item[idField] === entityId);
    }
    return filteredData.map(item => [
      new Date(item.timestamp).getTime(),
      item[valueField] as number
    ]);
  }

  // getThemeColors remains the same
  private getThemeColors(): any {
    if (!this.theme) {
      return {
        primary: "#3366ff",
        success: "#00d68f",
        info: "#0095ff",
        warning: "#ffaa00",
        danger: "#ff3d71",
        textColor: "#2a2a2a",
        backgroundColor: "#ffffff",
        borderColor: "#e0e0e0",
      };
    }
    const colors = this.theme.variables;
    return {
      primary: colors.colorPrimary || colors.primary || "#3366ff",
      success: colors.colorSuccess || colors.success || "#00d68f",
      info: colors.colorInfo || colors.info || "#0095ff",
      warning: colors.colorWarning || colors.warning || "#ffaa00",
      danger: colors.colorDanger || colors.danger || "#ff3d71",
      textColor: colors.textBasicColor || colors.fgText || "#2a2a2a",
      backgroundColor: colors.cardBackgroundColor || colors.bg || "#ffffff",
      borderColor: colors.borderBasicColor || colors.separator || "#e0e0e0",
    };
  }

  // Initialize all chart options
  private initializeChartOptions(): void {
    const colors = this.getThemeColors();
    const baseConfig: EChartsOption = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
        borderWidth: 1,
        textStyle: { color: colors.textColor, fontSize: 12 },
        axisPointer: {
          type: "cross",
          label: { backgroundColor: colors.primary },
        },
        formatter: (params: any) => {
          if (!params || params.length === 0) return "";
          const time = new Date(params[0].axisValue).toLocaleString();
          let tooltip = `${time}<br/>`;
          // Sort tooltip entries by value, descending
          params.sort(
            (a: any, b: any) => (b.value?.[1] ?? 0) - (a.value?.[1] ?? 0)
          );
          //     params.forEach((param: any) => {
          //       const value =
          //         param.value && typeof param.value[1] === "number"
          //           ? param.value[1].toFixed(2)
          //           : "N/A";
          //       // Check for extremely large values potentially indicating API issues
          //       const displayValue =
          //         Math.abs(param.value?.[1] ?? 0) > 1e9
          //           ? `${value} (potential API scale issue)`
          //           : value;
          //       tooltip += `${param.marker} ${param.seriesName}: ${displayValue}<br/>`;
          //     });
          //     return tooltip;
          //   },
          // },

          params.forEach((param: any) => {
            const value = param.value && typeof param.value[1] === "number"
              ? param.value[1].toFixed(2)
              : "N/A";
            tooltip += `${param.marker} ${param.seriesName}: ${value}<br/>`;
          });
          return tooltip;
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "15%",
        top: "10%",
        containLabel: true,
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textColor, fontSize: 11 },
        splitLine: {
          show: true,
          lineStyle: {
            color: colors.borderColor,
            type: "dashed",
            opacity: 0.3,
          },
        },
      },
      yAxis: {
        type: "value",
        axisLine: { show: true, lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textColor, fontSize: 11 }, // Formatter added per chart type
        splitLine: {
          lineStyle: {
            color: colors.borderColor,
            type: "dashed",
            opacity: 0.3,
          },
        },
        // --- Add scale: true to allow ECharts internal scaling ---
        scale: true,
      },
      legend: {
        data: [],
        type: "scroll",
        orient: "horizontal",
        top: "top",
        textStyle: { color: colors.textColor, fontSize: 11 },
      },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        {
          type: "slider",
          start: 0,
          end: 100,
          bottom: "8%",
          height: 20,
          textStyle: { color: colors.textColor },
          borderColor: colors.borderColor,
        },
      ],
      animation: false,
    };

    // --- CPU Chart ---
    this.cpuChartOption = {
      ...baseConfig,
      color: [colors.primary, colors.success],
      legend: {
        ...baseConfig.legend,
        data: ["User CPU", "System CPU"],
        bottom: "3%",
      },
      yAxis: {
        ...baseConfig.yAxis,
        max: 100,
        axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value}%" },
      },
      series: [
        {
          name: "User CPU",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          data: [],
        },
        {
          name: "System CPU",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          data: [],
        },
      ],
    };

    // --- Memory Chart ---
    this.memoryChartOption = {
      ...baseConfig,
      color: [colors.success],
      legend: { ...baseConfig.legend, data: ["Used Memory"], bottom: "3%" },
      yAxis: {
        ...baseConfig.yAxis,
        axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value} MB" },
      },
      series: [
        {
          name: "Used Memory",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.3 },
          data: [],
        },
      ],
    };

    // --- Disk Charts ---
    this.diskReadRateChartOption = {
      ...baseConfig,
      yAxis: {
        ...baseConfig.yAxis,
        axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value} KB/s" },
      },
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };
    this.diskWriteRateChartOption = {
      ...baseConfig,
      yAxis: {
        ...baseConfig.yAxis,
        axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value} KB/s" },
      },
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };
    this.diskOpsChartOption = {
      ...baseConfig,
      yAxis: {
        ...baseConfig.yAxis,
        axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value} tps" },
      },
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };

    // --- Network Charts (Split) ---
    const networkYAxisPps = {
      ...baseConfig.yAxis,
      axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value} pps" },
    };
    const networkYAxisEps = {
      ...baseConfig.yAxis,
      axisLabel: { ...baseConfig.yAxis.axisLabel, formatter: "{value} eps" },
    };

    this.networkPacketsInChartOption = {
      ...baseConfig,
      yAxis: networkYAxisPps,
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };
    this.networkPacketsOutChartOption = {
      ...baseConfig,
      yAxis: networkYAxisPps,
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };
    this.networkErrorsInChartOption = {
      ...baseConfig,
      yAxis: networkYAxisEps,
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };
    this.networkErrorsOutChartOption = {
      ...baseConfig,
      yAxis: networkYAxisEps,
      legend: { ...baseConfig.legend, data: [] },
      series: [],
    };
  }

  // Update all charts, separating network data into In/Out charts
  private updateAllCharts(): void {
    if (!this.theme) return;

    // Update non-dynamic charts
    this.cpuChartOption = this.getUpdatedCpuChartOption();
    this.memoryChartOption = this.getUpdatedMemoryChartOption();

    // --- Update Disk Charts ---
    const allDisks = [
      ...new Set(this.iostatData.map((p) => p.disk || "default")),
    ];
    const diskReadSeries = this.createDynamicSeries(
      this.iostatData,
      allDisks,
      "disk",
      "kb_read_rate",
      "Read Rate",
      "KB/s"
    );
    const diskWriteSeries = this.createDynamicSeries(
      this.iostatData,
      allDisks,
      "disk",
      "kb_wrtn_rate",
      "Write Rate",
      "KB/s"
    );
    const diskOpsSeries = this.createDynamicSeries(
      this.iostatData,
      allDisks,
      "disk",
      "tps",
      "TPS",
      "tps"
    );

    this.diskReadRateChartOption = {
      ...this.diskReadRateChartOption,
      legend: {
        ...this.diskReadRateChartOption.legend,
        data: diskReadSeries.map((s) => s.name),
      },
      series: diskReadSeries,
    };
    this.diskWriteRateChartOption = {
      ...this.diskWriteRateChartOption,
      legend: {
        ...this.diskWriteRateChartOption.legend,
        data: diskWriteSeries.map((s) => s.name),
      },
      series: diskWriteSeries,
    };
    this.diskOpsChartOption = {
      ...this.diskOpsChartOption,
      legend: {
        ...this.diskOpsChartOption.legend,
        data: diskOpsSeries.map((s) => s.name),
      },
      series: diskOpsSeries,
    };

    // --- Update Network Charts (Separated In/Out) ---
    const allInterfaces = [
      ...new Set(this.netstatData.map((p) => p.interface || "default")),
    ];

    // Create series for each network metric type
    const packetsInSeries = this.createDynamicSeries(
      this.netstatData,
      allInterfaces,
      "interface",
      "ipkts_rate",
      "Packets In",
      "pps"
    );
    const packetsOutSeries = this.createDynamicSeries(
      this.netstatData,
      allInterfaces,
      "interface",
      "opkts_rate",
      "Packets Out",
      "pps"
    );
    const errorsInSeries = this.createDynamicSeries(
      this.netstatData,
      allInterfaces,
      "interface",
      "ierrs_rate",
      "Errors In",
      "eps"
    );
    const errorsOutSeries = this.createDynamicSeries(
      this.netstatData,
      allInterfaces,
      "interface",
      "oerrs_rate",
      "Errors Out",
      "eps"
    );

    // Update the specific chart options
    this.networkPacketsInChartOption = {
      ...this.networkPacketsInChartOption,
      legend: {
        ...this.networkPacketsInChartOption.legend,
        data: packetsInSeries.map((s) => s.name),
      },
      series: packetsInSeries,
    };
    this.networkPacketsOutChartOption = {
      ...this.networkPacketsOutChartOption,
      legend: {
        ...this.networkPacketsOutChartOption.legend,
        data: packetsOutSeries.map((s) => s.name),
      },
      series: packetsOutSeries,
    };
    this.networkErrorsInChartOption = {
      ...this.networkErrorsInChartOption,
      legend: {
        ...this.networkErrorsInChartOption.legend,
        data: errorsInSeries.map((s) => s.name),
      },
      series: errorsInSeries,
    };
    this.networkErrorsOutChartOption = {
      ...this.networkErrorsOutChartOption,
      legend: {
        ...this.networkErrorsOutChartOption.legend,
        data: errorsOutSeries.map((s) => s.name),
      },
      series: errorsOutSeries,
    };

    this.cdr.markForCheck();
  }

  // Helper function to create dynamic series for disk/network charts
  private createDynamicSeries(
    data: HistoricalIostatPoint[] | HistoricalNetstatPoint[],
    entities: string[],
    entityField: keyof HistoricalIostatPoint | keyof HistoricalNetstatPoint,
    valueField: keyof HistoricalIostatPoint | keyof HistoricalNetstatPoint,
    seriesNameSuffix: string,
    unit: string // Unit not directly used here, but good for context
  ): any[] {
    return entities.reduce((acc, entity) => {
      const seriesData = this.mapToSeriesData(
        data as any, // Type assertion needed due to union type
        entity,
        entityField as any,
        // "timestamp",
        valueField as any);
      if (seriesData.length > 0) {
        acc.push({
          name: `${entity} ${seriesNameSuffix}`,
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5 },
          data: seriesData,
          color: this.getRandomColor(`${entity}_${valueField}`),
        });
      }
      return acc;
    }, [] as any[]);
  }

  // getUpdatedCpuChartOption and getUpdatedMemoryChartOption remain the same
  private getUpdatedCpuChartOption(): EChartsOption {
    const cpuUserData = this.mapToSeriesData(
      this.vmstatData,
      null,
      "timestamp",
      "us" as keyof VmstatData
      // this.MAX_DATA_POINTS
    );
    const cpuSysData = this.mapToSeriesData(
      this.vmstatData,
      null,
      // null,
      "timestamp",
      "sy" as keyof VmstatData
      // this.MAX_DATA_POINTS
    );
    return {
      ...this.cpuChartOption,
      series: [
        { ...(this.cpuChartOption.series as any[])[0], data: cpuUserData },
        { ...(this.cpuChartOption.series as any[])[1], data: cpuSysData },
      ],
    };
  }

  private getUpdatedMemoryChartOption(): EChartsOption {
    const memUsedData = this.mapToSeriesData(
      this.vmstatData,
      // null,
      null,
      "timestamp",
      "avm" as keyof VmstatData
      // this.MAX_DATA_POINTS
    ).map((p) => [p[0], Math.round(p[1] / 1024)]); // Convert KB to MB
    return {
      ...this.memoryChartOption,
      series: [
        { ...(this.memoryChartOption.series as any[])[0], data: memUsedData },
      ],
    };
  }

  // getRandomColor remains the same
  private getRandomColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash;
    }
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
      "#ffc93c",
      "#a2d5f2",
      "#ff7f51",
      "#8a4f7d",
      "#4caf50",
      "#ff9800",
      "#2196f3",
      "#e91e63",
    ];
    return colors[Math.abs(hash) % colors.length];
  }

  // Quick Date Range Selection Methods remain the same
  selectLast24Hours(): void {
    this.quickSelectRange(1);
  }
  selectLastWeek(): void {
    this.quickSelectRange(7);
  }
  selectLastMonth(): void {
    this.quickSelectRange(30);
  } // Approx
  selectToday(): void {
    const today = new Date();
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(today),
      startTime: "00:00",
      endDate: this.formatDateForInput(today),
      endTime: "23:59",
    });
    this.loadHistoricalData();
  }
  selectYesterday(): void {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(yesterday),
      startTime: "00:00",
      endDate: this.formatDateForInput(yesterday),
      endTime: "23:59",
    });
    this.loadHistoricalData();
  }

  private quickSelectRange(days: number): void {
    const now = new Date();
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - days);
    const startTime =
      days === 1
        ? now.getHours().toString().padStart(2, "0") +
        ":" +
        now.getMinutes().toString().padStart(2, "0")
        : "00:00";
    const endTime = days === 1 ? startTime : "23:59";

    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(pastDate),
      startTime: startTime,
      endDate: this.formatDateForInput(now),
      endTime: endTime,
    });
    this.loadHistoricalData();
  }
}
