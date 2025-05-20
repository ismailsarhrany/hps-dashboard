import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { RealtimeRoutingModule } from './realtime-routing.module';
import { RealtimeComponent } from './realtime.component';
import { NgxChartsModule } from '@swimlane/ngx-charts'; // You may need to install this

@NgModule({
  declarations: [
    RealtimeComponent
  ],
  imports: [
    CommonModule,
    RealtimeRoutingModule,
    NgxChartsModule
  ]
})
export class RealtimeModule { }