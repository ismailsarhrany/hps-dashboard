import { Component, OnInit, OnDestroy } from "@angular/core";
import { Subscription } from "rxjs";
import { NbThemeService } from "@nebular/theme";
import {
  RealtimeService,
  VmstatData,
  NetstatData,
  IostatData,
  ProcessData,
  RealtimeConnectionStatus,
} from "../../services/realtime.service";

// Interface pour stocker les données précédentes pour le calcul des taux
interface RateCalculationCache {
  [key: string]: {
    // key could be disk name or interface name or 'default'
    timestamp: number;
    value: number;
  };
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

  // Chart data arrays (stockent les données brutes reçues)
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

  // Summary widgets data (utilisent maintenant les taux)
  currentCpuUsage: number = 0;
  currentMemoryUsage: number = 0;
  diskStatus: string = "Normal";
  networkStatus: string = "Active";
  currentDiskReadRate: number = 0;
  currentDiskWriteRate: number = 0;
  currentNetInputRate: number = 0;
  currentNetOutputRate: number = 0;
  currentTotalNetworkRate: number = 0; // Ajout pour le widget
  currentTotalErrorRate: number = 0; // Ajout pour le widget

  // Additional metrics
  systemLoad: number = 0;
  processCount: number = 0;
  lastUpdateTime: Date = new Date();

  // Cache pour le calcul des taux
  private previousNetstatData: RateCalculationCache = {};
  private previousIostatData: RateCalculationCache = {};

  // Configuration pour la fenêtre temporelle
  private readonly timeWindowSeconds: number = 60; // Fenêtre de 60 secondes
  private readonly maxPointsPerSeries: number = 50; // Max points à garder/afficher

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
      .subscribe((data) => this.processVmstatData(data));
    this.netstatSubscription = this.realtimeService
      .getRealtimeNetstat()
      .subscribe((data) => this.processNetstatData(data));
    this.iostatSubscription = this.realtimeService
      .getRealtimeIostat()
      .subscribe((data) => this.processIostatData(data));
    this.processSubscription = this.realtimeService
      .getRealtimeProcess()
      .subscribe((data) => this.processProcessData(data));
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

  private processNetstatData(data: NetstatData) {
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;

    const interfaceKey = data.interface || "default";

    this.currentNetInputRate = this.calculateRate(
      this.previousNetstatData,
      `${interfaceKey}_ipkts`,
      currentTimestamp,
      data.ipkts
    );
    this.currentNetOutputRate = this.calculateRate(
      this.previousNetstatData,
      `${interfaceKey}_opkts`,
      currentTimestamp,
      data.opkts
    );
    const inputErrorRate = this.calculateRate(
      this.previousNetstatData,
      `${interfaceKey}_ierrs`,
      currentTimestamp,
      data.ierrs
    );
    const outputErrorRate = this.calculateRate(
      this.previousNetstatData,
      `${interfaceKey}_oerrs`,
      currentTimestamp,
      data.oerrs
    );

    this.networkPacketsData.push(data);
    this.networkErrorsData.push(data);

    // Mettre à jour les propriétés pour les widgets
    this.currentTotalNetworkRate =
      this.currentNetInputRate + this.currentNetOutputRate;
    this.currentTotalErrorRate = inputErrorRate + outputErrorRate;
    this.networkStatus =
      this.currentTotalErrorRate > 0 ? "Errors Detected" : "Active";

    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private processIostatData(data: IostatData) {
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;

    const diskKey = data.disk;

    this.currentDiskReadRate = this.calculateRate(
      this.previousIostatData,
      `${diskKey}_kb_read`,
      currentTimestamp,
      data.kb_read
    );
    this.currentDiskWriteRate = this.calculateRate(
      this.previousIostatData,
      `${diskKey}_kb_wrtn`,
      currentTimestamp,
      data.kb_wrtn
    );

    this.diskReadData.push(data);
    this.diskWriteData.push(data);

    const totalActivityRate =
      this.currentDiskReadRate + this.currentDiskWriteRate;
    this.diskStatus = totalActivityRate > 5000 ? "High Load" : "Normal";

    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private calculateRate(
    cache: RateCalculationCache,
    key: string,
    currentTimestamp: number,
    currentValue: number
  ): number {
    const previous = cache[key];
    let rate = 0;

    if (previous) {
      const timeDiffSeconds = (currentTimestamp - previous.timestamp) / 1000;
      if (timeDiffSeconds > 0) {
        const valueDiff = currentValue - previous.value;
        if (valueDiff >= 0) {
          rate = valueDiff / timeDiffSeconds;
        } else {
          rate = 0;
          // console.warn(`Counter reset detected for ${key}. Current: ${currentValue}, Previous: ${previous.value}`);
        }
      }
    }
    cache[key] = { timestamp: currentTimestamp, value: currentValue };
    return Math.max(0, rate);
  }

  private trimAndSortDataArrays() {
    const now = new Date().getTime();
    const cutoffTime = now - this.timeWindowSeconds * 1000;

    const filterAndSort = <T extends { timestamp: string }>(arr: T[]): T[] => {
      let filtered = arr.filter((item) => {
        const itemTime = new Date(item.timestamp).getTime();
        return !isNaN(itemTime) && itemTime >= cutoffTime;
      });
      filtered.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      if (filtered.length > this.maxPointsPerSeries) {
        filtered = filtered.slice(filtered.length - this.maxPointsPerSeries);
      }
      return filtered;
    };

    this.cpuData = filterAndSort(this.cpuData);
    this.memoryData = filterAndSort(this.memoryData);
    this.diskReadData = filterAndSort(this.diskReadData);
    this.diskWriteData = filterAndSort(this.diskWriteData);
    this.networkPacketsData = filterAndSort(this.networkPacketsData);
    this.networkErrorsData = filterAndSort(this.networkErrorsData);
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === "dark" ? "#222b45" : "#ffffff",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          label: {
            backgroundColor: "#6a7985",
          },
        },
        formatter: (params: any[]) => {
          let tooltip = `${new Date(
            params[0].axisValue
          ).toLocaleString()}<br/>`;
          params.forEach((param) => {
            const value =
              typeof param.value[1] === "number"
                ? param.value[1].toFixed(2)
                : "N/A";
            tooltip += `${param.marker} ${param.seriesName}: ${value}<br/>`;
          });
          return tooltip;
        },
      },
      legend: {
        data: [],
        textStyle: {
          color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
        },
      },
      grid: {
        left: "3%",
        right: "4%",
        bottom: "3%",
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
      },
    };

