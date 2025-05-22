import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgxEchartsModule } from 'ngx-echarts';
import { 
  NbCardModule,
  NbIconModule,
  NbButtonModule,
  NbSelectModule,
  NbInputModule,
  NbBadgeModule
} from '@nebular/theme';

import { ThemeModule } from '../../@theme/theme.module';
import { ProcessRoutingModule } from './process-routing.module';
import { ProcessComponent } from './process.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ThemeModule,
    ProcessRoutingModule,
    NgxEchartsModule,
    NbCardModule,
    NbIconModule,
    NbButtonModule,
    NbSelectModule,
    NbInputModule,
    NbBadgeModule
  ],
  declarations: [
    ProcessComponent
  ],
})
export class ProcessModule { }

// This implementation:

// 1. Creates a process monitoring page with three main sections:
//    - Real-time bubble chart showing current process CPU/memory usage
//    - Weekly trend chart for CPU/memory usage
//    - Historical analysis chart with process selection

// 2. Features include:
//    - Real-time updates for current processes
//    - Process selector dropdown with live process list
//    - Date range filtering for historical analysis
//    - Visualizations using ECharts with Nebular styling
//    - Loading states and error handling

// 3. Uses existing MockMonitoringService methods:
//    - getRealtimeMetricsByType('process') for live data
//    - getHistoricalMetrics('process') for historical data

// 4. Includes responsive design and theme compatibility

// To complete the setup:
// 1. Add the route to your app-routing.module.ts
// 2. Ensure all Nebular modules are properly imported
// 3. Verify the mock service is providing process data
// 4. Add navigation link to your application menu

// The page provides a comprehensive view of process resource usage across different time dimensions while maintaining consistency with your existing dashboard design.