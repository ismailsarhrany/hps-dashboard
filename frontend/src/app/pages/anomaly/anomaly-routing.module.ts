// src/app/pages/historic/historic-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AnomalyComponent } from './anomaly.component';

const routes: Routes = [
  {
    path: '',
    component: AnomalyComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AnomalyRoutingModule { }