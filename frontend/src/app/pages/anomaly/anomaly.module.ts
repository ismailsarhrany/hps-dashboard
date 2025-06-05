// src/app/pages/anomaly.module.ts - Alternative approach
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

// Nebular Modules
import {
  NbCardModule,
  NbButtonModule,
  NbInputModule,
  NbIconModule,
  NbSpinnerModule,
  NbLayoutModule,
  NbTooltipModule,
  NbAlertModule
} from '@nebular/theme';

// Simple ECharts Module import (no configuration)
import { NgxEchartsModule } from 'ngx-echarts';

// Theme Module
import { ThemeModule } from '../../@theme/theme.module';

// Components
import { AnomalyComponent } from './anomaly.component';
import { AnomalyRoutingModule } from './anomaly-routing.module';

@NgModule({
  declarations: [
    AnomalyComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AnomalyRoutingModule,
    ThemeModule,
    
    // Nebular Modules
    NbCardModule,
    NbButtonModule,
    NbInputModule,
    NbIconModule,
    NbSpinnerModule,
    NbLayoutModule,
    NbTooltipModule,
    NbAlertModule,
    
    // ECharts Module - Simple import
    NgxEchartsModule
  ]
})
export class AnomalyModule { }