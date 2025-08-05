import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ServerConfigurationComponent } from './server-configuration.component';

const routes: Routes = [{ path: '', component: ServerConfigurationComponent }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ServerConfigurationRoutingModule { }
