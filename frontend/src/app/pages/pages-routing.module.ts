import { RouterModule, Routes } from '@angular/router';
import { NgModule } from '@angular/core';

import { PagesComponent } from './pages.component';

const routes: Routes = [{
  path: '',
  component: PagesComponent,
  children: [
    {
      path: 'realtime',
      loadChildren: () => import('./realtime/realtime.module')
        .then(m => m.RealtimeModule)
    },
    {
      path: 'historic',
      loadChildren: () => import('./historic/historic.module')
        .then(m => m.HistoricModule)
    },
    {
      path: 'process',
      loadChildren: () => import('./process/process.module')
        .then(m => m.ProcessModule)
    },
    // {
    //   path: 'prediction',
    //   loadChildren: () => import('./prediction/prediction.module')
    //     .then(m => m.PredictionModule)
    // },
    {
      path: 'anomaly',
      loadChildren: () => import('./anomaly/anomaly.module')
        .then(m => m.AnomalyModule)
    },
    {
      path: 'server-configuration',
      loadChildren: () => import('./server-configuration/server-configuration.module')
        .then(m => m.ServerConfigurationModule),
    },
    {
      path: 'oracle', // Changed from 'database-table'
      loadChildren: () => import('./oracle/oracle.module')
        .then(m => m.OracleModule)
    },
    { path: '', redirectTo: 'realtime', pathMatch: 'full' },
    { path: '**', redirectTo: 'realtime' }
  ],
},
{ path: 'server-configuration', loadChildren: () => import('./server-configuration/server-configuration.module').then(m => m.ServerConfigurationModule) }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PagesRoutingModule { }