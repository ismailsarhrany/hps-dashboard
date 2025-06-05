// src/app/pages/anomaly/anomaly.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { Subscription, forkJoin } from "rxjs";
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
    private cdr: ChangeDetectorRef
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

    this.loadDefaultData();
  }

  ngOnDestroy(): void {
    this.themeSubscription?.unsubscribe();
    this.dataSubscription?.unsubscribe();
  }

  // ... (All existing methods from historic.component.ts remain the same)

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
    this.loading = true;
    this.cdr.markForCheck();
    const range = dateRange || this.getDateTimeRange();

    this.vmstatData = [];
    this.netstatData = [];
    this.iostatData = [];
    this.updateAllCharts(); // Clear charts

    this.dataSubscription?.unsubscribe();

    this.dataSubscription = forkJoin({
      vmstat: this.apiService.getHistoricalVmstat(range),
      netstat: this.networkDataService.getHistoricalNetworkData(range),
      iostat: this.diskDataService.getHistoricalDiskData(range),
    }).subscribe({
      next: ({ vmstat, netstat, iostat }) => {
        this.vmstatData = vmstat?.data || [];
        this.netstatData = netstat;
        this.iostatData = iostat;
        console.log(
          `HistoricComponent: Received Data - vmstat=${this.vmstatData.length}, netstat=${this.netstatData.length}, iostat=${this.iostatData.length}`
        );
        this.updateAllCharts();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error(
          "HistoricComponent: Error loading combined historical data:",
          error
        );
        this.vmstatData = [];
        this.netstatData = [];
        this.iostatData = [];
        this.updateAllCharts();
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

  // downsamplePerEntity remains the same
  private downsamplePerEntity<
    T extends
      | { timestamp: string; id?: string }
      | VmstatData
      | HistoricalIostatPoint
      | HistoricalNetstatPoint
  >(
    data: T[],
    entityId: string | null,
    idField: keyof T | null,
    timestampField: keyof T,
    valueField: keyof T,
    maxPoints: number
  ): [number, number][] {
    const entityData =
      entityId && idField
        ? data.filter((item) => (item as any)[idField] === entityId)
        : data;
    const sortedData = entityData.sort(
      (a, b) =>
        new Date(a[timestampField] as string).getTime() -
        new Date(b[timestampField] as string).getTime()
    );
    const totalPoints = sortedData.length;
    if (!sortedData || totalPoints === 0) return [];
    if (totalPoints <= maxPoints) {
      return sortedData.map((item) => [
        new Date(item[timestampField] as string).getTime(),
        (item[valueField] as number) || 0,
      ]);
    }
    const sampledData: [number, number][] = [];
    const bucketSize = Math.ceil(totalPoints / maxPoints);
    for (let i = 0; i < totalPoints; i += bucketSize) {
      const bucket = sortedData.slice(i, i + bucketSize);
      if (bucket.length === 0) continue;
      const timestamp = new Date(bucket[0][timestampField] as string).getTime();
      const sum = bucket.reduce(
        (acc, curr) => acc + ((curr[valueField] as number) || 0),
        0
      );
      const value = sum / bucket.length;
      sampledData.push([timestamp, value]);
    }
    const lastOriginalPoint = sortedData[totalPoints - 1];
    const lastOriginalTimestamp = new Date(
      lastOriginalPoint[timestampField] as string
    ).getTime();
    if (
      sampledData.length === 0 ||
      sampledData[sampledData.length - 1][0] < lastOriginalTimestamp
    ) {
      sampledData.push([
        lastOriginalTimestamp,
        (lastOriginalPoint[valueField] as number) || 0,
      ]);
    }
    return sampledData;
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

  // NEW: Detect anomalies in a time series
  private detectAnomalies(
    data: [number, number][],
    sensitivity: number = 3
  ): [number, number][] {
    if (data.length < 10) return [];

    // Calculate moving average and standard deviation
    const windowSize = Math.min(10, Math.floor(data.length / 5));
    const movingStats: { avg: number; std: number }[] = [];

    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = i + 1;
      const windowData = data.slice(start, end).map((d) => d[1]);

      const sum = windowData.reduce((a, b) => a + b, 0);
      const avg = sum / windowData.length;

      const squareDiffs = windowData.map((v) => Math.pow(v - avg, 2));
      const std = Math.sqrt(
        squareDiffs.reduce((a, b) => a + b, 0) / windowData.length
      );

      movingStats.push({ avg, std });
    }

    // Detect points that are significantly different from moving average
    return data.filter((point, i) => {
      if (i < windowSize) return false; // Skip beginning where stats are less reliable
      const value = point[1];
      const { avg, std } = movingStats[i];
      return Math.abs(value - avg) > sensitivity * std;
    });
  }

    // Initialize all chart options, including the split network ones
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
          params.forEach((param: any) => {
            const value =
              param.value && typeof param.value[1] === "number"
                ? param.value[1].toFixed(2)
                : "N/A";
            // Check for extremely large values potentially indicating API issues
            const displayValue =
              Math.abs(param.value?.[1] ?? 0) > 1e9
                ? `${value} (potential API scale issue)`
                : value;
            tooltip += `${param.marker} ${param.seriesName}: ${displayValue}<br/>`;
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

  // NEW: Add anomaly points to charts
  private addAnomalySeries(
    baseOption: EChartsOption,
    anomalyPoints: [number, number][],
    seriesName: string
  ): EChartsOption {
    if (!anomalyPoints.length) return baseOption;

    const scatterSeries = {
      name: `${seriesName} Anomalies`,
      type: "scatter",
      symbolSize: 10,
      itemStyle: {
        color: "#ff0000",
      },
      data: anomalyPoints,
      zlevel: 10,
    };

    return {
      ...baseOption,
      series: [...((baseOption.series as any[]) || []), scatterSeries],
    };
  }

  // MODIFIED: Update CPU chart with anomalies
  private getUpdatedCpuChartOption(): EChartsOption {
    const cpuUserData = this.downsamplePerEntity(
      this.vmstatData,
      null,
      null,
      "timestamp",
      "us",
      this.MAX_DATA_POINTS
    );
    const cpuSysData = this.downsamplePerEntity(
      this.vmstatData,
      null,
      null,
      "timestamp",
      "sy",
      this.MAX_DATA_POINTS
    );

    // Detect anomalies
    this.cpuAnomalies.user = this.detectAnomalies(cpuUserData);
    this.cpuAnomalies.system = this.detectAnomalies(cpuSysData);

    let chartOption: EChartsOption = {
      ...this.cpuChartOption,
      series: [
        { ...(this.cpuChartOption.series as any[])[0], data: cpuUserData },
        { ...(this.cpuChartOption.series as any[])[1], data: cpuSysData },
      ],
    };

    // Add anomaly series if enabled
    if (this.showAnomalies) {
      chartOption = this.addAnomalySeries(
        chartOption,
        this.cpuAnomalies.user,
        "User CPU"
      );
      chartOption = this.addAnomalySeries(
        chartOption,
        this.cpuAnomalies.system,
        "System CPU"
      );
    }

    return chartOption;
  }

  // MODIFIED: Update Memory chart with anomalies
  private getUpdatedMemoryChartOption(): EChartsOption {
    const memUsedData = this.downsamplePerEntity(
      this.vmstatData,
      null,
      null,
      "timestamp",
      "avm",
      this.MAX_DATA_POINTS
  ).map((p): [number, number] => [p[0], Math.round(p[1] / 1024)]); // Convert KB to MB

    // Detect anomalies
    this.memoryAnomalies = this.detectAnomalies(memUsedData);

    let chartOption: EChartsOption = {
      ...this.memoryChartOption,
      series: [
        { ...(this.memoryChartOption.series as any[])[0], data: memUsedData },
      ],
    };

    // Add anomaly series if enabled
    if (this.showAnomalies) {
      chartOption = this.addAnomalySeries(
        chartOption,
        this.memoryAnomalies,
        "Memory Usage"
      );
    }

    return chartOption;
  }

  // MODIFIED: Update all charts to include anomalies
  private updateAllCharts(): void {
    if (!this.theme) return;

    // Update non-dynamic charts
    this.cpuChartOption = this.getUpdatedCpuChartOption();
    this.memoryChartOption = this.getUpdatedMemoryChartOption();

    // --- Update Disk Charts ---
    const allDisks = [
      ...new Set(this.iostatData.map((p) => p.disk || "default")),
    ];

    // Clear previous disk anomalies
    this.diskAnomalies = { readRate: {}, writeRate: {}, ops: {} };

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

    // Add anomalies to disk series if enabled
    let finalDiskReadSeries = [...diskReadSeries];
    let finalDiskWriteSeries = [...diskWriteSeries];
    let finalDiskOpsSeries = [...diskOpsSeries];

    if (this.showAnomalies) {
      // Process read rates
      diskReadSeries.forEach((series) => {
        const diskName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.diskAnomalies.readRate[diskName] =
          this.detectAnomalies(dataPoints);

        if (this.diskAnomalies.readRate[diskName].length) {
          finalDiskReadSeries.push({
            name: `${diskName} Read Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.diskAnomalies.readRate[diskName],
            zlevel: 10,
          });
        }
      });

      // Process write rates
      diskWriteSeries.forEach((series) => {
        const diskName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.diskAnomalies.writeRate[diskName] =
          this.detectAnomalies(dataPoints);

        if (this.diskAnomalies.writeRate[diskName].length) {
          finalDiskWriteSeries.push({
            name: `${diskName} Write Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.diskAnomalies.writeRate[diskName],
            zlevel: 10,
          });
        }
      });

      // Process operations
      diskOpsSeries.forEach((series) => {
        const diskName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.diskAnomalies.ops[diskName] = this.detectAnomalies(dataPoints);

        if (this.diskAnomalies.ops[diskName].length) {
          finalDiskOpsSeries.push({
            name: `${diskName} Ops Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.diskAnomalies.ops[diskName],
            zlevel: 10,
          });
        }
      });
    }

    this.diskReadRateChartOption = {
      ...this.diskReadRateChartOption,
      legend: {
        ...this.diskReadRateChartOption.legend,
        data: finalDiskReadSeries.map((s) => s.name),
      },
      series: finalDiskReadSeries,
    };

    this.diskWriteRateChartOption = {
      ...this.diskWriteRateChartOption,
      legend: {
        ...this.diskWriteRateChartOption.legend,
        data: finalDiskWriteSeries.map((s) => s.name),
      },
      series: finalDiskWriteSeries,
    };

    this.diskOpsChartOption = {
      ...this.diskOpsChartOption,
      legend: {
        ...this.diskOpsChartOption.legend,
        data: finalDiskOpsSeries.map((s) => s.name),
      },
      series: finalDiskOpsSeries,
    };

    // --- Update Network Charts ---
    const allInterfaces = [
      ...new Set(this.netstatData.map((p) => p.interface || "default")),
    ];

    // Clear previous network anomalies
    this.networkAnomalies = {
      packetsIn: {},
      packetsOut: {},
      errorsIn: {},
      errorsOut: {},
    };

    // Create base series
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

    // Add anomalies to network series if enabled
    let finalPacketsInSeries = [...packetsInSeries];
    let finalPacketsOutSeries = [...packetsOutSeries];
    let finalErrorsInSeries = [...errorsInSeries];
    let finalErrorsOutSeries = [...errorsOutSeries];

    if (this.showAnomalies) {
      // Process packets in
      packetsInSeries.forEach((series) => {
        const ifaceName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.networkAnomalies.packetsIn[ifaceName] =
          this.detectAnomalies(dataPoints);

        if (this.networkAnomalies.packetsIn[ifaceName].length) {
          finalPacketsInSeries.push({
            name: `${ifaceName} Packets In Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.networkAnomalies.packetsIn[ifaceName],
            zlevel: 10,
          });
        }
      });

      // Process packets out
      packetsOutSeries.forEach((series) => {
        const ifaceName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.networkAnomalies.packetsOut[ifaceName] =
          this.detectAnomalies(dataPoints);

        if (this.networkAnomalies.packetsOut[ifaceName].length) {
          finalPacketsOutSeries.push({
            name: `${ifaceName} Packets Out Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.networkAnomalies.packetsOut[ifaceName],
            zlevel: 10,
          });
        }
      });

      // Process errors in
      errorsInSeries.forEach((series) => {
        const ifaceName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.networkAnomalies.errorsIn[ifaceName] =
          this.detectAnomalies(dataPoints);

        if (this.networkAnomalies.errorsIn[ifaceName].length) {
          finalErrorsInSeries.push({
            name: `${ifaceName} Errors In Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.networkAnomalies.errorsIn[ifaceName],
            zlevel: 10,
          });
        }
      });

      // Process errors out
      errorsOutSeries.forEach((series) => {
        const ifaceName = series.name.split(" ")[0];
        const dataPoints = series.data as [number, number][];
        this.networkAnomalies.errorsOut[ifaceName] =
          this.detectAnomalies(dataPoints);

        if (this.networkAnomalies.errorsOut[ifaceName].length) {
          finalErrorsOutSeries.push({
            name: `${ifaceName} Errors Out Anomalies`,
            type: "scatter",
            symbolSize: 10,
            itemStyle: { color: "#ff0000" },
            data: this.networkAnomalies.errorsOut[ifaceName],
            zlevel: 10,
          });
        }
      });
    }

    // Update chart options with final series
    this.networkPacketsInChartOption = {
      ...this.networkPacketsInChartOption,
      legend: {
        ...this.networkPacketsInChartOption.legend,
        data: finalPacketsInSeries.map((s) => s.name),
      },
      series: finalPacketsInSeries,
    };

    this.networkPacketsOutChartOption = {
      ...this.networkPacketsOutChartOption,
      legend: {
        ...this.networkPacketsOutChartOption.legend,
        data: finalPacketsOutSeries.map((s) => s.name),
      },
      series: finalPacketsOutSeries,
    };

    this.networkErrorsInChartOption = {
      ...this.networkErrorsInChartOption,
      legend: {
        ...this.networkErrorsInChartOption.legend,
        data: finalErrorsInSeries.map((s) => s.name),
      },
      series: finalErrorsInSeries,
    };

    this.networkErrorsOutChartOption = {
      ...this.networkErrorsOutChartOption,
      legend: {
        ...this.networkErrorsOutChartOption.legend,
        data: finalErrorsOutSeries.map((s) => s.name),
      },
      series: finalErrorsOutSeries,
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
      const seriesData = this.downsamplePerEntity(
        data as any, // Type assertion needed due to union type
        entity,
        entityField as any,
        "timestamp",
        valueField as any,
        this.MAX_DATA_POINTS
      );
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
