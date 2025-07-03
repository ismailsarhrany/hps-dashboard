// src/app/pages/process/process.component.ts
import { Component, OnInit, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { Subscription, of } from "rxjs";
import { NbThemeService } from "@nebular/theme";
import { catchError, map, tap } from "rxjs/operators";
import {
  ApiService,
  AggregatedProcessData,
  ProcessData,
  DateTimeRange,
} from "../../services/monitoring.service";
import {
  RealtimeService,
  RealtimeConnectionStatus,
} from "../../services/realtime.service";

interface ProcessStatistics {
  command: string;
  user: string;
  pid: number;
  totalCpu: number;
  totalMem: number;
  maxCpu: number;
  maxMem: number;
  count: number;
  avgCpu: number;
  avgMem: number;
  significance: number;
}

@Component({
  selector: "ngx-process",
  templateUrl: "./process.component.html",
  styleUrls: ["./process.component.scss"],
})
export class ProcessComponent implements OnInit, OnDestroy {
  private themeSubscription: Subscription;
  private dataSubscriptions: Subscription[] = [];
  private colors: any;
  private echartTheme: any;

  private getThemeColors(): any {
    if (!this.colors) {
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

    return {
      primary: this.colors.primary || "#3366ff",
      success: this.colors.success || "#00d68f",
      info: this.colors.info || "#0095ff",
      warning: this.colors.warning || "#ffaa00",
      danger: this.colors.danger || "#ff3d71",
      textColor: this.colors.fgText || "#2a2a2a",
      backgroundColor: this.colors.bg || "#ffffff",
      borderColor: this.colors.separator || "#e0e0e0",
    };
  }
  
  connectionStatus: RealtimeConnectionStatus = RealtimeConnectionStatus.DISCONNECTED;
  lastUpdateTime = new Date();

  activeProcesses: ProcessData[] = [];
  processes: ProcessData[] = [];
  historicalProcesses: AggregatedProcessData[] = [];
  processSummary: any[] = [];
  selectedProcesses: ProcessData[] = [];

  topCpuChartOption: any = {};
  topMemChartOption: any = {};
  processCpuHeatmapOption: any = {};
  processMemHeatmapOption: any = {};

  filterForm: FormGroup;
  loading = false;
  processListLoading = false;
  errorMessage = '';
  hasError = false;

  constructor(
    private theme: NbThemeService,
    private monitoringService: ApiService,
    private realtimeService: RealtimeService,
    private fb: FormBuilder
  ) {
    this.initializeForm();
  }

  ngOnInit() {
    this.themeSubscription = this.theme.getJsTheme().subscribe((config) => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
    });

    this.startRealtimeMonitoring();
    this.loadProcessList();
  }

  ngOnDestroy() {
    this.themeSubscription?.unsubscribe();
    this.dataSubscriptions.forEach((sub) => sub.unsubscribe());
    this.dataSubscriptions = [];
    this.stopRealtimeMonitoring();
  }

  private initializeForm(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    this.filterForm = this.fb.group({
      startDate: [this.formatDateForInput(yesterday), [Validators.required]],
      startTime: ['00:00', [Validators.required]],
      endDate: [this.formatDateForInput(now), [Validators.required]],
      endTime: ['23:59', [Validators.required]],
    });

    this.filterForm.valueChanges.subscribe(() => {
      this.hasError = false;
      this.errorMessage = '';
    });
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === "transparent" ? this.colors.bg2 : this.colors.white,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
      legend: {
        textStyle: {
          color: this.colors.fgText,
        },
        formatter: (name) => {
          return name.length > 20 ? name.substring(0, 17) + '...' : name;
        }
      },
    };

    this.topCpuChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: "{b}: {c}%",
      },
      xAxis: {
        type: "category",
        data: [],
        axisLabel: {
          color: this.colors.fgText,
          rotate: 45,
          interval: 0,
          formatter: (value) => {
            return value.length > 15 ? value.substring(0, 12) + '...' : value;
          }
        },
      },
      yAxis: {
        type: "value",
        name: "CPU %",
        nameTextStyle: { color: this.colors.fgText },
        axisLabel: { color: this.colors.fgText },
        splitLine: { lineStyle: { color: this.colors.separator } },
      },
      series: [{
        name: "CPU Usage",
        type: "bar",
        data: [],
        itemStyle: { color: this.colors.danger },
      }],
    };

    this.topMemChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: "{b}: {c}%",
      },
      xAxis: {
        type: "category",
        data: [],
        axisLabel: {
          color: this.colors.fgText,
          rotate: 45,
          interval: 0,
          formatter: (value) => {
            return value.length > 15 ? value.substring(0, 12) + '...' : value;
          }
        },
      },
      yAxis: {
        type: "value",
        name: "Memory %",
        nameTextStyle: { color: this.colors.fgText },
        axisLabel: { color: this.colors.fgText },
        splitLine: { lineStyle: { color: this.colors.separator } },
      },
      series: [{
        name: "Memory Usage",
        type: "bar",
        data: [],
        itemStyle: { color: this.colors.success },
      }],
    };

    this.initializeHeatmapOptions();
  }




  private initializeHeatmapOptions() {

    const colors = this.getThemeColors(); // Use the method from historic or create similar

    const tooltipFormatter = (params: any) => {
      const date = new Date(params.data[0]);
      const value = params.data[2];
      const metric = params.seriesName.includes('CPU') ? 'CPU' : 'Memory';

      // Status color logic
      let valueColor;
      if (value > 75) {
        valueColor = colors.danger;
      } else if (value > 50) {
        valueColor = colors.warning;
      } else {
        valueColor = colors.success;
      }

      return `
    <div style="
      background: ${colors.backgroundColor};
      border: 1px solid ${colors.borderColor};
      border-radius: 4px;
      padding: 10px;
      box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
    ">
      <strong style="
        display: block; 
        margin-bottom: 5px; 
        color: ${colors.textColor};
        font-size: 14px;
      ">
        ${date.toLocaleString()}
      </strong>
      <table>
        <tr>
          <td style="padding: 2px 5px; color: ${colors.textColor};">Process:</td>
          <td style="padding: 2px 5px; color: ${colors.textColor};">${params.data[1]}</td>
        </tr>
        <tr>
          <td style="padding: 2px 5px; color: ${colors.textColor};">${metric}:</td>
          <td style="padding: 2px 5px; color: ${valueColor}; font-weight: bold;">
            ${value.toFixed(1)}%
          </td>
        </tr>
      </table>
    </div>
  `;
    };
    const baseHeatmapOption = {
      backgroundColor: this.echartTheme === "transparent" ? this.colors.bg2 : this.colors.white,
      tooltip: {
        position: 'top',
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
        borderWidth: 1,
        textStyle: {
          color: colors.textColor,
          fontSize: 12
        },
        formatter: tooltipFormatter
      },
      grid: {
        left: '15%',
        right: '10%',
        top: '10%',
        bottom: '15%'
      },
      xAxis: {
        type: 'time',
        axisLabel: {
          color: this.colors.fgText,
          fontSize: 10,
          formatter: (value) => {
            const date = new Date(value);
            const now = new Date();
            const isToday = date.toDateString() === now.toDateString();
            if (isToday) {
              return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            } else {
              return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
            }
          }
        },
        axisTick: { alignWithLabel: true },
        splitLine: {
          show: true,
          lineStyle: { color: this.colors.separator, opacity: 0.3 }
        }
      },
      yAxis: {
        type: 'category',
        data: [],
        axisLabel: {
          color: this.colors.fgText,
          fontSize: 10,
          interval: 0,
          formatter: (value) => {
            return value.length > 20 ? value.substring(0, 17) + '...' : value;
          }
        },
        axisTick: { alignWithLabel: true },
        splitLine: {
          show: true,
          lineStyle: { color: this.colors.separator, opacity: 0.3 }
        }
      }
    };

    this.processCpuHeatmapOption = {
      ...baseHeatmapOption,
      visualMap: {
        min: 0,
        max: 100,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: '5%',
        textStyle: { color: this.colors.fgText },
        inRange: {
          color: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b']
        }
      },
      series: [{
        name: 'CPU Usage',
        type: 'heatmap',
        data: [],
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
      }]
    };

    this.processMemHeatmapOption = {
      ...baseHeatmapOption,
      visualMap: {
        min: 0,
        max: 100,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: '5%',
        textStyle: { color: this.colors.fgText },
        inRange: {
          color: ['#fff7fb', '#ece7f2', '#d0d1e6', '#a6bddb', '#74a9cf', '#3690c0', '#0570b0', '#045a8d', '#023858']
        }
      },
      series: [{
        name: 'Memory Usage',
        type: 'heatmap',
        data: [],
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
      }]
    };


  }

  startRealtimeMonitoring() {
    this.realtimeService.connectToMetrics(["process"]);

    this.dataSubscriptions.push(
      this.realtimeService.getConnectionStatus("process").subscribe((status) => {
        this.connectionStatus = status;
      })
    );

    this.dataSubscriptions.push(
      this.realtimeService.getRealtimeProcess().subscribe((processData) => {
        if (processData) {
          this.lastUpdateTime = new Date();
          this.updateActiveProcesses(processData);
          this.updateTopProcessCharts();
        }
      })
    );
  }

  stopRealtimeMonitoring() {
    this.realtimeService.disconnectAll();
    this.dataSubscriptions.forEach((sub) => sub.unsubscribe());
    this.dataSubscriptions = [];
  }

  updateActiveProcesses(processes: ProcessData | ProcessData[]) {
    if (Array.isArray(processes)) {
      this.activeProcesses = processes
        .filter(p => p && p.pid && p.command && p.command.trim() !== "")
        .sort((a, b) => b.cpu - a.cpu);
    } else {
      const process = processes;
      if (process && process.pid && process.command) {
        const index = this.activeProcesses.findIndex(p => p.pid === process.pid);
        if (index !== -1) {
          this.activeProcesses[index] = process;
        } else {
          this.activeProcesses.push(process);
        }
        this.activeProcesses.sort((a, b) => b.cpu - a.cpu);
      }
    }

    if (this.processes.length === 0 && this.activeProcesses.length > 0) {
      this.processes = [...this.activeProcesses].sort((a, b) => a.pid - b.pid);
    }
  }

  private loadProcessList() {
    this.processListLoading = true;

    if (this.activeProcesses.length > 0) {
      this.processes = [...this.activeProcesses]
        .filter(p => p.pid && p.command && p.command.trim() !== '')
        .sort((a, b) => a.pid - b.pid);
      this.processListLoading = false;
      return;
    }

    const recentRange = this.monitoringService.getDateRange(0.1);

    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalProcesses(recentRange)
        .pipe(
          map(response => response.data || []),
          map(processes => {
            const uniqueProcesses = new Map<number, ProcessData>();
            processes.forEach(p => {
              if (p.pid && p.command && p.command.trim() !== '') {
                const processData: ProcessData = {
                  pid: p.pid,
                  command: p.command,
                  user: p.user,
                  cpu: 0,
                  mem: 0,
                  timestamp: p.timestamp
                };
                const existing = uniqueProcesses.get(p.pid);
                if (!existing || new Date(p.timestamp) > new Date(existing.timestamp)) {
                  uniqueProcesses.set(p.pid, processData);
                }
              }
            });
            return Array.from(uniqueProcesses.values()).sort((a, b) => a.pid - b.pid);
          }),
          catchError(error => {
            console.error('Error loading process list:', error);
            this.showError('Failed to load process list');
            return of([]);
          })
        )
        .subscribe(processes => {
          this.processes = processes;
          this.processListLoading = false;
        })
    );
  }

  updateTopProcessCharts() {
    if (this.activeProcesses.length === 0) return;

    const topCpuProcesses = [...this.activeProcesses]
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5);

    const topMemProcesses = [...this.activeProcesses]
      .sort((a, b) => b.mem - a.mem)
      .slice(0, 5);

    this.topCpuChartOption = {
      ...this.topCpuChartOption,
      xAxis: {
        ...this.topCpuChartOption.xAxis,
        data: topCpuProcesses.map(p => this.truncateCommand(p.command, 15)),
      },
      series: [{
        ...this.topCpuChartOption.series[0],
        data: topCpuProcesses.map(p => p.cpu),
      }],
    };

    this.topMemChartOption = {
      ...this.topMemChartOption,
      xAxis: {
        ...this.topMemChartOption.xAxis,
        data: topMemProcesses.map(p => this.truncateCommand(p.command, 15)),
      },
      series: [{
        ...this.topMemChartOption.series[0],
        data: topMemProcesses.map(p => p.mem),
      }],
    };
  }

  public truncateCommand(command: string, maxLength: number): string {
    const base = command.split('/').pop() || command;
    return base.length > maxLength ? base.slice(0, maxLength - 3) + '...' : base;
  }

  updateProcessCharts() {
    if (!this.historicalProcesses || this.historicalProcesses.length === 0) return;

    const stats = this.calculateProcessStatistics();
    const topProcesses = this.selectSignificantProcesses(stats, 20);
    const grouped = this.groupDataByTimeIntervals(topProcesses, 5);
    const { cpuHeatmapData, memHeatmapData, processNames, timeLabels } = this.buildHeatmapData(grouped);
    this.updateHeatmapChartOptions(cpuHeatmapData, memHeatmapData, processNames, timeLabels);
  }

  private calculateProcessStatistics(): Map<string, ProcessStatistics> {
    const statsMap = new Map<string, ProcessStatistics>();

    this.historicalProcesses.forEach(p => {
      const key = `${p.command}|${p.user}|${p.pid}`;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          command: p.command,
          user: p.user,
          pid: p.pid,
          totalCpu: 0,
          totalMem: 0,
          maxCpu: 0,
          maxMem: 0,
          count: 0,
          avgCpu: 0,
          avgMem: 0,
          significance: 0,
        });
      }

      const s = statsMap.get(key);
      s.totalCpu += p.avg_cpu * p.count;
      s.totalMem += p.avg_mem * p.count;
      s.maxCpu = Math.max(s.maxCpu, p.max_cpu);
      s.maxMem = Math.max(s.maxMem, p.max_mem);
      s.count += p.count;
    });

    statsMap.forEach(s => {
      s.avgCpu = s.count ? s.totalCpu / s.count : 0;
      s.avgMem = s.count ? s.totalMem / s.count : 0;
      s.significance = (
        s.avgCpu * 0.4 +
        s.maxCpu * 0.3 +
        s.avgMem * 0.2 +
        Math.log(s.count + 1) * 0.1
      );
    });

    return statsMap;
  }

  private selectSignificantProcesses(
    statsMap: Map<string, ProcessStatistics>,
    limit: number
  ): ProcessStatistics[] {
    return Array.from(statsMap.values())
      .filter(s => s.avgCpu > 0.1 || s.maxCpu > 1.0 || s.avgMem > 0.5)
      .sort((a, b) => b.significance - a.significance)
      .slice(0, limit);
  }

  private groupDataByTimeIntervals(
    processes: ProcessStatistics[],
    intervalMinutes: number
  ): Map<string, Map<number, { cpu: number; mem: number; count: number }>> {
    const grouped = new Map<string, Map<number, { cpu: number; mem: number; count: number }>>();
    const interval = intervalMinutes * 60 * 1000;

    processes.forEach(p => {
      const key = `${p.command}|${p.user}|${p.pid}`;
      grouped.set(key, new Map());
    });

    this.historicalProcesses.forEach(p => {
      const key = `${p.command}|${p.user}|${p.pid}`;
      if (!grouped.has(key)) return;

      const ts = new Date(p.timestamp).getTime();
      const bucket = Math.floor(ts / interval) * interval;

      const slot = grouped.get(key);
      if (!slot.has(bucket)) {
        slot.set(bucket, { cpu: 0, mem: 0, count: 0 });
      }

      const data = slot.get(bucket);
      data.cpu += p.avg_cpu * p.count;
      data.mem += p.avg_mem * p.count;
      data.count += p.count;
    });

    grouped.forEach(slot => {
      slot.forEach(s => {
        if (s.count > 0) {
          s.cpu /= s.count;
          s.mem /= s.count;
        }
      });
    });

    return grouped;
  }

  private buildHeatmapData(
    grouped: Map<string, Map<number, { cpu: number; mem: number; count: number }>>
  ): {
    cpuHeatmapData: number[][];
    memHeatmapData: number[][];
    processNames: string[];
    timeLabels: number[];
  } {
    const cpuData = [];
    const memData = [];
    const processNames = [];
    const allTimestamps = new Set<number>();

    grouped.forEach((dataMap, key) => {
      const [cmd, user, pidStr] = key.split("|");
      const name = this.formatProcessDisplayName(cmd, user, parseInt(pidStr));
      processNames.push(name);

      dataMap.forEach((metrics, timestamp) => {
        allTimestamps.add(timestamp);
        cpuData.push([timestamp, name, Math.round(metrics.cpu * 10) / 10]);
        memData.push([timestamp, name, Math.round(metrics.mem * 10) / 10]);
      });
    });

    const timeLabels = Array.from(allTimestamps).sort((a, b) => a - b);
    return { cpuHeatmapData: cpuData, memHeatmapData: memData, processNames, timeLabels };
  }

  private formatProcessDisplayName(cmd: string, user: string, pid: number): string {
    const exec = cmd.split('/').pop() || cmd;
    const name = exec.length > 25 ? exec.slice(0, 22) + '...' : exec;
    const skipUsers = ['root', 'system', 'daemon'];
    const suffix = skipUsers.includes(user) ? '' : `(${user})`;
    return `${name}${suffix}`;
  }

  private updateHeatmapChartOptions(
    cpu: number[][],
    mem: number[][],
    names: string[],
    labels: number[]
  ) {
    this.processCpuHeatmapOption = {
      ...this.processCpuHeatmapOption,
      yAxis: { ...this.processCpuHeatmapOption.yAxis, data: names },
      series: [{ ...this.processCpuHeatmapOption.series[0], data: cpu }],
    };

    this.processMemHeatmapOption = {
      ...this.processMemHeatmapOption,
      yAxis: { ...this.processMemHeatmapOption.yAxis, data: names },
      series: [{ ...this.processMemHeatmapOption.series[0], data: mem }],
    };
  }

  generateProcessSummary() {
    if (!this.historicalProcesses || this.historicalProcesses.length === 0) {
      this.processSummary = [];
      return;
    }

    const grouped = new Map<number, AggregatedProcessData[]>();

    this.historicalProcesses.forEach(p => {
      if (!grouped.has(p.pid)) {
        grouped.set(p.pid, []);
      }
      grouped.get(p.pid).push(p);
    });

    this.processSummary = [];

    grouped.forEach((records, pid) => {
      const ref = records[0];
      let totalCpu = 0, totalMem = 0, count = 0;
      let maxCpu = 0, maxMem = 0;

      records.forEach(r => {
        totalCpu += r.avg_cpu * r.count;
        totalMem += r.avg_mem * r.count;
        count += r.count;
        maxCpu = Math.max(maxCpu, r.max_cpu);
        maxMem = Math.max(maxMem, r.max_mem);
      });

      this.processSummary.push({
        pid,
        command: ref.command,
        user: ref.user,
        count,
        avgCpu: (totalCpu / count).toFixed(2),
        maxCpu: maxCpu.toFixed(2),
        avgMem: (totalMem / count).toFixed(2),
        maxMem: maxMem.toFixed(2),
      });
    });

    this.processSummary.sort((a, b) => parseFloat(b.avgCpu) - parseFloat(a.avgCpu));
  }

  loadHistoricalProcessData(): void {
    if (!this.validateForm()) return;

    this.loading = true;
    this.hasError = false;
    this.errorMessage = '';

    const range = this.getDateTimeRange();

    if (new Date(range.start) >= new Date(range.end)) {
      this.showError('End date must be after start date');
      this.loading = false;
      return;
    }

    this.monitoringService.getHistoricalProcesses(range)
      .pipe(
        tap(res => {
          this.historicalProcesses = res.data || [];
          if (this.historicalProcesses.length === 0) {
            this.showError('No historical data found in the time range');
          } else {
            this.updateProcessCharts();
            this.generateProcessSummary();
          }
        }),
        catchError(error => {
          this.showError(`Failed to load data: ${error.message || 'Unknown error'}`);
          this.historicalProcesses = [];
          this.processSummary = [];
          return of(null);
        })
      )
      .subscribe(() => {
        this.loading = false;
      });
  }

  private validateForm(): boolean {
    if (!this.filterForm.valid) {
      this.showError("Please fill all fields correctly.");
      return false;
    }
    return true;
  }

  private getDateTimeRange(): DateTimeRange {
    const form = this.filterForm.value;
    const start = new Date(`${form.startDate}T${form.startTime}:00`);
    const end = new Date(`${form.endDate}T${form.endTime}:59`);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  private showError(message: string): void {
    this.errorMessage = message;
    this.hasError = true;
  }

  private formatDateForInput(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  // Status helper methods
  getCpuStatusClass(value: number): string {
    return value > 75 ? 'text-danger' : value > 50 ? 'text-warning' : 'text-success';
  }

  getMemStatusClass(value: number): string {
    return value > 75 ? 'text-danger' : value > 50 ? 'text-warning' : 'text-success';
  }

  getCpuStatus(value: number): string {
    return value > 75 ? 'danger' : value > 50 ? 'warning' : 'success';
  }

  getMemStatus(value: number): string {
    return value > 75 ? 'danger' : value > 50 ? 'warning' : 'success';
  }

  // Quick selection methods
  selectToday(): void {
    const today = new Date();
    this.filterForm.patchValue({
      startDate: this.formatDateForInput(today),
      startTime: "00:00",
      endDate: this.formatDateForInput(today),
      endTime: "23:59",
    });
  }

  selectYesterday(): void {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.filterForm.patchValue({
      startDate: this.formatDateForInput(yesterday),
      startTime: "00:00",
      endDate: this.formatDateForInput(yesterday),
      endTime: "23:59",
    });
  }

  selectLast24Hours(): void {
    this.quickSelectRange(1);
  }

  selectLastWeek(): void {
    this.quickSelectRange(7);
  }

  selectLastMonth(): void {
    this.quickSelectRange(30);
  }

  private quickSelectRange(days: number): void {
    const now = new Date();
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - days);

    this.filterForm.patchValue({
      startDate: this.formatDateForInput(pastDate),
      startTime: "00:00",
      endDate: this.formatDateForInput(now),
      endTime: "23:59",
    });
  }

  // Process selection methods
  selectProcess(process: ProcessData): void {
    if (!this.selectedProcesses.some(p => p.pid === process.pid)) {
      this.selectedProcesses.push(process);
    }
  }

  toggleProcessSelection(process: ProcessData): void {
    const index = this.selectedProcesses.findIndex(p => p.pid === process.pid);
    if (index !== -1) {
      this.selectedProcesses.splice(index, 1);
    } else {
      this.selectedProcesses.push(process);
    }
  }

  isProcessSelected(process: ProcessData): boolean {
    return this.selectedProcesses.some(p => p.pid === process.pid);
  }

  toggleAllProcesses(checked: boolean): void {
    if (checked) {
      this.selectedProcesses = [...this.activeProcesses];
    } else {
      this.selectedProcesses = [];
    }
  }
}