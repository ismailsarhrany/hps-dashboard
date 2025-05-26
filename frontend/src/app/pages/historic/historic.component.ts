// src/app/pages/historic/historic.component.ts - Improved version
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { 
  ApiService, 
  VmstatData, 
  NetstatData, 
  IostatData,
  DateTimeRange
} from '../../services/monitoring.service';

// NGX Charts data interfaces
interface ChartDataPoint {
  name: string | Date;
  value: number;
}

interface ChartSeries {
  name: string;
  series: ChartDataPoint[];
}

@Component({
  selector: 'ngx-historic',
  templateUrl: './historic.component.html',
  styleUrls: ['./historic.component.scss']
})
export class HistoricComponent implements OnInit, OnDestroy {
  dateRangeForm: FormGroup;
  loading = false;
  
  // NGX Charts Data
  cpuChartData: ChartSeries[] = [];
  memoryChartData: ChartSeries[] = [];
  diskReadChartData: ChartSeries[] = [];
  diskWriteChartData: ChartSeries[] = [];
  networkPacketsChartData: ChartSeries[] = [];
  networkErrorsChartData: ChartSeries[] = [];
  
  // // Improved Chart View Dimensions - more reasonable sizes
  // fullChartView: [number, number] = [900, 350];
  // halfChartView: [number, number] = [440, 300];
  
  // Chart Options
  showXAxis = true;
  showYAxis = true;
  gradient = false;
  showLegend = true;
  showXAxisLabel = true;
  showYAxisLabel = true;
  timeline = true;
  autoScale = true;
  
  // Chart Labels
  cpuChartYAxisLabel = 'CPU Usage (%)';
  cpuChartXAxisLabel = 'Time';
  memoryChartYAxisLabel = 'Memory (MB)';
  memoryChartXAxisLabel = 'Time';
  diskReadChartYAxisLabel = 'Read Rate (KB/s)';
  diskReadChartXAxisLabel = 'Time';
  diskWriteChartYAxisLabel = 'Write Rate (KB/s)';
  diskWriteChartXAxisLabel = 'Time';
  networkPacketsChartYAxisLabel = 'Packets/sec';
  networkPacketsChartXAxisLabel = 'Time';
  networkErrorsChartYAxisLabel = 'Errors/sec';
  networkErrorsChartXAxisLabel = 'Time';
  
  // Improved Color Schemes with better contrast
  cpuColorScheme = {
    domain: ['#2E7D32', '#1976D2', '#D32F2F'] // Green, Blue, Red
  };
  
  memoryColorScheme = {
    domain: ['#FF6F00', '#7B1FA2'] // Orange, Purple
  };
  
  diskReadColorScheme = {
    domain: ['#1976D2'] // Blue
  };
  
  diskWriteColorScheme = {
    domain: ['#F57C00'] // Orange
  };
  
  networkPacketsColorScheme = {
    domain: ['#388E3C', '#1976D2'] // Green, Blue
  };
  
  networkErrorsColorScheme = {
    domain: ['#D32F2F', '#FF6F00'] // Red, Orange
  };
  
  // Data Arrays
  vmstatData: VmstatData[] = [];
  netstatData: NetstatData[] = [];
  iostatData: IostatData[] = [];
  
  private themeSubscription: Subscription;

  constructor(
    private fb: FormBuilder,
    private apiService: ApiService,
    private themeService: NbThemeService
  ) {
    this.initializeDateForm();
  }

  ngOnInit(): void {
    this.themeSubscription = this.themeService.getJsTheme().subscribe(theme => {
      this.updateColorSchemes(theme.variables);
    });
    
    // Load data for the last 24 hours by default
    this.loadDefaultData();
  }

  ngOnDestroy(): void {
    if (this.themeSubscription) {
      this.themeSubscription.unsubscribe();
    }
  }

