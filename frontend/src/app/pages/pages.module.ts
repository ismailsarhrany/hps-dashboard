import { NgModule } from '@angular/core';
import { NbMenuModule } from '@nebular/theme';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';

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
import { AnomalyModule } from './anomaly/anomaly.module';


import { ApiService } from '../services/monitoring.service';

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
    RealtimeModule,
    HistoricModule,
    ProcessModule,
    PredictionModule,
    AnomalyModule
  ],
  declarations: [
    PagesComponent,

  ],
  providers: [
    ApiService
  ]
})
export class PagesModule {
}
