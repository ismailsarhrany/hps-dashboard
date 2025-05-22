// src/app/pages/realtime/realtime-routing.module.ts
import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { RealtimeComponent } from './realtime.component';

const routes: Routes = [{
  path: '',
  component: RealtimeComponent,
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RealtimeRoutingModule { }