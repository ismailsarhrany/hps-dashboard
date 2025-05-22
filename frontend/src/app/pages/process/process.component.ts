// src/app/pages/process/process.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { MockMonitoringService, ProcessData } from '../../services/mock-monitoring.service';

@Component({
  selector: 'ngx-process',
  templateUrl: './process.component.html',
  styleUrls: ['./process.component.scss']
})
export class ProcessComponent implements OnInit, OnDestroy {
  private themeSubscription: Subscription;
  private dataSubscriptions: Subscription[] = [];
  private colors: any;
  private echartTheme: any;

  // Charts
  realtimeChartOption: any = {};
  weeklyChartOption: any = {};
  historicalChartOption: any = {};

  // Form controls
  filterForm: FormGroup;
  processes: ProcessData[] = [];
  loading = false;

  // Data stores
  realtimeProcessData: ProcessData[] = [];
  historicalProcessData: ProcessData[] = [];

  constructor(
    private theme: NbThemeService,
    private monitoringService: MockMonitoringService,
    private fb: FormBuilder
  ) {
    this.filterForm = this.fb.group({
      selectedProcess: [''],
      startDate: [''],
      endDate: ['']
    });
  }

  ngOnInit() {
    this.themeSubscription = this.theme.getJsTheme().subscribe(config => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
      this.subscribeToRealtimeData();
      this.loadWeeklyData();
    });
  }

  ngOnDestroy() {
    this.themeSubscription.unsubscribe();
    this.dataSubscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === 'dark' ? '#222b45' : '#ffffff',
      tooltip: {
        trigger: 'item',
        axisPointer: { type: 'shadow' }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category' },
      yAxis: { type: 'value' }
    };

    // Realtime Processes Chart
    this.realtimeChartOption = {
      ...baseOption,
      title: { text: 'Current Process Resource Usage' },
      tooltip: {
        formatter: (params) => `
          ${params.marker} ${params.name}<br/>
          CPU: ${params.value[1]}%<br/>
          Memory: ${params.value[2]}%
        `
      },
      dataset: { source: [] },
      series: [{
        type: 'scatter',
        symbolSize: (data) => Math.sqrt(data[2]) * 5,
        encode: {
          x: 0,
          y: 1,
          tooltip: [1, 2]
        }
      }]
    };

    // Weekly Usage Chart
    this.weeklyChartOption = {
      ...baseOption,
      title: { text: 'Process Activity Last 7 Days' },
      xAxis: { type: 'time' },
      series: [
        { name: 'CPU', type: 'line', smooth: true, color: '#3366ff' },
        { name: 'Memory', type: 'line', smooth: true, color: '#00d68f' }
      ]
    };

    // Historical Chart
    this.historicalChartOption = {
      ...baseOption,
      title: { text: 'Historical Process Usage' },
      xAxis: { type: 'time' },
      series: [{
        type: 'line',
        smooth: true,
        color: '#ff9f43'
      }]
    };
  }

  private subscribeToRealtimeData() {
    this.dataSubscriptions.push(
      this.monitoringService.getRealtimeMetricsByType('process').subscribe(processes => {
        this.realtimeProcessData = processes;
        this.updateRealtimeChart();
        this.processes = [...new Map(processes.map(p => [p.pid, p]))].slice(0, 20).map(([,p]) => p);
      })
    );
  }

  private updateRealtimeChart() {
    const source = this.realtimeProcessData.map(p => [
      p.command.substring(0, 20),
      p.cpu,
      p.mem
    ]);

    this.realtimeChartOption = {
      ...this.realtimeChartOption,
      dataset: { source },
      visualMap: {
        top: 10,
        right: 10,
        min: Math.min(...this.realtimeProcessData.map(p => p.mem)),
        max: Math.max(...this.realtimeProcessData.map(p => p.mem)),
        dimension: 2,
        inRange: { color: ['#00d68f', '#ff3d71'] }
      }
    };
  }

  private loadWeeklyData() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    this.dataSubscriptions.push(
      this.monitoringService.getHistoricalMetrics('process', startDate.toISOString(), endDate.toISOString())
        .subscribe(data => {
          this.weeklyChartOption = {
            ...this.weeklyChartOption,
            series: [{
              ...this.weeklyChartOption.series[0],
              data: data.map(d => [d.timestamp, d.cpu])
            }, {
              ...this.weeklyChartOption.series[1],
              data: data.map(d => [d.timestamp, d.mem])
            }]
          };
        })
    );
  }

  loadHistoricalProcessData() {
    if (!this.filterForm.valid) return;
    this.loading = true;
    const { selectedProcess, startDate, endDate } = this.filterForm.value;

    this.monitoringService.getHistoricalMetrics('process', startDate, endDate)
      .subscribe(data => {
        const filtered = data.filter(p => p.pid === selectedProcess);
        this.historicalProcessData = filtered;
        
        this.historicalChartOption = {
          ...this.historicalChartOption,
          series: [{
            ...this.historicalChartOption.series[0],
            data: filtered.map(p => [p.timestamp, p.cpu])
          }]
        };
        this.loading = false;
      });
  }
}
