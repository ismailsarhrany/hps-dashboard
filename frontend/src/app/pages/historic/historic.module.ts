// src/app/pages/historic/historic.module.ts - Alternative approach
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
import { HistoricComponent } from './historic.component';
import { HistoricRoutingModule } from './historic-routing.module';

@NgModule({
  declarations: [
    HistoricComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HistoricRoutingModule,
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
export class HistoricModule { }