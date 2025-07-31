import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { LayoutComponent } from './layout.component';
import { ServerTabComponent } from './tabs/tabs.component';
import { AccordionComponent } from './accordion/accordion.component';
import { InfiniteListComponent } from './infinite-list/infinite-list.component';
import { ListComponent } from './list/list.component';
import { StepperComponent } from './stepper/stepper.component';

const routes: Routes = [{
  path: '',
  component: LayoutComponent,
  children: [
    {
      path: 'stepper',
      component: StepperComponent,
    },
    {
      path: 'list',
      component: ListComponent,
    },
    {
      path: 'infinite-list',
      component: InfiniteListComponent,
    },
    {
      path: 'accordion',
      component: AccordionComponent,
    },
    {
      path: 'tabs',
      component: ServerTabComponent,
      children: [
        {
          path: 'server/:id',
          component: ServerTabComponent,
          resolve: {
            server: ServerResolver
          }
        }
      ],
    },
  ],
}];


@Injectable({ providedIn: 'root' })
export class ServerResolver implements Resolve<Server> {
  constructor(
    private serverTabsService: ServerTabsService,
    private router: Router
  ) {}

  resolve(route: ActivatedRouteSnapshot): Observable<Server> {
    const id = route.paramMap.get('id');
    return this.serverTabsService.getServers().pipe(
      map(servers => {
        const server = servers.find(s => s.id === id);
        if (server) return server;
        this.router.navigate(['/pages/layout/tabs']);
        return null;
      }),
      take(1)
    );
  }
}

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class LayoutRoutingModule {
}
