// src/app/pages/realtime/realtime.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsModule } from 'ngx-echarts';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { 
  NbCardModule, 
  NbProgressBarModule, 
  NbBadgeModule, 
  NbIconModule,
  NbSpinnerModule,
  NbButtonModule,
  NbTooltipModule
} from '@nebular/theme';

import { ThemeModule } from '../../@theme/theme.module';
import { RealtimeRoutingModule } from './realtime-routing.module';
import { RealtimeComponent } from './realtime.component';

@NgModule({
  imports: [
    CommonModule,
    ThemeModule,
    RealtimeRoutingModule,
    NgxEchartsModule,
    NgxChartsModule,
    NbCardModule,
    NbProgressBarModule,
    NbBadgeModule,
    NbIconModule,
    NbSpinnerModule,
    NbButtonModule,
    NbTooltipModule,
  ],
  declarations: [
    RealtimeComponent,
  ],
})
export class RealtimeModule { }