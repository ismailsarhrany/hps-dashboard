// src/app/pages/historic/historic.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgxEchartsModule } from 'ngx-echarts';
import {
  NbCardModule,
  NbDatepickerModule,
  NbButtonModule,
  NbIconModule,
  NbInputModule,
  NbFormFieldModule,
  NbLayoutModule,
  NbAlertModule,
  NbTabsetModule,
  NbSpinnerModule
} from '@nebular/theme';

import { ThemeModule } from '../../@theme/theme.module';
import { HistoricRoutingModule } from './historic-routing.module';
import { HistoricComponent } from './historic.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ThemeModule,
    NbFormFieldModule,
    NbLayoutModule,
    NbAlertModule,
    NbTabsetModule,
    NbSpinnerModule,
    HistoricRoutingModule,
    NgxEchartsModule,
    NbCardModule,
    NbDatepickerModule.forRoot(),
    NbButtonModule,
    NbIconModule,
    NbInputModule
  ],
  declarations: [HistoricComponent]
})
export class HistoricModule { }