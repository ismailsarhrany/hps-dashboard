import { Component, OnInit, OnDestroy } from '@angular/core';
import { ServerTabsService } from '../../../../services/server-tabs.service';
import { Router } from '@angular/router';
import { Server } from '../../../../services/server-tabs.service'; // Add this import

// Remove the local Server interface
@Component({
  selector: 'ngx-server-tab',
  template: `
    <div class="server-tab-content">
      <h3>{{ server?.hostname }}</h3>
      <p *ngIf="server?.description">{{ server.description }}</p>
      <div class="server-info">
        <p><strong>OS:</strong> {{ server?.os_type }} {{ server?.os_version }}</p>
        <p><strong>IP:</strong> {{ server?.ip_address }}</p>
        <p><strong>Status:</strong> {{ server?.status }}</p>
      </div>
      <button nbButton size="small" status="primary" (click)="viewServerDetails()">
        View Details
      </button>
    </div>
  `,
  styles: [`
    .server-tab-content {
      padding: 1rem;
    }
    .server-info {
      margin: 1rem 0;
    }
  `]
})
export class ServerTabComponent implements OnInit {
  server: Server;
  
  constructor(private route: ActivatedRoute) {}
  
  ngOnInit() {
    // Get server data from route parameters
    this.server = this.route.snapshot.data.server;
  }
  
  viewServerDetails() {
    // Navigate to server details page
  }
}

@Component({
  selector: 'ngx-tabs',
  styleUrls: ['./tabs.component.scss'],
  templateUrl: './tabs.component.html',
})
export class TabsComponent implements OnInit, OnDestroy {
  private serverSubscription: Subscription;
  serverTabs: any[] = [];

  constructor(
    private serverTabsService: ServerTabsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.serverSubscription = this.serverTabsService.getServers().subscribe(servers => {
      this.generateServerTabs(servers);
    });
  }

  ngOnDestroy() {
    if (this.serverSubscription) {
      this.serverSubscription.unsubscribe();
    }
  }

  generateServerTabs(servers: Server[]) {
    this.serverTabs = servers.map(server => ({
      title: server.alias || server.hostname,
      route: `/pages/layout/tabs/server/${server.id}`,
      data: { server }  // Pass server data to the route
    }));

    // Activate the first server tab if none is active
    if (this.serverTabs.length > 0 && !this.router.url.includes('/server/')) {
      this.router.navigate([this.serverTabs[0].route]);
    }
  }
}