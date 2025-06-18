// src/app/pages/process/process.component.ts
import { Component, OnInit, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { Subscription, of } from "rxjs";
import { NbThemeService } from "@nebular/theme";
import { catchError, map, tap } from "rxjs/operators";
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
  historicalProcesses: ProcessData[] = [];
  processSummary: any[] = [];
  
  // Track selected processes
  selectedProcesses: ProcessData[] = [];

  // Charts
  topCpuChartOption: any = {};
  topMemChartOption: any = {};
  processCpuChartOption: any = {};
  processMemChartOption: any = {};

  // Form controls
  filterForm: FormGroup;
  loading = false;
  processListLoading = false;

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
        formatter: (name) => {
          // Truncate long process names for legend
          return name.length > 20 ? name.substring(0, 17) + '...' : name;
        }
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

    // Process CPU History Chart
    this.processCpuChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const date = new Date(params[0].value[0]);
          let result = `<b>${date.toLocaleString()}</b><br>`;
          params.forEach(p => {
            result += `${p.seriesName}: <b>${p.value[1].toFixed(1)}%</b><br>`;
          });
          return result;
        }
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
      dataZoom: [{
        type: 'inside',
        start: 0,
        end: 100,
        filterMode: 'none'
      }, {
        type: 'slider',
        bottom: 10,
        height: 20,
        textStyle: { color: this.colors.fgText }
      }],
      legend: {
        show: true,
        type: 'scroll',
        bottom: 0,
        textStyle: { color: this.colors.fgText },
        pageTextStyle: { color: this.colors.fgText }
      }
    };

    // Process Memory History Chart
    this.processMemChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const date = new Date(params[0].value[0]);
          let result = `<b>${date.toLocaleString()}</b><br>`;
          params.forEach(p => {
            result += `${p.seriesName}: <b>${p.value[1].toFixed(1)}%</b><br>`;
          });
          return result;
        }
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
      dataZoom: [{
        type: 'inside',
        start: 0,
        end: 100,
        filterMode: 'none'
      }, {
        type: 'slider',
        bottom: 10,
        height: 20,
        textStyle: { color: this.colors.fgText }
      }],
      legend: {
        show: true,
        type: 'scroll',
        bottom: 0,
        textStyle: { color: this.colors.fgText },
        pageTextStyle: { color: this.colors.fgText }
      }
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
   * Update Process CPU and Memory history charts for all processes
   */
  updateProcessCharts() {
    if (!this.historicalProcesses || this.historicalProcesses.length === 0) return;

    // Clear previous data
    this.processCpuChartOption.series = [];
    this.processMemChartOption.series = [];

    // Prepare colors for each process
    const colorPalette = [
      this.colors.danger,
      this.colors.success,
      this.colors.warning,
      this.colors.info,
      this.colors.primary,
      '#5470C6',
      '#91CC75',
      '#FAC858',
      '#EE6666',
      '#73C0DE'
    ];

    // Group data by PID
    const dataByPid = new Map<number, ProcessData[]>();
    this.historicalProcesses.forEach(p => {
      if (!dataByPid.has(p.pid)) {
        dataByPid.set(p.pid, []);
      }
      dataByPid.get(p.pid).push(p);
    });

    // Create chart series for each process
    let colorIndex = 0;
    dataByPid.forEach((processData, pid) => {
      // Sort by timestamp
      processData.sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Downsample data to max 500 points
      const cpuData = this.downsampleLTTB(
        processData.map(p => [new Date(p.timestamp).getTime(), p.cpu]),
        500
      );

      const memData = this.downsampleLTTB(
        processData.map(p => [new Date(p.timestamp).getTime(), p.mem]),
        500
      );

      const process = processData[0];
      const truncatedCommand = this.truncateCommand(process.command, 20);
      const color = colorPalette[colorIndex % colorPalette.length];
      const lightColor = this.adjustColorOpacity(color, 0.3);

      // Add CPU series
      this.processCpuChartOption.series.push({
        name: `PID ${pid} (${truncatedCommand})`,
        type: "line",
        symbol: 'none',
        sampling: 'lttb',
        data: cpuData,
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: lightColor },
              { offset: 1, color: this.adjustColorOpacity(color, 0.05) },
            ],
          },
        },
      });

      // Add Memory series
      this.processMemChartOption.series.push({
        name: `PID ${pid} (${truncatedCommand})`,
        type: "line",
        symbol: 'none',
        sampling: 'lttb',
        data: memData,
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: lightColor },
              { offset: 1, color: this.adjustColorOpacity(color, 0.05) },
            ],
          },
        },
      });

      colorIndex++;
    });
  }

  /**
   * Generate process summary table data
   */
  generateProcessSummary() {
    if (!this.historicalProcesses || this.historicalProcesses.length === 0) {
      this.processSummary = [];
      return;
    }

    // Group data by PID
    const dataByPid = new Map<number, ProcessData[]>();
    this.historicalProcesses.forEach(p => {
      if (!dataByPid.has(p.pid)) {
        dataByPid.set(p.pid, []);
      }
      dataByPid.get(p.pid).push(p);
    });

    // Create summary for each process
    this.processSummary = [];
    dataByPid.forEach((processData, pid) => {
      const process = processData[0];
      const cpuValues = processData.map(p => p.cpu);
      const memValues = processData.map(p => p.mem);

      const avgCpu = cpuValues.reduce((sum, val) => sum + val, 0) / cpuValues.length;
      const maxCpu = Math.max(...cpuValues);
      const avgMem = memValues.reduce((sum, val) => sum + val, 0) / memValues.length;
      const maxMem = Math.max(...memValues);

      this.processSummary.push({
        pid,
        command: process.command,
        user: process.user,
        count: processData.length,
        avgCpu: avgCpu.toFixed(2),
        maxCpu: maxCpu.toFixed(2),
        avgMem: avgMem.toFixed(2),
        maxMem: maxMem.toFixed(2),
      });
    });

    // Sort by highest average CPU
    this.processSummary.sort((a, b) => parseFloat(b.avgCpu) - parseFloat(a.avgCpu));
  }

  // Add helper methods
  private downsampleLTTB(data: [number, number][], threshold: number): [number, number][] {
    if (data.length <= threshold) return data;

    const sampled = [];
    const bucketSize = (data.length - 2) / (threshold - 2);
    let a = 0;

    sampled.push(data[a]);

    for (let i = 0; i < threshold - 2; i++) {
      const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1);

      let maxArea = -1;
      let nextA = rangeStart;

      for (let j = rangeStart; j < rangeEnd; j++) {
        const area = Math.abs(
          (data[a][0] - data[data.length - 1][0]) * (data[j][1] - data[a][1]) -
          (data[a][0] - data[j][0]) * (data[data.length - 1][1] - data[a][1])
        ) / 2;

        if (area > maxArea) {
          maxArea = area;
          nextA = j;
        }
      }

      sampled.push(data[nextA]);
      a = nextA;
    }

    sampled.push(data[data.length - 1]);
    return sampled;
  }

  private adjustColorOpacity(color: string, opacity: number): string {
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return color;
  }

  /**
   * Load historical data for all processes
   */
  loadHistoricalProcessData(): void {
    if (!this.validateForm()) return;

    this.loading = true;
    this.hasError = false;
    this.errorMessage = '';

    const range = this.getDateTimeRange();

    // Validate date range
    if (new Date(range.start) >= new Date(range.end)) {
      this.showError('End date must be after start date');
      this.loading = false;
      return;
    }

    console.log("Loading historical process data for range:", range);

    // Fetch historical data for all processes
    this.monitoringService.getHistoricalProcesses(range)
      .pipe(
        tap(response => {
          console.log("Historical data response:", response);
          this.historicalProcesses = response.data || [];

          if (this.historicalProcesses.length === 0) {
            this.showError(`No historical data found in the time range`);
          } else {
            console.log(`Loaded ${this.historicalProcesses.length} historical records`);
          }

          // Update charts
          this.updateProcessCharts();

          // Generate summary table
          this.generateProcessSummary();
        }),
        catchError(error => {
          console.error("Error fetching historical process data:", error);
          this.showError(`Failed to load historical data: ${error.message || 'Unknown error'}`);
          this.historicalProcesses = [];
          this.processSummary = [];
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

      if (controls['startDate'].errors)
        errors.push('Please select a start date');
      if (controls['startTime'].errors)
        errors.push('Please select a start time');
      if (controls['endDate'].errors)
        errors.push('Please select an end date');
      if (controls['endTime'].errors)
        errors.push('Please select an end time');

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

  // Process selection methods
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

  selectProcess(process: ProcessData): void {
    // Add to selected processes if not already selected
    if (!this.selectedProcesses.some(p => p.pid === process.pid)) {
      this.selectedProcesses.push(process);
    }
  }

  // Utility Methods
  truncateCommand(command: string, maxLength: number): string {
    return command.length > maxLength
      ? command.substring(0, maxLength) + "..."
      : command;
  }

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
}