import { NgModule } from '@angular/core';
import { NbMenuModule } from '@nebular/theme';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';

import { ThemeModule } from '../@theme/theme.module';
import { PagesComponent } from './pages.component';

import { PagesRoutingModule } from './pages-routing.module';
import { MiscellaneousModule } from './miscellaneous/miscellaneous.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HistoricModule } from './historic/historic.module';
import { ProcessModule } from './process/process.module';
import { PredictionModule } from './prediction/prediction.module';
import { AnomalyModule } from './anomaly/anomaly.module';


import { ApiService } from '../services/monitoring.service';
import { ServerTabsComponent } from './server-tabs/server-tabs.component';
import { ServerDashboardComponent } from './server-dashboard/server-dashboard.component';

@NgModule({
  imports: [
    PagesRoutingModule,
    ThemeModule,
    NbMenuModule,
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
    ServerTabsComponent,
    ServerDashboardComponent,

  ],
  providers: [
    ApiService
  ]
})
export class PagesModule {
}
