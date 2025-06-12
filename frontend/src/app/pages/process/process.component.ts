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
  connectionStatus: RealtimeConnectionStatus =
    RealtimeConnectionStatus.DISCONNECTED;
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
  };

  constructor(
    private theme: NbThemeService,
    private apiService: ApiService,
    private realtimeService: RealtimeService,
    private fb: FormBuilder
  ) {
    this.initializeForm();
  }
  // Add to component properties
  processListLoading = false;

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

    // Debug form validation
    this.filterForm.valueChanges.subscribe(() => {
      console.log('Form validity:', this.filterForm.valid);
      console.log('Form errors:', this.filterForm.errors);
      console.log('Form values:', this.filterForm.value);

      // Check individual field errors
      Object.keys(this.filterForm.controls).forEach(key => {
        const control = this.filterForm.get(key);
        if (control && control.errors) {
          console.log(`${key} errors:`, control.errors);
        }
      });
    });

  }

  /**
   * Initialize chart options with theme-specific settings
   */
  private initializeCharts() {
    const baseOption = {
      backgroundColor:
        this.echartTheme === "dark" ? this.colors.bg2 : this.colors.white,
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
        nameTextStyle: {
          color: this.colors.fgText,
        },
        axisLabel: {
          color: this.colors.fgText,
        },
        splitLine: {
          lineStyle: {
            color: this.colors.separator,
          },
        },
      },
      series: [
        {
          name: "CPU Usage",
          type: "bar",
          data: [],
          itemStyle: {
            color: this.colors.danger,
          },
        },
      ],
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
        nameTextStyle: {
          color: this.colors.fgText,
        },
        axisLabel: {
          color: this.colors.fgText,
        },
        splitLine: {
          lineStyle: {
            color: this.colors.separator,
          },
        },
      },
      series: [
        {
          name: "Memory Usage",
          type: "bar",
          data: [],
          itemStyle: {
            color: this.colors.success,
          },
        },
      ],
    };

    // Process CPU History Chart
    this.processCpuChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          const date = new Date(params[0].value[0]);
          return `${date.toLocaleString()}<br/>${params[0].seriesName}: ${params[0].value[1]
            }%`;
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
        nameTextStyle: {
          color: this.colors.fgText,
        },
        axisLabel: {
          color: this.colors.fgText,
        },
        splitLine: {
          lineStyle: {
            color: this.colors.separator,
          },
        },
      },
      series: [
        {
          name: "CPU Usage",
          type: "line",
          smooth: true,
          data: [],
          itemStyle: {
            color: this.colors.danger,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {
                  offset: 0,
                  color: this.colors.dangerLight,
                },
                {
                  offset: 1,
                  color: "rgba(255, 61, 113, 0)",
                },
              ],
            },
          },
        },
      ],
    };

    // Process Memory History Chart
    this.processMemChartOption = {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        formatter: function (params) {
          const date = new Date(params[0].value[0]);
          return `${date.toLocaleString()}<br/>${params[0].seriesName}: ${params[0].value[1]
            }%`;
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
        nameTextStyle: {
          color: this.colors.fgText,
        },
        axisLabel: {
          color: this.colors.fgText,
        },
        splitLine: {
          lineStyle: {
            color: this.colors.separator,
          },
        },
      },
      series: [
        {
          name: "Memory Usage",
          type: "line",
          smooth: true,
          data: [],
          itemStyle: {
            color: this.colors.success,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {
                  offset: 0,
                  color: this.colors.successLight,
                },
                {
                  offset: 1,
                  color: "rgba(0, 214, 143, 0)",
                },
              ],
            },
          },
        },
      ],
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
      this.realtimeService
        .getConnectionStatus("process")
        .subscribe((status) => {
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
            const updatedProcess = this.activeProcesses.find(
              (p) => p.pid === selectedPid
            );
            if (updatedProcess) {
              // Add the new data point to the selected process data
              this.selectedProcessData.push(updatedProcess);
              // Keep only the last 50 data points to avoid memory issues
              if (this.selectedProcessData.length > 50) {
                this.selectedProcessData = this.selectedProcessData.slice(-50);
              }
              this.updateProcessCharts();
              this.updateProcessStats();
            }
          }
        }
      })
    );

    // Fallback to HTTP API if WebSocket fails
    this.dataSubscriptions.push(
      interval(5000)
        .pipe(
          filter(
            () =>
              this.connectionStatus === RealtimeConnectionStatus.ERROR ||
              this.connectionStatus === RealtimeConnectionStatus.DISCONNECTED
          ),
          switchMap(() =>
            this.apiService.getRealtimeProcess().pipe(
              catchError((error) => {
                console.error("Error fetching processes via API:", error);
                return of({
                  status: "error",
                  data: [],
                  timestamp: new Date().toISOString(),
                });
              })
            )
          )
        )
        .subscribe((response) => {
          if (response.data && response.data.length > 0) {
            this.lastUpdateTime = new Date();
            this.updateActiveProcesses(response.data);
            this.updateTopProcessCharts();
          }
        })
    );
  }

  /**
   * Stop realtime monitoring
   */
  stopRealtimeMonitoring() {
    // Disconnect WebSocket
    this.realtimeService.disconnectAll();

    // Clear subscriptions
    this.dataSubscriptions.forEach((sub) => sub.unsubscribe());
    this.dataSubscriptions = [];
  }

  /**
   * Load process list for dropdown
   */
  loadProcessList() {
    this.processListLoading = true;
    this.dataSubscriptions.push(
      this.apiService.getProcessList().subscribe((processes) => {
        this.processes = processes.sort((a, b) => a.pid - b.pid);
        this.processListLoading = false;

        if (this.processes.length > 0 && !this.filterForm.value.selectedProcess) {
          this.filterForm.patchValue({
            selectedProcess: this.processes[0].pid.toString(),
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
      // More lenient filtering - include processes with valid data
      this.activeProcesses = processes
        .filter((p) => {
          // More lenient filtering - include processes with valid data
          const isValid = p && p.pid && p.command && p.command.trim() !== "";
          const hasActivity =
            p.cpu > 0 || p.mem > 0 || p.command.includes("sudo"); // Include sudo processes

          return isValid && (hasActivity || true); // Show all valid processes for now
        })
        .sort((a, b) => b.cpu - a.cpu); // Sort by CPU usage
    } else {
      // Handle single process update
      const process = processes;
      if (process && process.pid && process.command) {
        const index = this.activeProcesses.findIndex(
          (p) => p.pid === process.pid
        );

        if (index !== -1) {
          this.activeProcesses[index] = process;
        } else {
          this.activeProcesses.push(process);
        }

        // Re-sort after update
        this.activeProcesses.sort((a, b) => b.cpu - a.cpu);
      }
    }
  }

  /**
   * Update Top CPU and Memory Consumers charts
   */
  updateTopProcessCharts() {
    if (this.activeProcesses.length === 0) return;

    // Get top 5 CPU consumers
    const topCpuProcesses = [...this.activeProcesses]
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5);

    // Get top 5 memory consumers
    const topMemProcesses = [...this.activeProcesses]
      .sort((a, b) => b.mem - a.mem)
      .slice(0, 5);

    // Update CPU chart
    this.topCpuChartOption = {
      ...this.topCpuChartOption,
      xAxis: {
        ...this.topCpuChartOption.xAxis,
        data: topCpuProcesses.map((p) => this.truncateCommand(p.command, 15)),
      },
      series: [
        {
          ...this.topCpuChartOption.series[0],
          data: topCpuProcesses.map((p) => p.cpu),
        },
      ],
    };

    // Update Memory chart
    this.topMemChartOption = {
      ...this.topMemChartOption,
      xAxis: {
        ...this.topMemChartOption.xAxis,
        data: topMemProcesses.map((p) => this.truncateCommand(p.command, 15)),
      },
      series: [
        {
          ...this.topMemChartOption.series[0],
          data: topMemProcesses.map((p) => p.mem),
        },
      ],
    };
  }

  /**
   * Update Process CPU and Memory history charts
   */
  updateProcessCharts() {
    if (!this.selectedProcessData || this.selectedProcessData.length === 0)
      return;

    // Prepare data for charts
    const cpuData = this.selectedProcessData.map((p) => [
      new Date(p.timestamp).getTime(),
      p.cpu,
    ]);

    const memData = this.selectedProcessData.map((p) => [
      new Date(p.timestamp).getTime(),
      p.mem,
    ]);

    // Update CPU chart
    this.processCpuChartOption = {
      ...this.processCpuChartOption,
      series: [
        {
          ...this.processCpuChartOption.series[0],
          data: cpuData,
        },
      ],
    };

    // Update Memory chart
    this.processMemChartOption = {
      ...this.processMemChartOption,
      series: [
        {
          ...this.processMemChartOption.series[0],
          data: memData,
        },
      ],
    };
  }

  /**
   * Update process statistics
   */
  updateProcessStats() {
    if (!this.selectedProcessData || this.selectedProcessData.length === 0)
      return;

    // Calculate average CPU and memory usage
    const avgCpu =
      this.selectedProcessData.reduce((sum, p) => sum + p.cpu, 0) /
      this.selectedProcessData.length;
    const avgMem =
      this.selectedProcessData.reduce((sum, p) => sum + p.mem, 0) /
      this.selectedProcessData.length;

    // Find peak CPU and memory usage
    const peakCpu = Math.max(...this.selectedProcessData.map((p) => p.cpu));
    const peakMem = Math.max(...this.selectedProcessData.map((p) => p.mem));

    // Find timestamps of peak values
    const peakCpuProcess = this.selectedProcessData.find(
      (p) => p.cpu === peakCpu
    );
    const peakMemProcess = this.selectedProcessData.find(
      (p) => p.mem === peakMem
    );

    // Check if process is active
    const isActive = this.activeProcesses.some(
      (p) => p.pid === this.selectedProcessData![0].pid
    );

    // Calculate runtime (if we have enough data)
    let runtime = "0h 0m";
    if (this.selectedProcessData.length > 1) {
      const firstTimestamp = new Date(
        this.selectedProcessData[0].timestamp
      ).getTime();
      const lastTimestamp = new Date(
        this.selectedProcessData[this.selectedProcessData.length - 1].timestamp
      ).getTime();
      const runtimeMs = lastTimestamp - firstTimestamp;
      const hours = Math.floor(runtimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((runtimeMs % (1000 * 60 * 60)) / (1000 * 60));
      runtime = `${hours}h ${minutes}m`;
    }

    // Update stats
    this.processStats = {
      avgCpu,
      peakCpu,
      peakCpuTime: peakCpuProcess
        ? new Date(peakCpuProcess.timestamp)
        : new Date(),
      avgMem,
      peakMem,
      peakMemTime: peakMemProcess
        ? new Date(peakMemProcess.timestamp)
        : new Date(),
      runtime,
      isActive,
    };
  }

  private formatDateForInput(date: Date): string {
    return date.toISOString().split("T")[0]; // YYYY-MM-DD format
  }

  /**
   * Get date/time range from form values with proper ISO format
   */
  private getDateTimeRange(): DateTimeRange {
    const form = this.filterForm.value;

    // Add seconds to time strings
    const startDateTime = new Date(`${form.startDate}T${form.startTime}:00`);
    const endDateTime = new Date(`${form.endDate}T${form.endTime}:00`);

    return {
      start: startDateTime.toISOString(),
      end: endDateTime.toISOString(),
    };
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

  /**
   * Set date range for quick selection
   */
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

  /**
   * Load historical data for selected process with better validation
   */
  loadHistoricalProcessData(): void {
    // Enhanced form validation logging
    console.log('=== FORM VALIDATION DEBUG ===');
    console.log('Form valid:', this.filterForm.valid);
    console.log('Form value:', this.filterForm.value);
    console.log('Form errors:', this.filterForm.errors);

    // Check each control individually
    Object.keys(this.filterForm.controls).forEach(key => {
      const control = this.filterForm.get(key);
      console.log(`${key}:`, {
        value: control?.value,
        valid: control?.valid,
        errors: control?.errors,
        touched: control?.touched,
        dirty: control?.dirty
      });
    });

    // Manual validation check
    const formValue = this.filterForm.value;
    const isFormValid =
      formValue.selectedProcess &&
      formValue.startDate &&
      formValue.startTime &&
      formValue.endDate &&
      formValue.endTime;

    console.log('Manual validation check:', isFormValid);
    console.log('================================');

    if (!this.filterForm.valid) {
      console.warn("Form is invalid! Stopping execution.");

      // Mark all fields as touched to show validation errors
      Object.keys(this.filterForm.controls).forEach(key => {
        this.filterForm.get(key)?.markAsTouched();
      });
      // In loadHistoricalProcessData() method:
      catchError((error) => {
        console.error("Error fetching historical process data:", error);
        this.loading = false;
        this.selectedProcessData = [];
        // Show error notification
        return of(null);
      })

      return;

    }

    console.log("Loading historical process data...");
    console.log("Form values:", this.filterForm.value);

    this.loading = true;
    const pid = parseInt(this.filterForm.value.selectedProcess);
    const range = this.getDateTimeRange();

    console.log("Historical data request:", { pid, range });
    console.log("API URL will be:", `http://localhost:8000/api/metrics/historical/?metric=process&start=${range.start}&end=${range.end}&pid=${pid}`);

    // Find process info for display
    const processInfo = this.processes.find((p) => p.pid === pid);
    this.selectedProcessInfo = processInfo
      ? `${this.truncateCommand(processInfo.command, 30)} (PID: ${pid})`
      : `PID: ${pid}`;

    this.apiService
      .getHistoricalProcesses(range, pid)
      .pipe(
        tap((response) => {
          console.log("Historical data response:", response);
          console.log("Historical data count:", response.data?.length || 0);

          if (response.data && response.data.length > 0) {
            console.log("Sample historical data:", response.data.slice(0, 2));
          }

          this.selectedProcessData = response.data || [];
          this.updateProcessCharts();
          this.updateProcessStats();
          this.loading = false;
        }),
        catchError((error) => {
          console.error("Error fetching historical process data:", error);
          this.loading = false;
          this.selectedProcessData = [];
          return of(null);
        })
      )
      .subscribe();
  }

  /**
   * Select a process from the active processes table
   */
  selectProcess(process: ProcessData) {
    // Update form with selected process
    this.filterForm.patchValue({
      selectedProcess: process.pid.toString(),
    });

    // Set initial data from current active process
    this.selectedProcessData = [process];
    this.selectedProcessInfo = `${this.truncateCommand(
      process.command,
      30
    )} (PID: ${process.pid})`;

    // Update charts and stats
    this.updateProcessCharts();
    this.updateProcessStats();

    // Load historical data for this process
    this.loadHistoricalProcessData();
  }

  /**
   * Get CSS class for CPU status based on value
   */
  getCpuStatusClass(value: number): string {
    if (value > 75) return "text-danger";
    if (value > 50) return "text-warning";
    return "text-success";
  }

  /**
   * Get CSS class for Memory status based on value
   */
  getMemStatusClass(value: number): string {
    if (value > 75) return "text-danger";
    if (value > 50) return "text-warning";
    return "text-success";
  }

  /**
   * Get status for CPU progress bar
   */
  getCpuStatus(value: number): string {
    if (value > 75) return "danger";
    if (value > 50) return "warning";
    return "success";
  }

  /**
   * Get status for Memory progress bar
   */
  getMemStatus(value: number): string {
    if (value > 75) return "danger";
    if (value > 50) return "warning";
    return "success";
  }

  /**
   * Truncate command string to specified length
   */
  private truncateCommand(command: string, maxLength: number): string {
    return command.length > maxLength
      ? command.substring(0, maxLength) + "..."
      : command;
  }
}
//tempfile corrected