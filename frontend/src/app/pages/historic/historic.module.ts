// src/app/pages/historic/historic.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgxEchartsModule } from 'ngx-echarts';
import { 
  NbCardModule,
  NbIconModule,
  NbButtonModule,
  NbInputModule
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
    HistoricRoutingModule,
    NgxEchartsModule,
    NbCardModule,
    NbIconModule,
    NbButtonModule,
    NbInputModule,
  ],
  declarations: [
    HistoricComponent
  ],
})
export class HistoricModule { }
// [file content end]

// This implementation:

// 1. Creates a historic page with date range pickers
// 2. Uses the existing MockMonitoringService's getHistoricalMetrics method
// 3. Maintains similar chart layouts to realtime page but without real-time updates
// 4. Implements data aggregation for disk metrics
// 5. Handles loading states and form validation
// 6. Uses the same chart styling patterns as the realtime page
// 7. Includes proper module setup and routing

// To complete the implementation:

// 1. Add the route to your app-routing.module.ts
// 2. Ensure all necessary Nebular modules are imported
// 3. Add navigation links to your application menu

// The page will show historical data based on selected dates using the existing mock service, maintaining consistency with your realtime page design while adding time-based filtering capabilities.