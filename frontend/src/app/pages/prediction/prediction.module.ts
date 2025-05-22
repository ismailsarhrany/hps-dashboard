import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgxEchartsModule } from 'ngx-echarts';
import { 
  NbCardModule,
  NbIconModule,
  NbButtonModule,
  NbSelectModule,
  NbBadgeModule
} from '@nebular/theme';

import { ThemeModule } from '../../@theme/theme.module';
import { PredictionRoutingModule } from './prediction-routing.module';
import { PredictionComponent } from './prediction.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ThemeModule,
    PredictionRoutingModule,
    NgxEchartsModule,
    NbCardModule,
    NbIconModule,
    NbButtonModule,
    NbSelectModule,
    NbBadgeModule
  ],
  declarations: [
    PredictionComponent
  ],
})
export class PredictionModule { }

// This implementation:

// 1. Creates a prediction page with two main sections:
//    - Resource usage predictions with confidence bands
//    - Anomaly detection history with detailed list

// 2. Key features:
//    - Interactive prediction period selector (7/14/30 days)
//    - Confidence level configuration
//    - Animated loading states
//    - Anomaly timeline visualization
//    - Detailed anomaly list with icons and statuses

// 3. Uses mock data generation patterns:
//    - Synthetic prediction data with confidence bands
//    - Random anomaly generation with different types
//    - Time-based data simulation

// 4. Visualization features:
//    - Confidence bands using ECharts area series
//    - Anomaly markers in scatter plots
//    - Responsive chart layouts
//    - Nebular badge integration

// To complete setup:
// 1. Add route to app-routing.module.ts
// 2. Ensure all Nebular modules are imported
// 3. Add navigation link in application menu
// 4. Add the new methods to MockMonitoringService

// The page maintains consistent styling with other dashboard pages while introducing predictive analytics capabilities and anomaly visualization patterns.