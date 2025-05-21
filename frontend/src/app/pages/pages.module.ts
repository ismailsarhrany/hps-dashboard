import { NgModule } from '@angular/core';
import { NbMenuModule } from '@nebular/theme';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { NgChartsModule } from 'ng2-charts';

import { ThemeModule } from '../@theme/theme.module';
import { PagesComponent } from './pages.component';
import { DashboardModule } from './dashboard/dashboard.module';
import { ECommerceModule } from './e-commerce/e-commerce.module';
import { PagesRoutingModule } from './pages-routing.module';
import { MiscellaneousModule } from './miscellaneous/miscellaneous.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HistoricModule } from './historic/historic.module';
import { ProcessModule } from './process/process.module';
import { PredictionModule } from './prediction/prediction.module';


import { MockMonitoringService } from '../services/mock-monitoring.service';
@NgModule({
  imports: [
    PagesRoutingModule,
    ThemeModule,
    NbMenuModule,
    DashboardModule,
    ECommerceModule,
    MiscellaneousModule,
    CommonModule,
    HttpClientModule,
    PagesRoutingModule,
    RealtimeModule, // Changed from RealtimeComponent
    HistoricModule,
    ProcessModule,
    PredictionModule,
    NgChartsModule // Changed from BaseChartDirective
  ],
  declarations: [
    PagesComponent,
  ],
  providers: [
    MockMonitoringService
  ]
})
export class PagesModule { }