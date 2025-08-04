// src/app/pages/server-tabs/server-tabs.component.ts
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ServerService, Server } from '../../services/server.service';
import { RealtimeService, RealtimeConnectionStatus } from '../../services/realtime.service';

interface ServerTab {
  id: string;
  title: string;
  hostname: string;
  server: Server;
  realtimeStatus: RealtimeConnectionStatus;
  isActive: boolean;
  hasError: boolean;
}

type ServerConnectionStatus = {
  server_id: string;
  hostname: string;
  status: string;
  last_checked?: Date;
};

@Component({
  selector: 'ngx-server-tabs',
  templateUrl: './server-tabs.component.html',
  styleUrls: ['./server-tabs.component.scss']
})
export class ServerTabsComponent implements OnInit, OnDestroy {
  private subscriptions: Subscription[] = [];

  serverTabs: ServerTab[] = [];
  selectedTabIndex: number = 0;
  selectedServerId: string | null = null;
  loading = true;
  showAddServerModal = false;

  // Sub-navigation routes for each server tab
  subRoutes = [
    { path: 'realtime', title: 'Real-time', icon: 'activity-outline' },
    { path: 'historic', title: 'Historic', icon: 'bar-chart-outline' },
    { path: 'process', title: 'Processes', icon: 'list-outline' }
  ];

  constructor(
    private serverService: ServerService,
    private realtimeService: RealtimeService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadServers();
    this.subscribeToServerUpdates();
    this.subscribeToRouteChanges();
  }

  ngOnDestroy(): void {
    // Clean up resources
    this.serverTabs.forEach(tab => {
      this.realtimeService.disconnectFromServer(tab.id);
    });
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.realtimeService.disconnectAll();
  }

