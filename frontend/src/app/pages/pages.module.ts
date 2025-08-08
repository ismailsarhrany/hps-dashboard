import { NgModule } from '@angular/core';
import { NbMenuModule } from '@nebular/theme';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';

import { ThemeModule } from '../@theme/theme.module';
import { PagesComponent } from './pages.component';
import { PagesRoutingModule } from './pages-routing.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HistoricModule } from './historic/historic.module';
import { ProcessModule } from './process/process.module';
import { PredictionModule } from './prediction/prediction.module';
import { AnomalyModule } from './anomaly/anomaly.module';
import { ApiService } from '../services/monitoring.service';
import { ServerTabsComponent } from './server-tabs/server-tabs.component';
import{OracleModule}from './oracle/oracle.module';
@NgModule({
  imports: [
    PagesRoutingModule,
    ThemeModule,
    NbMenuModule,
    CommonModule,
    HttpClientModule,
    RealtimeModule,
    HistoricModule,
    ProcessModule,
    PredictionModule,
    AnomalyModule,
    OracleModule,
  ],
  declarations: [
    PagesComponent,
    ServerTabsComponent,
  ],
  providers: [
    ApiService
  ]
})
export class PagesModule {}