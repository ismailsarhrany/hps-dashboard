import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RealtimeRoutingModule } from './realtime-routing.module';
import { RealtimeComponent } from './realtime.component';
import { NgChartsModule } from 'ng2-charts';

@NgModule({
  declarations: [RealtimeComponent],
  imports: [
    CommonModule,
    RealtimeRoutingModule,
    NgChartsModule
  ],
  exports: [RealtimeComponent] // Add this line
})
export class RealtimeModule { }