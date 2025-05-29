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
  // CPU/Memory (données brutes)
  cpuData: VmstatData[] = [];
  memoryData: VmstatData[] = [];

  // Disk/Network (stockent les points de taux reçus du backend)
  diskReadRatePoints: RatePoint[] = [];
  diskWriteRatePoints: RatePoint[] = [];
  networkInputRatePoints: RatePoint[] = [];
  networkOutputRatePoints: RatePoint[] = [];
  networkInputErrorRatePoints: RatePoint[] = [];
  networkOutputErrorRatePoints: RatePoint[] = [];
  // --- Fin Données pour les graphiques ---

  // Chart options
  cpuChartOption: any = {};
  memoryChartOption: any = {};
  diskReadChartOption: any = {};
  diskWriteChartOption: any = {};
  networkPacketsChartOption: any = {};
  networkErrorsChartOption: any = {};

  // Summary widgets data (mis à jour avec les taux reçus)
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

    // S'abonner aux différents flux de données du service
    this.vmstatSubscription = this.realtimeService
      .getRealtimeVmstat()
      .subscribe((data) => this.processVmstatData(data as VmstatData)); // Cast si nécessaire

    // Utiliser un observable générique si le service le fournit
    // ou s'abonner aux sujets spécifiques comme avant
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
    // Logique simple, pas de taux ici
    this.processCount++;
  }

  // --- Traitement des données reçues (utilise les taux du backend) ---

  private processVmstatData(data: VmstatData) {
    const timestamp = new Date(data.timestamp);
    if (isNaN(timestamp.getTime())) return;
    // Stocker les données brutes pour CPU/Mem
    this.cpuData.push(data);
    this.memoryData.push(data);
    // Mettre à jour les widgets
    this.currentCpuUsage = Math.round((100 - data.idle) * 100) / 100;
    const totalMemory = data.avm + data.fre;
    this.currentMemoryUsage =
      totalMemory > 0
        ? Math.round((data.avm / totalMemory) * 100 * 100) / 100
        : 0;
    this.systemLoad = data.r;
    // Déclencher la mise à jour
    this.trimAndSortDataArrays();
    this.updateCharts();
    this.lastUpdateTime = new Date();
  }

  private processNetstatData(wsData: WebSocketData) {
    // Extraire les valeurs et les taux du champ 'values'
    const data = wsData.values;
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;
    const interfaceKey = data.interface || "default";

    // Utiliser directement les taux fournis par le backend
    // Utiliser 0 si le champ n'existe pas (sécurité)
    this.currentNetInputRate = data.ipkts_rate ?? 0;
    this.currentNetOutputRate = data.opkts_rate ?? 0;
    const inputErrorRate = data.ierrs_rate ?? 0;
    const outputErrorRate = data.oerrs_rate ?? 0;

    // Ajouter les points de taux aux tableaux dédiés
    this.networkInputRatePoints.push({
      timestamp: currentTimestamp,
      rate: this.currentNetInputRate,
      id: interfaceKey,
    });
    this.networkOutputRatePoints.push({
      timestamp: currentTimestamp,
      rate: this.currentNetOutputRate,
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

    // Mettre à jour les widgets
    this.currentTotalNetworkRate =
      this.currentNetInputRate + this.currentNetOutputRate;
    this.currentTotalErrorRate = inputErrorRate + outputErrorRate;
    this.networkStatus =
      this.currentTotalErrorRate > 0.1 ? "Errors Detected" : "Active";

    // Déclencher la mise à jour
    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  private processIostatData(wsData: WebSocketData) {
    // Extraire les valeurs et les taux du champ 'values'
    const data = wsData.values;
    const currentTimestamp = new Date(data.timestamp).getTime();
    if (isNaN(currentTimestamp)) return;
    const diskKey = data.disk;

    // Utiliser directement les taux fournis par le backend
    this.currentDiskReadRate = data.kb_read_rate ?? 0;
    this.currentDiskWriteRate = data.kb_wrtn_rate ?? 0;

    // Ajouter les points de taux aux tableaux dédiés
    this.diskReadRatePoints.push({
      timestamp: currentTimestamp,
      rate: this.currentDiskReadRate,
      id: diskKey,
    });
    this.diskWriteRatePoints.push({
      timestamp: currentTimestamp,
      rate: this.currentDiskWriteRate,
      id: diskKey,
    });

    // Mettre à jour les widgets
    const totalActivityRate =
      this.currentDiskReadRate + this.currentDiskWriteRate;
    this.diskStatus = totalActivityRate > 10000 ? "High Load" : "Normal";

    // Déclencher la mise à jour
    this.trimAndSortDataArrays();
    this.updateCharts();
  }

  // --- Fin Traitement des données reçues ---

  // PAS DE FONCTION calculateRate ICI
  // PAS DE CACHES previousNetstatValues / previousIostatValues ICI

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
      // Tri déplacé dans createDiskSeriesData pour les disques, mais conservé ici pour les autres
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

    // Appliquer aux tableaux de données brutes ET aux tableaux de taux
    this.cpuData = filterAndSort(this.cpuData);
    this.memoryData = filterAndSort(this.memoryData);
    // Le filtrage temporel est toujours utile ici, mais le tri fin est fait dans updateCharts pour les disques
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
    // ... (Initialisation des options de base reste identique) ...
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

    // Initialiser les options (les séries seront remplies dans updateCharts)
    this.cpuChartOption = {
      ...baseOption,
      /* title, */ yAxis: { ...baseOption.yAxis, max: 100 },
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
      /* title, */ legend: {
        ...baseOption.legend,
        data: ["Used Memory", "Free Memory"],
      },
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
      /* title: { text: "Disk Read Rate (KB/s)"}, */ yAxis: {
        ...baseOption.yAxis,
        axisLabel: { formatter: "{value} KB/s" },
      },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.diskWriteChartOption = {
      ...baseOption,
      /* title: { text: "Disk Write Rate (KB/s)"}, */ yAxis: {
        ...baseOption.yAxis,
        axisLabel: { formatter: "{value} KB/s" },
      },
      legend: { ...baseOption.legend, data: [] },
      series: [],
    };
    this.networkPacketsChartOption = {
      ...baseOption,
      /* title: { text: "Network Packet Rate (packets/s)"}, */ yAxis: {
        ...baseOption.yAxis,
        axisLabel: { formatter: "{value} pps" },
      },
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
      /* title: { text: "Network Error Rate (errors/s)"}, */ yAxis: {
        ...baseOption.yAxis,
        axisLabel: { formatter: "{value} eps" },
      },
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

  // --- MISE A JOUR DES GRAPHIQUES (utilise les taux pré-calculés) ---
  private updateCharts() {
    if (!this.echartTheme) return;

    const now = new Date();
    const oneMinuteAgo = new Date(
      now.getTime() - this.timeWindowSeconds * 1000
    );
    const xAxisRange = { min: oneMinuteAgo.getTime(), max: now.getTime() };

    // --- CPU Chart (utilise les données brutes) ---
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

    // --- Memory Chart (utilise les données brutes) ---
    this.memoryChartOption = {
      ...this.memoryChartOption,
      xAxis: { ...this.memoryChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.memoryChartOption.series[0],
          data: this.memoryData.map((item) => [
            new Date(item.timestamp).getTime(),
            Math.round((item.avm / 1024 / 1024) * 100) / 100, // Convertir en Mo
          ]),
        },
        {
          ...this.memoryChartOption.series[1],
          data: this.memoryData.map((item) => [
            new Date(item.timestamp).getTime(),
            Math.round((item.fre / 1024 / 1024) * 100) / 100, // Convertir en Mo
          ]),
        },
      ],
    };

    // --- Disk Charts (utilise les points de taux reçus) ---
    const allDisks = [
      ...new Set(
        [...this.diskReadRatePoints, ...this.diskWriteRatePoints].map(
          (p) => p.id
        )
      ),
    ];

    // Helper function to create series data with padding
    const createDiskSeriesData = (
      points: RatePoint[],
      diskId: string,
      startTime: number,
      endTime: number
    ): [number, number][] => {
      // Filter points for the specific disk AND ensure they are within the time window
      // Note: trimAndSortDataArrays already filters, but double-checking here is safe
      const currentDiskPoints = points
        .filter(
          (p) =>
            p.id === diskId &&
            p.timestamp >= startTime &&
            p.timestamp <= endTime
        )
        .sort((a, b) => a.timestamp - b.timestamp); // Ensure sorted by time

      let echartsData: [number, number][] = [];
      const startPoint: [number, number] = [startTime, 0];
      const endPoint: [number, number] = [endTime, 0];

      if (currentDiskPoints.length > 0) {
        const firstPointTime = currentDiskPoints[0].timestamp;
        const lastPointTime =
          currentDiskPoints[currentDiskPoints.length - 1].timestamp;

        // Add start point if the first actual point is after the window start
        if (firstPointTime > startTime) {
          echartsData.push(startPoint);
        }

        // Add actual points
        echartsData.push(
          ...currentDiskPoints.map((p): [number, number] => [
            p.timestamp,
            p.rate,
          ])
        );

        // Add end point if the last actual point is before the window end
        if (lastPointTime < endTime) {
          echartsData.push(endPoint);
        }
      } else {
        // No data for this disk in the window, draw flat line at 0 across the whole window
        echartsData.push(startPoint);
        echartsData.push(endPoint);
      }
      return echartsData;
    };

    const diskReadSeries = allDisks.map((disk) => ({
      name: disk,
      type: "line",
      data: createDiskSeriesData(
        this.diskReadRatePoints,
        disk,
        oneMinuteAgo.getTime(),
        now.getTime()
      ),
      smooth: true,
      itemStyle: { color: this.getRandomColor(disk + "_read") },
    }));

    this.diskReadChartOption = {
      ...this.diskReadChartOption,
      xAxis: { ...this.diskReadChartOption.xAxis, ...xAxisRange },
      legend: { ...this.diskReadChartOption.legend, data: allDisks },
      series: diskReadSeries,
    };

    const diskWriteSeries = allDisks.map((disk) => ({
      name: disk,
      type: "line",
      data: createDiskSeriesData(
        this.diskWriteRatePoints,
        disk,
        oneMinuteAgo.getTime(),
        now.getTime()
      ),
      smooth: true,
      itemStyle: { color: this.getRandomColor(disk + "_write") },
    }));

    this.diskWriteChartOption = {
      ...this.diskWriteChartOption,
      xAxis: { ...this.diskWriteChartOption.xAxis, ...xAxisRange },
      legend: { ...this.diskWriteChartOption.legend, data: allDisks },
      series: diskWriteSeries,
    };

    // --- Network Charts (utilise les points de taux reçus) ---
    // Pas besoin de padding ici car les données réseau sont généralement continues
    this.networkPacketsChartOption = {
      ...this.networkPacketsChartOption,
      xAxis: { ...this.networkPacketsChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.networkPacketsChartOption.series[0],
          data: this.networkInputRatePoints.map((p) => [p.timestamp, p.rate]),
        },
        {
          ...this.networkPacketsChartOption.series[1],
          data: this.networkOutputRatePoints.map((p) => [p.timestamp, p.rate]),
        },
      ],
    };

    this.networkErrorsChartOption = {
      ...this.networkErrorsChartOption,
      xAxis: { ...this.networkErrorsChartOption.xAxis, ...xAxisRange },
      series: [
        {
          ...this.networkErrorsChartOption.series[0],
          data: this.networkInputErrorRatePoints.map((p) => [
            p.timestamp,
            p.rate,
          ]),
        },
        {
          ...this.networkErrorsChartOption.series[1],
          data: this.networkOutputErrorRatePoints.map((p) => [
            p.timestamp,
            p.rate,
          ]),
        },
      ],
    };
  }
  // --- Fin MISE A JOUR DES GRAPHIQUES ---

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

  // --- Getters pour les couleurs des status (inchangés) ---
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
