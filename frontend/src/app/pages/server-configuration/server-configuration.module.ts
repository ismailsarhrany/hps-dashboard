import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms'; // Add this import
import { 
  NbCardModule, 
  NbIconModule, 
  NbButtonModule,
  NbSpinnerModule,
  NbSelectModule,
  NbCheckboxModule,
  NbInputModule,
  NbBadgeModule,
  NbDialogModule // Add this for dialog functionality
} from '@nebular/theme';

import { ServerConfigurationRoutingModule } from './server-configuration-routing.module';
import { ServerConfigurationComponent } from './server-configuration.component';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@NgModule({
  declarations: [
    ServerConfigurationComponent,
    ConfirmDialogComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ServerConfigurationRoutingModule,
    NbCardModule,
    NbIconModule,
    NbButtonModule,
    NbSpinnerModule,
    NbSelectModule,
    NbCheckboxModule,
    NbInputModule,
    NbBadgeModule,
    NbDialogModule.forChild() 
  ]
})
export class ServerConfigurationModule { }