  private initializeDateForm(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    this.dateRangeForm = this.fb.group({
      startDate: [this.formatDateForInput(yesterday), Validators.required],
      startTime: ['00:00', Validators.required],
      endDate: [this.formatDateForInput(now), Validators.required],
      endTime: ['23:59', Validators.required]
    });
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getDateTimeRange(): DateTimeRange {
    const form = this.dateRangeForm.value;
    const startDateTime = `${form.startDate}T${form.startTime}:00`;
    const endDateTime = `${form.endDate}T${form.endTime}:00`;
    
    return {
      start: startDateTime,
      end: endDateTime
    };
  }

  private updateColorSchemes(colors: any): void {
    // Use theme colors but maintain good contrast and visibility
    this.cpuColorScheme = {
      domain: [colors.success, colors.primary, colors.danger]
    };
    
    this.memoryColorScheme = {
      domain: [colors.warning, colors.info]
    };
    
    this.diskReadColorScheme = {
      domain: [colors.primary]
    };
    
    this.diskWriteColorScheme = {
      domain: [colors.warning]
    };
    
    this.networkPacketsColorScheme = {
      domain: [colors.success, colors.primary]
    };
    
    this.networkErrorsColorScheme = {
      domain: [colors.danger, colors.warning]
    };
  }

  loadDefaultData(): void {
    const dateRange = this.apiService.getDateRange(1);
    this.loadHistoricalData(dateRange);
  }

  loadHistoricalData(dateRange?: DateTimeRange): void {
    this.loading = true;
    
    const range = dateRange || this.getDateTimeRange();
    
    // Fetch all required data
    Promise.all([
      this.apiService.getHistoricalVmstat(range).toPromise(),
      this.apiService.getHistoricalNetstat(range).toPromise(),
      this.apiService.getHistoricalIostat(range).toPromise()
    ]).then(([vmstatResponse, netstatResponse, iostatResponse]) => {
      this.vmstatData = vmstatResponse?.data || [];
      this.netstatData = netstatResponse?.data || [];
      this.iostatData = iostatResponse?.data || [];
      
      this.updateAllCharts();
      this.loading = false;
    }).catch(error => {
      console.error('Error loading historical data:', error);
      this.loading = false;
    });
  }

  onSubmit(): void {
    if (this.dateRangeForm.valid) {
      this.loadHistoricalData();
    }
  }

  private updateAllCharts(): void {
    this.updateCpuChart();
    this.updateMemoryChart();
    this.updateDiskCharts();
    this.updateNetworkCharts();
  }

  private updateCpuChart(): void {
    const userCpuSeries: ChartDataPoint[] = [];
    const systemCpuSeries: ChartDataPoint[] = [];
    const idleCpuSeries: ChartDataPoint[] = [];
    
    this.vmstatData.forEach(item => {
      const timestamp = new Date(item.timestamp);
      
      userCpuSeries.push({
        name: timestamp,
        value: item.us || 0
      });
      
      systemCpuSeries.push({
        name: timestamp,
        value: item.sy || 0
      });
      
      idleCpuSeries.push({
        name: timestamp,
        value: item.idle || 0
      });
    });

    this.cpuChartData = [
      {
        name: 'User CPU',
        series: userCpuSeries
      },
      {
        name: 'System CPU',
        series: systemCpuSeries
      },
      {
        name: 'Idle CPU',
        series: idleCpuSeries
      }
    ];
  }

  private updateMemoryChart(): void {
    const usedMemorySeries: ChartDataPoint[] = [];
    const freeMemorySeries: ChartDataPoint[] = [];
    
    this.vmstatData.forEach(item => {
      const timestamp = new Date(item.timestamp);
      
      usedMemorySeries.push({
        name: timestamp,
        value: Math.round((item.avm || 0) / 1024) // Convert to MB
      });
      
      freeMemorySeries.push({
        name: timestamp,
        value: Math.round((item.fre || 0) / 1024) // Convert to MB
      });
    });

    this.memoryChartData = [
      {
        name: 'Used Memory',
        series: usedMemorySeries
      },
      {
        name: 'Free Memory',
        series: freeMemorySeries
      }
    ];
  }

  private updateDiskCharts(): void {
    const readRateSeries: ChartDataPoint[] = [];
    const writeRateSeries: ChartDataPoint[] = [];
    
    this.iostatData.forEach(item => {
      const timestamp = new Date(item.timestamp);
      
      readRateSeries.push({
        name: timestamp,
        value: item.kb_read || 0
      });
      
      writeRateSeries.push({
        name: timestamp,
        value: item.kb_wrtn || 0
      });
    });

    this.diskReadChartData = [
      {
        name: 'Read Rate',
        series: readRateSeries
      }
    ];

    this.diskWriteChartData = [
      {
        name: 'Write Rate',
        series: writeRateSeries
      }
    ];
  }

  private updateNetworkCharts(): void {
    const packetsInSeries: ChartDataPoint[] = [];
    const packetsOutSeries: ChartDataPoint[] = [];
    const errorsInSeries: ChartDataPoint[] = [];
    const errorsOutSeries: ChartDataPoint[] = [];
    
    this.netstatData.forEach(item => {
      const timestamp = new Date(item.timestamp);
      
      packetsInSeries.push({
        name: timestamp,
        value: item.ipkts || 0
      });
      
      packetsOutSeries.push({
        name: timestamp,
        value: item.opkts || 0
      });
      
      errorsInSeries.push({
        name: timestamp,
        value: item.ierrs || 0
      });
      
      errorsOutSeries.push({
        name: timestamp,
        value: item.oerrs || 0
      });
    });

    this.networkPacketsChartData = [
      {
        name: 'Packets In',
        series: packetsInSeries
      },
      {
        name: 'Packets Out',
        series: packetsOutSeries
      }
    ];

    this.networkErrorsChartData = [
      {
        name: 'Errors In',
        series: errorsInSeries
      },
      {
        name: 'Errors Out',
        series: errorsOutSeries
      }
    ];
  }

  // Event handlers for NGX Charts
  onSelect(data: any): void {
    console.log('Item clicked', JSON.parse(JSON.stringify(data)));
  }

  onActivate(data: any): void {
    console.log('Activate', JSON.parse(JSON.stringify(data)));
  }

  onDeactivate(data: any): void {
    console.log('Deactivate', JSON.parse(JSON.stringify(data)));
  }

  // Custom value formatting for tooltips
  cpuValueFormatting = (value: number) => `${value.toFixed(1)}%`;
  memoryValueFormatting = (value: number) => `${value.toFixed(0)} MB`;
  diskValueFormatting = (value: number) => `${value.toFixed(2)} KB/s`;
  networkValueFormatting = (value: number) => `${value.toFixed(0)}`;

  // Custom axis formatting
  dateTickFormatting = (value: any) => {
    const date = new Date(value);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  // Quick Date Range Selection Methods
  selectLast24Hours(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(yesterday),
      startTime: now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0'),
      endDate: this.formatDateForInput(now),
      endTime: now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0')
    });
    
    this.loadHistoricalData();
  }

  selectLastWeek(): void {
    const now = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(lastWeek),
      startTime: '00:00',
      endDate: this.formatDateForInput(now),
      endTime: '23:59'
    });
    
    this.loadHistoricalData();
  }

  selectLastMonth(): void {
    const now = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(lastMonth),
      startTime: '00:00',
      endDate: this.formatDateForInput(now),
      endTime: '23:59'
    });
    
    this.loadHistoricalData();
  }

  selectToday(): void {
    const today = new Date();
    
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(today),
      startTime: '00:00',
      endDate: this.formatDateForInput(today),
      endTime: '23:59'
    });
    
    this.loadHistoricalData();
  }

  selectYesterday(): void {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    this.dateRangeForm.patchValue({
      startDate: this.formatDateForInput(yesterday),
      startTime: '00:00',
      endDate: this.formatDateForInput(yesterday),
      endTime: '23:59'
    });
    
    this.loadHistoricalData();
  }
}

