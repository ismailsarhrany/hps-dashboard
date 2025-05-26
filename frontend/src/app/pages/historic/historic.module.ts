// src/app/pages/historic/historic.module.ts
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
  NbLayoutModule
} from '@nebular/theme';

// NGX Charts Modules
import { NgxChartsModule } from '@swimlane/ngx-charts';

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
    
    // Nebular Modules
    NbCardModule,
    NbButtonModule,
    NbInputModule,
    NbIconModule,
    NbSpinnerModule,
    NbLayoutModule,
    
    // NGX Charts
    NgxChartsModule
  ]
})
export class HistoricModule { }