// src/app/pages/historic/historic.component.ts
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { EChartsOption } from 'echarts';
import { 
  ApiService, 
  VmstatData, 
  NetstatData, 
  IostatData,
  DateTimeRange
} from '../../services/monitoring.service';

@Component({
  selector: 'ngx-historic',
  templateUrl: './historic.component.html',
  styleUrls: ['./historic.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush // Optimize change detection
})
export class HistoricComponent implements OnInit, OnDestroy {
  dateRangeForm: FormGroup;
  loading = false;
  
  // Updated Chart Options for split charts
  cpuChartOption: EChartsOption = {};
  memoryChartOption: EChartsOption = {}; // Will only show Used Memory
  diskReadRateChartOption: EChartsOption = {};
  diskReadOpsChartOption: EChartsOption = {};
  diskWriteRateChartOption: EChartsOption = {};
  diskWriteOpsChartOption: EChartsOption = {};
  networkPacketsInChartOption: EChartsOption = {};
  networkPacketsOutChartOption: EChartsOption = {};
  networkErrorsInChartOption: EChartsOption = {};
  networkErrorsOutChartOption: EChartsOption = {};
  
  // Original Data Arrays
  vmstatData: VmstatData[] = [];
  netstatData: NetstatData[] = [];
  iostatData: IostatData[] = [];
  
  private themeSubscription: Subscription;
  private theme: any;
  private readonly MAX_DATA_POINTS = 1500; // Max points per series after downsampling

  constructor(
    private fb: FormBuilder,
    private apiService: ApiService,
    private themeService: NbThemeService,
    private cdr: ChangeDetectorRef // Inject ChangeDetectorRef
  ) {
    this.initializeDateForm();
  }

  ngOnInit(): void {
    this.themeSubscription = this.themeService.getJsTheme().subscribe(theme => {
      this.theme = theme;
      this.initializeChartOptions(); // Re-initialize options with new theme colors
      // Update charts with new theme if data exists
      if (this.vmstatData.length > 0 || this.netstatData.length > 0 || this.iostatData.length > 0) {
        this.updateAllCharts();
      }
      this.cdr.markForCheck(); // Trigger change detection
    });
    
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

  loadDefaultData(): void {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    this.dateRangeForm.patchValue({
        startDate: this.formatDateForInput(yesterday),
        startTime: now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0'),
        endDate: this.formatDateForInput(now),
        endTime: now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0')
    });

    const dateRange = this.getDateTimeRange();
    this.loadHistoricalData(dateRange);
  }

  loadHistoricalData(dateRange?: DateTimeRange): void {
    this.loading = true;
    this.cdr.markForCheck();
    
    const range = dateRange || this.getDateTimeRange();
    
    this.vmstatData = [];
    this.netstatData = [];
    this.iostatData = [];

    Promise.all([
      this.apiService.getHistoricalVmstat(range).toPromise(),
      this.apiService.getHistoricalNetstat(range).toPromise(),
      this.apiService.getHistoricalIostat(range).toPromise()
    ]).then(([vmstatResponse, netstatResponse, iostatResponse]) => {
      this.vmstatData = vmstatResponse?.data || [];
      this.netstatData = netstatResponse?.data || [];
      this.iostatData = iostatResponse?.data || [];
      
      console.log(`Fetched Data Points: vmstat=${this.vmstatData.length}, netstat=${this.netstatData.length}, iostat=${this.iostatData.length}`);

      this.updateAllCharts();
      this.loading = false;
      this.cdr.markForCheck();
    }).catch(error => {
      console.error('Error loading historical data:', error);
      this.vmstatData = [];
      this.netstatData = [];
      this.iostatData = [];
      this.updateAllCharts(); 
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  onSubmit(): void {
    if (this.dateRangeForm.valid) {
      this.loadHistoricalData();
    }
  }

  private downsample<T>(data: T[], timestampField: keyof T, valueField: keyof T, maxPoints: number): [number, number][] {
    if (!data || data.length <= maxPoints) {
        return data.map(item => [
            new Date(item[timestampField] as any).getTime(),
            (item[valueField] as number) || 0
        ]);
    }

    const sampledData: [number, number][] = [];
    const totalPoints = data.length;
    const bucketSize = Math.ceil(totalPoints / maxPoints);

    for (let i = 0; i < totalPoints; i += bucketSize) {
        const bucket = data.slice(i, i + bucketSize);
        if (bucket.length === 0) continue;

        const firstPoint = bucket[0];
        const timestamp = new Date(firstPoint[timestampField] as any).getTime();
        const sum = bucket.reduce((acc, curr) => acc + ((curr[valueField] as number) || 0), 0);
        const value = sum / bucket.length;

        sampledData.push([timestamp, value]);
    }

    if (totalPoints > 0 && (sampledData.length === 0 || sampledData[sampledData.length - 1][0] !== new Date(data[totalPoints - 1][timestampField] as any).getTime())) {
        const lastPoint = data[totalPoints - 1];
        sampledData.push([
            new Date(lastPoint[timestampField] as any).getTime(),
            (lastPoint[valueField] as number) || 0
        ]);
    }

    console.log(`Downsampled ${String(valueField)} from ${totalPoints} to ${sampledData.length} points`);
    return sampledData;
}


  private getThemeColors(): any {
    if (!this.theme) {
      return {
        primary: '#3366ff',
        success: '#00d68f',
        info: '#0095ff',
        warning: '#ffaa00',
        danger: '#ff3d71',
        textColor: '#8f9bb3',
        backgroundColor: '#ffffff',
        borderColor: '#edf1f7'
      };
    }
    const colors = this.theme.variables;
    return {
      primary: colors.colorPrimary || colors.primary,
      success: colors.colorSuccess || colors.success,
      info: colors.colorInfo || colors.info,
      warning: colors.colorWarning || colors.warning,
      danger: colors.colorDanger || colors.danger,
      textColor: colors.textBasicColor || colors.fgText,
      backgroundColor: colors.cardBackgroundColor || colors.bg,
      borderColor: colors.borderBasicColor || colors.separator
    };
  }

  private initializeChartOptions(): void {
    const colors = this.getThemeColors();
    
    const baseConfig: EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
        textStyle: { color: colors.textColor, fontSize: 12 },
        axisPointer: { type: 'cross', label: { backgroundColor: colors.primary } }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textColor, fontSize: 11 },
        splitLine: { show: true, lineStyle: { color: colors.borderColor, opacity: 0.3 } }
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { start: 0, end: 100, handleIcon: 'M10.7,11.9v-1.3H9.3v1.3c-4.9,0.3-8.8,4.4-8.8,9.4c0,5,3.9,9.1,8.8,9.4v1.3h1.3v-1.3c4.9-0.3,8.8-4.4,8.8-9.4C19.5,16.3,15.6,12.2,10.7,11.9z M13.3,24.4H6.7V23h6.6V24.4z M13.3,19.6H6.7v-1.4h6.6V19.6z', handleSize: '80%', handleStyle: { color: '#fff', shadowBlur: 3, shadowColor: 'rgba(0, 0, 0, 0.6)', shadowOffsetX: 2, shadowOffsetY: 2 }, textStyle: { color: colors.textColor }, borderColor: colors.borderColor }
      ],
      animation: false,
    };

    // --- Define Series --- 
    const cpuUserSeries = { name: 'User CPU', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const cpuSystemSeries = { name: 'System CPU', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const memoryUsedSeries = { name: 'Used Memory', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, areaStyle: { opacity: 0.3 }, data: [] };
    const diskReadRateSeries = { name: 'Read Rate (KB/s)', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const diskReadOpsSeries = { name: 'Read Operations', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const diskWriteRateSeries = { name: 'Write Rate (KB/s)', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const diskWriteOpsSeries = { name: 'Write Operations', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const netPacketsInSeries = { name: 'Packets In', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const netPacketsOutSeries = { name: 'Packets Out', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const netErrorsInSeries = { name: 'Errors In', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };
    const netErrorsOutSeries = { name: 'Errors Out', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2 }, data: [] };

    // --- Initialize Chart Options --- 

    // CPU Chart (User & System only)
    this.cpuChartOption = {
      ...baseConfig,
      color: [colors.primary, colors.success],
      legend: { data: [cpuUserSeries.name, cpuSystemSeries.name], textStyle: { color: colors.textColor }, top: 0 },
      yAxis: {
        type: 'value',
        max: 100,
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textColor, formatter: '{value}%', fontSize: 11 },
        splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } }
      },
      series: [cpuUserSeries, cpuSystemSeries]
    };

    // Memory Chart (Used only)
    this.memoryChartOption = {
      ...baseConfig,
      color: [colors.success],
      legend: { data: [memoryUsedSeries.name], textStyle: { color: colors.textColor }, top: 0 },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: colors.borderColor } },
        axisLabel: { color: colors.textColor, formatter: '{value} MB', fontSize: 11 },
        splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } }
      },
      series: [memoryUsedSeries]
    };

    // Disk Read Rate Chart
    this.diskReadRateChartOption = {
      ...baseConfig,
      color: [colors.info],
      legend: { data: [diskReadRateSeries.name], textStyle: { color: colors.textColor }, top: 0 },
      yAxis: { 
          type: 'value', 
          name: 'KB/s', 
          axisLine: { lineStyle: { color: colors.borderColor } }, 
          axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
          splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
      },
      series: [diskReadRateSeries]
    };

    // Disk Read Ops Chart
    this.diskReadOpsChartOption = {
        ...baseConfig,
        color: [colors.primary],
        legend: { data: [diskReadOpsSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'Ops', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [diskReadOpsSeries]
    };

    // Disk Write Rate Chart
    this.diskWriteRateChartOption = {
        ...baseConfig,
        color: [colors.warning],
        legend: { data: [diskWriteRateSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'KB/s', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [diskWriteRateSeries]
    };

    // Disk Write Ops Chart
    this.diskWriteOpsChartOption = {
        ...baseConfig,
        color: [colors.danger],
        legend: { data: [diskWriteOpsSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'Ops', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [diskWriteOpsSeries]
    };

    // Network Packets In Chart
    this.networkPacketsInChartOption = {
        ...baseConfig,
        color: [colors.primary],
        legend: { data: [netPacketsInSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'Packets', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [netPacketsInSeries]
    };

    // Network Packets Out Chart
    this.networkPacketsOutChartOption = {
        ...baseConfig,
        color: [colors.success],
        legend: { data: [netPacketsOutSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'Packets', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [netPacketsOutSeries]
    };

    // Network Errors In Chart
    this.networkErrorsInChartOption = {
        ...baseConfig,
        color: [colors.danger],
        legend: { data: [netErrorsInSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'Errors', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [netErrorsInSeries]
    };

    // Network Errors Out Chart
    this.networkErrorsOutChartOption = {
        ...baseConfig,
        color: [colors.warning],
        legend: { data: [netErrorsOutSeries.name], textStyle: { color: colors.textColor }, top: 0 },
        yAxis: { 
            type: 'value', 
            name: 'Errors', 
            axisLine: { lineStyle: { color: colors.borderColor } }, 
            axisLabel: { color: colors.textColor, formatter: '{value}', fontSize: 11 }, 
            splitLine: { lineStyle: { color: colors.borderColor, opacity: 0.3 } } 
        },
        series: [netErrorsOutSeries]
    };
  }

  private updateAllCharts(): void {
    this.cpuChartOption = this.getUpdatedCpuChartOption();
    this.memoryChartOption = this.getUpdatedMemoryChartOption();
    this.diskReadRateChartOption = this.getUpdatedDiskReadRateChartOption();
    this.diskReadOpsChartOption = this.getUpdatedDiskReadOpsChartOption();
    this.diskWriteRateChartOption = this.getUpdatedDiskWriteRateChartOption();
    this.diskWriteOpsChartOption = this.getUpdatedDiskWriteOpsChartOption();
    this.networkPacketsInChartOption = this.getUpdatedNetworkPacketsInChartOption();
    this.networkPacketsOutChartOption = this.getUpdatedNetworkPacketsOutChartOption();
    this.networkErrorsInChartOption = this.getUpdatedNetworkErrorsInChartOption();
    this.networkErrorsOutChartOption = this.getUpdatedNetworkErrorsOutChartOption();
  }

  // --- Update individual chart options immutably --- 

  private getUpdatedCpuChartOption(): EChartsOption {
    const cpuUserData = this.downsample(this.vmstatData, 'timestamp', 'us', this.MAX_DATA_POINTS);
    const cpuSysData = this.downsample(this.vmstatData, 'timestamp', 'sy', this.MAX_DATA_POINTS);

    return {
      ...this.cpuChartOption,
      series: [
        { ...this.cpuChartOption.series[0], data: cpuUserData },
        { ...this.cpuChartOption.series[1], data: cpuSysData }
      ]
    };
  }

  private getUpdatedMemoryChartOption(): EChartsOption {
    const memUsedData = this.downsample(this.vmstatData, 'timestamp', 'avm', this.MAX_DATA_POINTS).map(p => [p[0], p[1] / 1024]); // Convert to MB

    return {
      ...this.memoryChartOption,
      series: [
        { ...this.memoryChartOption.series[0], data: memUsedData }
      ]
    };
  }

  private getUpdatedDiskReadRateChartOption(): EChartsOption {
    const readRateData = this.downsample(this.iostatData, 'timestamp', 'kb_read', this.MAX_DATA_POINTS);
    return { ...this.diskReadRateChartOption, series: [{ ...this.diskReadRateChartOption.series[0], data: readRateData }] };
  }

  private getUpdatedDiskReadOpsChartOption(): EChartsOption {
    const readOpsData = this.downsample(this.iostatData, 'timestamp', 'tps', this.MAX_DATA_POINTS); // Assuming tps represents read ops
    return { ...this.diskReadOpsChartOption, series: [{ ...this.diskReadOpsChartOption.series[0], data: readOpsData }] };
  }

  private getUpdatedDiskWriteRateChartOption(): EChartsOption {
    const writeRateData = this.downsample(this.iostatData, 'timestamp', 'kb_wrtn', this.MAX_DATA_POINTS);
    return { ...this.diskWriteRateChartOption, series: [{ ...this.diskWriteRateChartOption.series[0], data: writeRateData }] };
  }

  private getUpdatedDiskWriteOpsChartOption(): EChartsOption {
    const writeOpsData = this.downsample(this.iostatData, 'timestamp', 'tps', this.MAX_DATA_POINTS); // Assuming tps represents write ops
    return { ...this.diskWriteOpsChartOption, series: [{ ...this.diskWriteOpsChartOption.series[0], data: writeOpsData }] };
  }

  private getUpdatedNetworkPacketsInChartOption(): EChartsOption {
    const packetsInData = this.downsample(this.netstatData, 'timestamp', 'ipkts', this.MAX_DATA_POINTS);
    return { ...this.networkPacketsInChartOption, series: [{ ...this.networkPacketsInChartOption.series[0], data: packetsInData }] };
  }

  private getUpdatedNetworkPacketsOutChartOption(): EChartsOption {
    const packetsOutData = this.downsample(this.netstatData, 'timestamp', 'opkts', this.MAX_DATA_POINTS);
    return { ...this.networkPacketsOutChartOption, series: [{ ...this.networkPacketsOutChartOption.series[0], data: packetsOutData }] };
  }

  private getUpdatedNetworkErrorsInChartOption(): EChartsOption {
    const errorsInData = this.downsample(this.netstatData, 'timestamp', 'ierrs', this.MAX_DATA_POINTS);
    return { ...this.networkErrorsInChartOption, series: [{ ...this.networkErrorsInChartOption.series[0], data: errorsInData }] };
  }

  private getUpdatedNetworkErrorsOutChartOption(): EChartsOption {
    const errorsOutData = this.downsample(this.netstatData, 'timestamp', 'oerrs', this.MAX_DATA_POINTS);
    return { ...this.networkErrorsOutChartOption, series: [{ ...this.networkErrorsOutChartOption.series[0], data: errorsOutData }] };
  }

  // --- Quick Date Range Selection Methods --- 
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

