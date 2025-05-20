import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { HistoricComponent } from './historic.component';

const routes: Routes = [{ path: '', component: HistoricComponent }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class HistoricRoutingModule { }