// src/app/pages/prediction/prediction.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NbThemeService } from '@nebular/theme';
import { MockMonitoringService } from '../../services/mock-monitoring.service';

@Component({
  selector: 'ngx-prediction',
  templateUrl: './prediction.component.html',
  styleUrls: ['./prediction.component.scss']
})
export class PredictionComponent implements OnInit, OnDestroy {
  private themeSubscription: Subscription;
  private dataSubscription: Subscription;
  colors: any;
  echartTheme: any;

  // Charts
  predictionChartOption: any = {};
  anomalyChartOption: any = {};

  // Form
  predictionForm: FormGroup;
  loading = false;
  confidenceLevel = 0;
  anomalies: any[] = [];

  constructor(
    private theme: NbThemeService,
    private monitoringService: MockMonitoringService,
    private fb: FormBuilder
  ) {
    this.predictionForm = this.fb.group({
      predictionPeriod: ['7'],
      confidenceThreshold: ['85']
    });
  }

  ngOnInit() {
    this.themeSubscription = this.theme.getJsTheme().subscribe(config => {
      this.colors = config.variables;
      this.echartTheme = config.name;
      this.initializeCharts();
      this.loadPredictionData();
      this.loadAnomalies();
    });
  }

  ngOnDestroy() {
    this.themeSubscription.unsubscribe();
    if (this.dataSubscription) this.dataSubscription.unsubscribe();
  }

  private initializeCharts() {
    const baseOption = {
      backgroundColor: this.echartTheme === 'dark' ? '#222b45' : '#ffffff',
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'time' },
      yAxis: { type: 'value' }
    };

    // Prediction Chart
    this.predictionChartOption = {
      ...baseOption,
      title: { text: 'Resource Usage Prediction' },
      series: [
        {
          name: 'Prediction',
          type: 'line',
          smooth: true,
          itemStyle: { color: '#3366ff' },
          areaStyle: { color: '#3366ff', opacity: 0.1 }
        },
        {
          name: 'Confidence Band',
          type: 'line',
          smooth: true,
          itemStyle: { opacity: 0 },
          areaStyle: { color: '#3366ff', opacity: 0.2 },
          symbol: 'none'
        }
      ]
    };

    // Anomaly Chart
    this.anomalyChartOption = {
      ...baseOption,
      title: { text: 'Anomaly Detection' },
      series: [
        {
          name: 'Metric',
          type: 'line',
          smooth: true,
          itemStyle: { color: '#00d68f' }
        },
        {
          name: 'Anomalies',
          type: 'scatter',
          symbolSize: 12,
          itemStyle: { color: '#ff3d71' }
        }
      ]
    };
  }

  loadPredictionData() {
    this.loading = true;
    const days = parseInt(this.predictionForm.value.predictionPeriod);
    this.confidenceLevel = parseInt(this.predictionForm.value.confidenceThreshold);

    // Generate mock prediction data
    const { predictions, confidenceBand } = this.monitoringService.generatePredictions(days);
    
    this.predictionChartOption = {
      ...this.predictionChartOption,
      series: [
        {
          ...this.predictionChartOption.series[0],
          data: predictions
        },
        {
          ...this.predictionChartOption.series[1],
          data: confidenceBand
        }
      ]
    };

    this.loading = false;
  }

  loadAnomalies() {
    this.anomalies = this.monitoringService.getAnomalies();
    
    const anomalyData = this.anomalies.map(a => [a.timestamp, a.value]);
    const metricData = this.anomalies.map(a => [a.timestamp, a.metricValue]);

    this.anomalyChartOption = {
      ...this.anomalyChartOption,
      series: [
        {
          ...this.anomalyChartOption.series[0],
          data: metricData
        },
        {
          ...this.anomalyChartOption.series[1],
          data: anomalyData
        }
      ]
    };
  }
}

