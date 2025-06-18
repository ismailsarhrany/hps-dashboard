// src/app/pages/process/process.component.ts
import { Component, OnInit, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { Subscription, interval, forkJoin, of } from "rxjs";
import { NbThemeService } from "@nebular/theme";
import { catchError, map, switchMap, tap, filter, take } from "rxjs/operators";
import {
  ApiService,
  ProcessData,
  DateTimeRange,
} from "../../services/monitoring.service";
import {
  RealtimeService,
  RealtimeConnectionStatus,
} from "../../services/realtime.service";

@Component({
  selector: "ngx-process",
  templateUrl: "./process.component.html",
  styleUrls: ["./process.component.scss"],
})
export class ProcessComponent implements OnInit, OnDestroy {
  // Subscriptions management
  private themeSubscription: Subscription;
  private dataSubscriptions: Subscription[] = [];
  private colors: any;
  private echartTheme: any;

  // Connection status
  connectionStatus: RealtimeConnectionStatus = RealtimeConnectionStatus.DISCONNECTED;
  lastUpdateTime = new Date();

  // Process data
  activeProcesses: ProcessData[] = [];
  processes: ProcessData[] = [];
  selectedProcessData: ProcessData[] | null = null;
  selectedProcessInfo: string = "";

  // Charts
  topCpuChartOption: any = {};
  topMemChartOption: any = {};
  processCpuChartOption: any = {};
  processMemChartOption: any = {};

  // Form controls
  filterForm: FormGroup;
  loading = false;
  processListLoading = false;

  // Process statistics
  processStats = {
    avgCpu: 0,
    peakCpu: 0,
    peakCpuTime: new Date(),
    avgMem: 0,
    peakMem: 0,
    peakMemTime: new Date(),
    runtime: "0h 0m",
    isActive: false,
    trendAnalysis: {
      cpuTrend: 'stable' as 'increasing' | 'decreasing' | 'stable',
      memTrend: 'stable' as 'increasing' | 'decreasing' | 'stable',
    },
  };

  // Error handling
  errorMessage: string = '';
  hasError: boolean = false;

  constructor(
    private theme: NbThemeService,
    private monitoringService: ApiService,
    private realtimeService: RealtimeService,
    private fb: FormBuilder
  ) {
    this.initializeForm();
  }

  ngOnInit() {
    // Subscribe to theme changes for chart styling
    this.themeSubscription = this.theme.getJsTheme().subscribe((config) => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
    });

    // Start realtime monitoring
    this.startRealtimeMonitoring();

    // Load initial process list for the dropdown
    this.loadProcessList();

    // Set up auto-refresh for process list (every 30 seconds)
    this.dataSubscriptions.push(
      interval(30000).subscribe(() => {
        this.loadProcessList();
      })
    );
  }

  ngOnDestroy() {
    // Clean up all subscriptions
    this.themeSubscription?.unsubscribe();
    this.dataSubscriptions.forEach((sub) => sub.unsubscribe());
    this.dataSubscriptions = [];

    // Stop realtime monitoring
    this.stopRealtimeMonitoring();
  }

  /**
   * Initialize form with proper validation and default values
   */
  private initializeForm(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    this.filterForm = this.fb.group({
      selectedProcess: ['', [Validators.required]],
      startDate: [this.formatDateForInput(yesterday), [Validators.required]],
      startTime: ['00:00', [Validators.required]],
      endDate: [this.formatDateForInput(now), [Validators.required]],
      endTime: ['23:59', [Validators.required]],
    });

    // Subscribe to form changes for validation feedback
    this.filterForm.valueChanges.subscribe(() => {
      this.hasError = false;
      this.errorMessage = '';
    });
  }

  /**
   * Initialize chart options with theme-specific settings
   */
  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === "dark" ? this.colors.bg2 : this.colors.white,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
      legend: {
        textStyle: {
          color: this.colors.fgText,
        },
      },
    };

    // Top CPU Consumers Chart
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

    // Top Memory Consumers Chart
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

    // Process CPU History Chart
    this.processCpuChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: function (params: any) {
          const date = new Date(params[0].value[0]);
          return `${date.toLocaleString()}<br/>${params[0].seriesName}: ${params[0].value[1]}%`;
        },
      },
      xAxis: {
        type: "time",
        axisLabel: {
          color: this.colors.fgText,
          formatter: "{HH}:{mm}:{ss}",
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
        type: "line",
        smooth: true,
        data: [],
        itemStyle: { color: this.colors.danger },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: this.colors.dangerLight },
              { offset: 1, color: "rgba(255, 61, 113, 0)" },
            ],
          },
        },
      }],
    };

    // Process Memory History Chart
    this.processMemChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: function (params: any) {
          const date = new Date(params[0].value[0]);
          return `${date.toLocaleString()}<br/>${params[0].seriesName}: ${params[0].value[1]}%`;
        },
      },
      xAxis: {
        type: "time",
        axisLabel: {
          color: this.colors.fgText,
          formatter: "{HH}:{mm}:{ss}",
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
        type: "line",
        smooth: true,
        data: [],
        itemStyle: { color: this.colors.success },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: this.colors.successLight },
              { offset: 1, color: "rgba(0, 214, 143, 0)" },
            ],
          },
        },
      }],
    };
  }

  /**
   * Start realtime monitoring of processes
   */
  startRealtimeMonitoring() {
    // Connect to WebSocket for process data
    this.realtimeService.connectToMetrics(["process"]);

    // Subscribe to connection status
    this.dataSubscriptions.push(
      this.realtimeService.getConnectionStatus("process").subscribe((status) => {
        this.connectionStatus = status;
      })
    );

    // Subscribe to realtime process data
    this.dataSubscriptions.push(
      this.realtimeService.getRealtimeProcess().subscribe((processData) => {
        if (processData) {
          this.lastUpdateTime = new Date();
          this.updateActiveProcesses(processData);
          this.updateTopProcessCharts();

          // If a process is selected, check if it's in the new data
          if (this.selectedProcessData && this.selectedProcessData.length > 0) {
            const selectedPid = this.selectedProcessData[0].pid;
            const updatedProcess = this.activeProcesses.find((p) => p.pid === selectedPid);
            if (updatedProcess) {
              // Add the new data point to the selected process data
              this.selectedProcessData.push(updatedProcess);
              // Keep only the last 100 data points to avoid memory issues
              if (this.selectedProcessData.length > 100) {
                this.selectedProcessData = this.selectedProcessData.slice(-100);
              }
              this.updateProcessCharts();
              this.updateProcessStats();
            }
          }
        }
      })
    );

    // Fallback: periodically get process list from realtime data
    this.dataSubscriptions.push(
      interval(10000).subscribe(() => {
        if (this.connectionStatus === RealtimeConnectionStatus.CONNECTED && this.processes.length === 0) {
          this.loadProcessList();
        }
      })
    );
  }

  /**
   * Stop realtime monitoring
   */
  stopRealtimeMonitoring() {
    this.realtimeService.disconnectAll();
    this.dataSubscriptions.forEach((sub) => sub.unsubscribe());
    this.dataSubscriptions = [];
  }

  /**
   * Load process list for dropdown from active processes
   */
  loadProcessList() {
    this.processListLoading = true;
    
    // First try to get from current active processes
    if (this.activeProcesses.length > 0) {
      this.processes = [...this.activeProcesses]
        .filter(p => p.pid && p.command && p.command.trim() !== '')
        .sort((a, b) => a.pid - b.pid);
      
      if (this.processes.length > 0 && !this.filterForm.value.selectedProcess) {
        this.filterForm.patchValue({
          selectedProcess: this.processes[0].pid.toString(),
        });
      }
      this.processListLoading = false;
      return;
    }

    // Fallback: get recent historical data to populate process list
    const recentRange = this.monitoringService.getDateRange(0.1); // Last ~2.4 hours
    
    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalProcesses(recentRange)
        .pipe(
          map(response => response.data || []),
          map(processes => {
            // Get unique processes by PID, keeping the most recent entry for each
            const uniqueProcesses = new Map<number, ProcessData>();
            processes.forEach(p => {
              if (p.pid && p.command && p.command.trim() !== '') {
                const existing = uniqueProcesses.get(p.pid);
                if (!existing || new Date(p.timestamp) > new Date(existing.timestamp)) {
                  uniqueProcesses.set(p.pid, p);
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

          if (processes.length > 0 && !this.filterForm.value.selectedProcess) {
            this.filterForm.patchValue({
              selectedProcess: processes[0].pid.toString(),
            });
          }
        })
    );
  }

  /**
   * Update active processes list and sort by CPU usage
   */
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

    // Update process list if it's empty
    if (this.processes.length === 0 && this.activeProcesses.length > 0) {
      this.processes = [...this.activeProcesses].sort((a, b) => a.pid - b.pid);
    }
  }

  /**
   * Update Top CPU and Memory Consumers charts
   */
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

  /**
   * Update Process CPU and Memory history charts
   */
  updateProcessCharts() {
    if (!this.selectedProcessData || this.selectedProcessData.length === 0) return;

    const cpuData = this.selectedProcessData.map(p => [
      new Date(p.timestamp).getTime(),
      p.cpu,
    ]);

    const memData = this.selectedProcessData.map(p => [
      new Date(p.timestamp).getTime(),
      p.mem,
    ]);

    this.processCpuChartOption = {
      ...this.processCpuChartOption,
      series: [{
        ...this.processCpuChartOption.series[0],
        data: cpuData,
      }],
    };

    this.processMemChartOption = {
      ...this.processMemChartOption,
      series: [{
        ...this.processMemChartOption.series[0],
        data: memData,
      }],
    };
  }

  /**
   * Update process statistics with enhanced analysis
   */
  updateProcessStats() {
    if (!this.selectedProcessData || this.selectedProcessData.length === 0) return;

    const data = this.selectedProcessData;
    const avgCpu = data.reduce((sum, p) => sum + p.cpu, 0) / data.length;
    const avgMem = data.reduce((sum, p) => sum + p.mem, 0) / data.length;
    const peakCpu = Math.max(...data.map(p => p.cpu));
    const peakMem = Math.max(...data.map(p => p.mem));

    const peakCpuProcess = data.find(p => p.cpu === peakCpu);
    const peakMemProcess = data.find(p => p.mem === peakMem);
    const isActive = this.activeProcesses.some(p => p.pid === data[0].pid);

    // Calculate runtime
    let runtime = "0h 0m";
    if (data.length > 1) {
      const firstTimestamp = new Date(data[0].timestamp).getTime();
      const lastTimestamp = new Date(data[data.length - 1].timestamp).getTime();
      const runtimeMs = lastTimestamp - firstTimestamp;
      const hours = Math.floor(runtimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((runtimeMs % (1000 * 60 * 60)) / (1000 * 60));
      runtime = `${hours}h ${minutes}m`;
    }

    // Calculate trends
    let cpuTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let memTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';

    if (data.length >= 10) {
      const recent = data.slice(-5);
      const older = data.slice(-10, -5);
      
      const recentCpuAvg = recent.reduce((sum, p) => sum + p.cpu, 0) / recent.length;
      const olderCpuAvg = older.reduce((sum, p) => sum + p.cpu, 0) / older.length;
      const recentMemAvg = recent.reduce((sum, p) => sum + p.mem, 0) / recent.length;
      const olderMemAvg = older.reduce((sum, p) => sum + p.mem, 0) / older.length;

      const cpuDiff = Math.abs(recentCpuAvg - olderCpuAvg);
      const memDiff = Math.abs(recentMemAvg - olderMemAvg);

      if (cpuDiff > olderCpuAvg * 0.1) {
        cpuTrend = recentCpuAvg > olderCpuAvg ? 'increasing' : 'decreasing';
      }
      if (memDiff > olderMemAvg * 0.1) {
        memTrend = recentMemAvg > olderMemAvg ? 'increasing' : 'decreasing';
      }
    }

    this.processStats = {
      avgCpu: Math.round(avgCpu * 100) / 100,
      peakCpu,
      peakCpuTime: peakCpuProcess ? new Date(peakCpuProcess.timestamp) : new Date(),
      avgMem: Math.round(avgMem * 100) / 100,
      peakMem,
      peakMemTime: peakMemProcess ? new Date(peakMemProcess.timestamp) : new Date(),
      runtime,
      isActive,
      trendAnalysis: { cpuTrend, memTrend },
    };
  }

  /**
   * Load historical data for selected process with improved validation and error handling
   */
  loadHistoricalProcessData(): void {
    if (!this.validateForm()) return;

    this.loading = true;
    this.hasError = false;
    this.errorMessage = '';

    const pid = parseInt(this.filterForm.value.selectedProcess);
    const range = this.getDateTimeRange();

    // Validate date range
    if (new Date(range.start) >= new Date(range.end)) {
      this.showError('End date must be after start date');
      this.loading = false;
      return;
    }

    // Find process info for display
    const processInfo = this.processes.find(p => p.pid === pid);
    this.selectedProcessInfo = processInfo
      ? `${this.truncateCommand(processInfo.command, 30)} (PID: ${pid})`
      : `PID: ${pid}`;

    console.log("Loading historical process data for:", { pid, range });

    this.monitoringService.getHistoricalProcesses(range, pid)
      .pipe(
        tap(response => {
          console.log("Historical data response:", response);
          const data = response.data || [];
          
          if (data.length === 0) {
            this.showError(`No historical data found for PID ${pid} in the selected time range`);
          } else {
            console.log(`Loaded ${data.length} historical records`);
          }

          this.selectedProcessData = data;
          this.updateProcessCharts();
          this.updateProcessStats();
        }),
        catchError(error => {
          console.error("Error fetching historical process data:", error);
          this.showError(`Failed to load historical data: ${error.message || 'Unknown error'}`);
          this.selectedProcessData = [];
          return of(null);
        })
      )
      .subscribe(() => {
        this.loading = false;
      });
  }

  /**
   * Validate form and show appropriate error messages
   */
  private validateForm(): boolean {
    if (!this.filterForm.valid) {
      this.filterForm.markAllAsTouched();
      
      const errors: string[] = [];
      const controls = this.filterForm.controls;
      
      if (controls['selectedProcess'].errors) errors.push('Please select a process');
      if (controls['startDate'].errors) errors.push('Please select a start date');
      if (controls['startTime'].errors) errors.push('Please select a start time');
      if (controls['endDate'].errors) errors.push('Please select an end date');
      if (controls['endTime'].errors) errors.push('Please select an end time');
      
      this.showError('Please fix the following errors: ' + errors.join(', '));
      return false;
    }
    return true;
  }

  /**
   * Show error message to user
   */
  private showError(message: string): void {
    this.hasError = true;
    this.errorMessage = message;
    console.error('Process Component Error:', message);
  }

  /**
   * Select a process from the active processes table
   */
  selectProcess(process: ProcessData) {
    this.filterForm.patchValue({
      selectedProcess: process.pid.toString(),
    });

    this.selectedProcessData = [process];
    this.selectedProcessInfo = `${this.truncateCommand(process.command, 30)} (PID: ${process.pid})`;

    this.updateProcessCharts();
    this.updateProcessStats();
    this.loadHistoricalProcessData();
  }

  // Date/Time Helper Methods
  private formatDateForInput(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private getDateTimeRange(): DateTimeRange {
    const form = this.filterForm.value;
    const startDateTime = new Date(`${form.startDate}T${form.startTime}:00`);
    const endDateTime = new Date(`${form.endDate}T${form.endTime}:00`);

    return {
      start: startDateTime.toISOString(),
      end: endDateTime.toISOString(),
    };
  }

  // Quick Selection Methods
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

  selectLast24Hours(): void { this.quickSelectRange(1); }
  selectLastWeek(): void { this.quickSelectRange(7); }
  selectLastMonth(): void { this.quickSelectRange(30); }

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

  // Utility Methods
  getCpuStatusClass(value: number): string {
    if (value > 75) return "text-danger";
    if (value > 50) return "text-warning";
    return "text-success";
  }

  getMemStatusClass(value: number): string {
    if (value > 75) return "text-danger";
    if (value > 50) return "text-warning";
    return "text-success";
  }

  getCpuStatus(value: number): string {
    if (value > 75) return "danger";
    if (value > 50) return "warning";
    return "success";
  }

  getMemStatus(value: number): string {
    if (value > 75) return "danger";
    if (value > 50) return "warning";
    return "success";
  }

  private truncateCommand(command: string, maxLength: number): string {
    return command.length > maxLength
      ? command.substring(0, maxLength) + "..."
      : command;
  }

  // Trend analysis helper
  getTrendIcon(trend: 'increasing' | 'decreasing' | 'stable'): string {
    switch (trend) {
      case 'increasing': return '↗️';
      case 'decreasing': return '↘️';
      default: return '➡️';
    }
  }

  getTrendClass(trend: 'increasing' | 'decreasing' | 'stable'): string {
    switch (trend) {
      case 'increasing': return 'text-danger';
      case 'decreasing': return 'text-success';
      default: return 'text-info';
    }
  }
}