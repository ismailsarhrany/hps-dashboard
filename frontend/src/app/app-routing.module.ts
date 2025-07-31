import { ExtraOptions, RouterModule, Routes } from "@angular/router";
import { NgModule } from "@angular/core";
import {
  NbAuthComponent,
  NbLoginComponent,
  NbLogoutComponent,
  NbRegisterComponent,
  NbRequestPasswordComponent,
  NbResetPasswordComponent,
} from "@nebular/auth";

import { ServerDashboardComponent } from "./pages/server-dashboard/server-dashboard.component";
import { RealtimeComponent } from "./pages/realtime/realtime.component";
import { HistoricComponent } from "./pages/historic/historic.component";
import { ProcessComponent } from "./pages/process/process.component";

export const routes: Routes = [
  {
    path: "pages",
    loadChildren: () =>
      import("./pages/pages.module").then((m) => m.PagesModule),
  },
  {
    path: "auth",
    component: NbAuthComponent,
    children: [
      {
        path: "",
        component: NbLoginComponent,
      },
      {
        path: "login",
        component: NbLoginComponent,
      },
      {
        path: "register",
        component: NbRegisterComponent,
      },
      {
        path: "logout",
        component: NbLogoutComponent,
      },
      {
        path: "request-password",
        component: NbRequestPasswordComponent,
      },
      {
        path: "reset-password",
        component: NbResetPasswordComponent,
      },
    ],
  },
  // { path: "", redirectTo: "/pages/realtime", pathMatch: "full" },
  // { path: "**", redirectTo: "pages" },

  {
    path: 'dashboard',
    component: ServerDashboardComponent,
    children: [
      {
        path: '',
        redirectTo: 'realtime',
        pathMatch: 'full'
      },
      {
        path: 'realtime',
        component: RealtimeComponent,
        data: { subTab: 'realtime' }
      },
      {
        path: 'historic',
        component: HistoricComponent,
        data: { subTab: 'historic' }
      },
      {
        path: 'process',
        component: ProcessComponent,
        data: { subTab: 'process' }
      }
    ]
  }
];

const config: ExtraOptions = {
  useHash: false,
};

@NgModule({
  imports: [RouterModule.forRoot(routes, config)],
  exports: [RouterModule],
})
export class AppRoutingModule { }