  // Load servers from service
  private loadServers(): void {
    this.loading = true;

    const serverSub = this.serverService.loadServers().subscribe({
      next: (servers) => {
        this.updateServerTabs(servers);
        this.loading = false;

        // Auto-select first server if none selected
        if (servers.length > 0 && !this.selectedServerId) {
          this.selectServerTab(0);
        }

        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading servers:', error);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });

    this.subscriptions.push(serverSub);
  }

  // Subscribe to server updates
  private subscribeToServerUpdates(): void {
    const serversSub = this.serverService.servers$.subscribe(servers => {
      this.updateServerTabs(servers);
      this.cdr.detectChanges();
    });

    this.subscriptions.push(serversSub);
  }

  // Subscribe to route parameter changes
  private subscribeToRouteChanges(): void {
    const routeSub = this.route.params.subscribe(params => {
      if (params['serverId']) {
        const tabIndex = this.serverTabs.findIndex(tab => tab.id === params['serverId']);
        if (tabIndex !== -1) {
          this.selectedTabIndex = tabIndex;
          this.selectedServerId = params['serverId'];
        }
      }
    });

    this.subscriptions.push(routeSub);
  }

  // Update server tabs based on server data
  private updateServerTabs(servers: Server[]): void {
    // Track existing tabs to preserve realtime connections
    const existingTabIds = new Set(this.serverTabs.map(tab => tab.id));

    this.serverTabs = servers.map(server => {
      const existingTab = this.serverTabs.find(tab => tab.id === server.id);

      // Create connection status from server data
      const connectionStatus: ServerConnectionStatus = {
        server_id: server.id,
        hostname: server.hostname,
        status: server.status === 'active' ? 'connected' : 'disconnected',
        last_checked: server.last_seen
      };

      return {
        id: server.id,
        title: this.truncateHostname(server.hostname),
        hostname: server.hostname,
        server: server,
        connectionStatus: connectionStatus,
        realtimeStatus: existingTab?.realtimeStatus || RealtimeConnectionStatus.DISCONNECTED,
        isActive: server.status === 'active',
        hasError: existingTab?.hasError || false
      };
    });

    // Clean up realtime connections for removed servers
    existingTabIds.forEach(tabId => {
      if (!servers.find(s => s.id === tabId)) {
        this.realtimeService.disconnectFromServer(tabId);
      }
    });

    // Adjust selected tab index if needed
    if (this.selectedTabIndex >= this.serverTabs.length) {
      this.selectedTabIndex = Math.max(0, this.serverTabs.length - 1);
    }
  }

  // Select a server tab
  selectServerTab(index: number): void {
    if (index < 0 || index >= this.serverTabs.length) return;

    this.selectedTabIndex = index;
    const selectedTab = this.serverTabs[index];
    this.selectedServerId = selectedTab.id;

    // Update selected server in service
    this.serverService.selectServer(selectedTab.server);

    // Navigate to server's realtime page
    this.router.navigate(['/pages/servers', selectedTab.id, 'realtime']);

    // Start realtime monitoring
    this.startRealtimeMonitoring(selectedTab.id);
  }

  // Navigate to sub-route
  navigateToSubRoute(serverId: string, route: string): void {
    this.router.navigate(['/pages/servers', serverId, route]);
  }

  // Start realtime monitoring for server
  private startRealtimeMonitoring(serverId: string): void {
    if (!this.realtimeService.isServerConnected(serverId)) {
      const connectionSub = this.realtimeService.connectToMetrics(serverId, ['vmstat', 'iostat', 'netstat', 'process'])
        .subscribe(status => {
          const tab = this.serverTabs.find(t => t.id === serverId);
          if (tab) {
            tab.realtimeStatus = status;
            tab.hasError = (status === RealtimeConnectionStatus.ERROR);
            this.cdr.detectChanges();
          }
        });

      this.subscriptions.push(connectionSub);
    }
  }

  // Open add server modal
  openAddServerModal(): void {
    this.showAddServerModal = true;
  }

  // Close add server modal
  closeAddServerModal(): void {
    this.showAddServerModal = false;
  }

  // Handle new server added
  onServerAdded(server: Server): void {
    this.closeAddServerModal();

    // Select the new server after short delay
    setTimeout(() => {
      const newTabIndex = this.serverTabs.findIndex(tab => tab.id === server.id);
      if (newTabIndex !== -1) {
        this.selectServerTab(newTabIndex);
      }
    }, 100);
  }

  // Refresh server connection
  refreshServer(serverId: string): void {
    this.serverService.testConnection(serverId).subscribe({
      next: () => {
        // Reload server status
        this.serverService.loadServers().subscribe();
      },
      error: (error) => {
        console.error('Connection test failed:', error);
      }
    });

    // Reconnect realtime monitoring
    this.realtimeService.reconnectToServer(serverId);
  }

  // Remove a server
  removeServer(serverId: string): void {
    if (confirm('Are you sure you want to remove this server?')) {
      this.serverService.deleteServer(serverId).subscribe({
        next: () => {
          console.log(`Server ${serverId} removed successfully`);
        },
        error: (error) => {
          console.error(`Error removing server ${serverId}:`, error);
        }
      });
    }
  }

  // UI Helper methods

  // Truncate long hostnames
  private truncateHostname(hostname: string): string {
    return hostname.length > 15 ? hostname.substring(0, 12) + '...' : hostname;
  }

  getStatusBadge(tab: ServerTab): string {
    return tab.server.status === 'active' ? 'success' :
      tab.server.status === 'error' ? 'danger' :
        'warning'; // maintenance
  }

  // Get tab icon based on status
  getTabIcon(tab: ServerTab): string {
    if (!tab.isActive) return 'slash-outline';
    if (tab.hasError) return 'alert-triangle-outline';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTED) return 'checkmark-circle-outline';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTING) return 'loader-outline';
    return 'radio-outline';
  }

  // Get tab status color
  getTabStatus(tab: ServerTab): string {
    if (tab.server.status === 'maintenance') return 'warning';
    if (tab.hasError) return 'danger';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTED) return 'success';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTING) return 'info';
    return 'basic';
  }

  // Get connection status text
  getConnectionStatusText(tab: ServerTab): string {
    if (tab.server.status === 'maintenance') return 'Maintenance';
    if (tab.hasError) return 'Realtime Error';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTED) return 'Connected';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTING) return 'Connecting...';
    return 'Disconnected';
  }

  // Check if sub-route is active
  isSubRouteActive(serverId: string, subRoute: string): boolean {
    const url = this.router.url;
    return url.includes(`/servers/${serverId}/${subRoute}`);
  }

  // Close a tab
  closeTab(index: number, event: Event): void {
    event.stopPropagation();

    if (this.serverTabs.length <= 1) return;

    const tab = this.serverTabs[index];

    // Disconnect realtime monitoring
    this.realtimeService.disconnectFromServer(tab.id);

    // Remove from local array
    this.serverTabs.splice(index, 1);

    // Adjust selected index
    if (this.selectedTabIndex >= index && this.selectedTabIndex > 0) {
      this.selectedTabIndex--;
    }

    // Select another tab
    if (this.serverTabs.length > 0) {
      this.selectServerTab(this.selectedTabIndex);
    }
  }
}