    this.cpuChartOption = {
      ...baseOption,
      // title: {
      //   text: "CPU Usage (%)",
      //   textStyle: {
      //     color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
      //   },
      // },
      yAxis: { ...baseOption.yAxis, max: 100 },
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
      // title: {
      //   text: "Memory Usage (GB)",
      //   textStyle: {
      //     color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
      //   },
      // },
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
      // title: {
      //   text: "Disk Read Rate (KB/s)",
      //   textStyle: {
      //     color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
      //   },
      // },
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} KB/s" } },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.diskWriteChartOption = {
      ...baseOption,
      // title: {
      //   text: "Disk Write Rate (KB/s)",
      //   textStyle: {
      //     color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
      //   },
      // },
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} KB/s" } },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.networkPacketsChartOption = {
      ...baseOption,
      // title: {
      //   text: "Network Packet Rate (packets/s)",
      //   textStyle: {
      //     color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
      //   },
      // },
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} pps" } },
      legend: { ...baseOption.legend, data: ["Input Rate", "Output Rate"] },
      series: [
        {
          name: "Input Rate",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#8061ef" },
        },
        {
          name: "Output Rate",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#42aaff" },
        },
      ],
    };
    this.networkErrorsChartOption = {
      ...baseOption,
      // title: {
      //   text: "Network Error Rate (errors/s)",
      //   textStyle: {
      //     color: this.echartTheme === "dark" ? "#ffffff" : "#000000",
      //   },
      // },
      yAxis: { ...baseOption.yAxis, axisLabel: { formatter: "{value} eps" } },
      legend: {
        ...baseOption.legend,
        data: ["Input Error Rate", "Output Error Rate"],
      },
      series: [
        {
          name: "Input Error Rate",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#ff3d71" },
        },
        {
          name: "Output Error Rate",
          type: "line",
          data: [],
          smooth: true,
          itemStyle: { color: "#ff6b6b" },
        },
      ],
    };
  }

  // Fonction pour calculer les données de taux pour un tableau et une clé donnés
  // Correction TS2731: Utilisation de String(valueKey)
  private calculateRateData<T extends { timestamp: string }>(
    dataArray: T[],
    valueKey: keyof T,
    cacheKeyPrefix: string,
    cache: RateCalculationCache
  ): [number, number][] {
    const rateData: [number, number][] = [];
    // Itérer sur les données filtrées et triées
    for (let i = 0; i < dataArray.length; i++) {
      const current = dataArray[i];
      const currentTimestamp = new Date(current.timestamp).getTime();
      // Assurer que la valeur est un nombre
      const currentValue =
        typeof current[valueKey] === "number"
          ? (current[valueKey] as number)
          : 0;
      // Clé de cache unique pour cette métrique spécifique (ex: 'sda_kb_read')
      const cacheKey = `${cacheKeyPrefix}_${String(valueKey)}`; // Correction TS2731

      let rate = 0;
      // Récupérer la valeur précédente du cache
      const previous = cache[cacheKey];

      if (previous) {
        const timeDiffSeconds = (currentTimestamp - previous.timestamp) / 1000;
        if (timeDiffSeconds > 0) {
          const valueDiff = currentValue - previous.value;
          if (valueDiff >= 0) {
            rate = valueDiff / timeDiffSeconds;
          } else {
            // Gérer reset compteur (optionnel: utiliser currentValue / timeDiffSeconds?)
            rate = 0; // Plus simple: ignorer le point ou mettre à 0
          }
        }
      }
      // Mettre à jour le cache pour la prochaine itération *avec la valeur brute*
      cache[cacheKey] = { timestamp: currentTimestamp, value: currentValue };

      // Ajouter le point de taux calculé (ou 0 pour le premier/reset)
      rateData.push([currentTimestamp, Math.max(0, rate)]);
    }
    return rateData;
  }

  private updateCharts() {
    if (!this.echartTheme) return;

    const now = new Date();
    const oneMinuteAgo = new Date(
      now.getTime() - this.timeWindowSeconds * 1000
    );
    const xAxisRange = { min: oneMinuteAgo.getTime(), max: now.getTime() };

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

    // --- Disk Charts (Calcul des taux par disque) ---
    const allDisks = [
      ...new Set(
        [...this.diskReadData, ...this.diskWriteData].map((d) => d.disk)
      ),
    ];
    const diskRateCache: RateCalculationCache = {}; // Utiliser un cache *local* à la fonction update

    const diskReadSeries = allDisks.map((disk) => {
      const diskData = this.diskReadData.filter((d) => d.disk === disk);
      // Passer le cache local à la fonction de calcul
      const rateData = this.calculateRateData(
        diskData,
        "kb_read",
        disk,
        diskRateCache
      );
      return {
        name: disk,
        type: "line",
        data: rateData,
        smooth: true,
        itemStyle: { color: this.getRandomColor(disk + "_read") },
      };
    });

    this.diskReadChartOption = {
      ...this.diskReadChartOption,
      xAxis: { ...this.diskReadChartOption.xAxis, ...xAxisRange },
      legend: { ...this.diskReadChartOption.legend, data: allDisks },
      series: diskReadSeries,
    };

    const diskWriteSeries = allDisks.map((disk) => {
      const diskData = this.diskWriteData.filter((d) => d.disk === disk);
      // Passer le même cache local
      const rateData = this.calculateRateData(
        diskData,
        "kb_wrtn",
        disk,
        diskRateCache
      );
      return {
        name: disk,
        type: "line",
        data: rateData,
        smooth: true,
        itemStyle: { color: this.getRandomColor(disk + "_write") },
      };
    });

    this.diskWriteChartOption = {
      ...this.diskWriteChartOption,
      xAxis: { ...this.diskWriteChartOption.xAxis, ...xAxisRange },
      legend: { ...this.diskWriteChartOption.legend, data: allDisks },
      series: diskWriteSeries,
    };

    // --- Network Charts (Calcul des taux globaux) ---
    const netRateCache: RateCalculationCache = {}; // Cache local
    // Assumer une seule interface 'default' ou agréger si nécessaire
    const netInputRateData = this.calculateRateData(
      this.networkPacketsData,
      "ipkts",
      "default",
      netRateCache
    );
    const netOutputRateData = this.calculateRateData(
      this.networkPacketsData,
      "opkts",
      "default",
      netRateCache
    );
    const netInputErrorRateData = this.calculateRateData(
      this.networkErrorsData,
      "ierrs",
      "default",
      netRateCache
    );
    const netOutputErrorRateData = this.calculateRateData(
      this.networkErrorsData,
      "oerrs",
      "default",
      netRateCache
    );

    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      xAxis: { ...this.networkPacketsChartOption.xAxis, ...xAxisRange },
      series: [
        { ...this.networkPacketsChartOption.series[0], data: netInputRateData },
        {
          ...this.networkPacketsChartOption.series[1],
          data: netOutputRateData,
        },
      ],
    };

    this.networkErrorsChartOption = {
      ...this.networkErrorsChartOption,
      xAxis: { ...this.networkErrorsChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.networkErrorsChartOption.series[0],
          data: netInputErrorRateData,
        },
        {
          ...this.networkErrorsChartOption.series[1],
          data: netOutputErrorRateData,
        },
      ],
    };
  }

  private getRandomColor(seed: string): string {
    const colors = [
      "#3366ff",
      "#00d68f",
      "#ff3d71",
      "#ffaa00",
      "#42aaff",
      "#8061ef",
      "#ff6b6b",
      "#00d9bf",
    ];
    const hash = seed
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
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
