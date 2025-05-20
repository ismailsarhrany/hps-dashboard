import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { PredictionRoutingModule } from './prediction-routing.module';
import { PredictionComponent } from './prediction.component';


@NgModule({
  declarations: [
    PredictionComponent
  ],
  imports: [
    CommonModule,
    PredictionRoutingModule
  ]
})
export class PredictionModule { }
