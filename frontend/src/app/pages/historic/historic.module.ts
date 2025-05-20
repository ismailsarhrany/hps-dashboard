import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { HistoricRoutingModule } from './historic-routing.module';
import { HistoricComponent } from './historic.component';
import { NgxChartsModule } from '@swimlane/ngx-charts'; // You may need to install this

@NgModule({
  declarations: [
    HistoricComponent
  ],
  imports: [
    CommonModule,
    HistoricRoutingModule,
    NgxChartsModule
  ]
})
export class HistoricModule { }