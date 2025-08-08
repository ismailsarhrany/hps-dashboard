import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

// Nebular modules
import {
  NbCardModule,
  NbButtonModule,
  NbIconModule,
  NbBadgeModule,
  NbSelectModule,
  NbInputModule,
  NbCheckboxModule,
  NbTooltipModule,
  NbSpinnerModule,
  NbToastrModule,
  NbDialogModule,
  NbProgressBarModule
} from '@nebular/theme';
import { NbEvaIconsModule } from '@nebular/eva-icons';

// Routing
import { OracleRoutingModule } from './oracle-routing.module';

// Components
import { OracleComponent } from './oracle.component';

@NgModule({
  declarations: [
    OracleComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    OracleRoutingModule,
    
    // Nebular UI Modules
    NbCardModule,
    NbButtonModule,
    NbIconModule,
    NbEvaIconsModule,
    NbBadgeModule,
    NbSelectModule,
    NbInputModule,
    NbCheckboxModule,
    NbTooltipModule,
    NbSpinnerModule,
    NbDialogModule.forChild(),
    NbProgressBarModule,
    NbToastrModule.forRoot()
  ]
})
export class OracleModule { }