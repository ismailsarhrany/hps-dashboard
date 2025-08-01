// src/app/pages/server-tabs/server-tabs.component.ts
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { NbTabComponent } from '@nebular/theme';
import { ServerService, Server, ServerConnectionStatus } from '../../services/server.service';
import { RealtimeService, RealtimeConnectionStatus } from '../../services/realtime.service';

interface ServerTab {
  id: string;
  title: string;
  hostname: string;
  server: Server;
  connectionStatus: ServerConnectionStatus | null;
  realtimeStatus: RealtimeConnectionStatus;
  isActive: boolean;
  hasError: boolean;
}

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

  // Sub-navigation for each server tab
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
    this.serverTabs.forEach(tab => {
      this.realtimeService.disconnectFromServer(tab.id);
    });
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.realtimeService.disconnectAll();
  }

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

  private subscribeToServerUpdates(): void {
    // Subscribe to server list changes
    const serversSub = this.serverService.servers$.subscribe(servers => {
      this.updateServerTabs(servers);
      this.cdr.detectChanges();
    });

    // Subscribe to server status changes
    const statusSub = this.serverService.serverStatus$.subscribe(statusMap => {
      this.serverTabs.forEach(tab => {
        tab.connectionStatus = statusMap.get(tab.id) || null;
        tab.hasError = tab.connectionStatus?.status === 'error';
      });
      this.cdr.detectChanges();
    });

    this.subscriptions.push(serversSub, statusSub);
  }

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

  private updateServerTabs(servers: Server[]): void {
    // Keep track of existing tabs to preserve realtime connections
    const existingTabIds = new Set(this.serverTabs.map(tab => tab.id));

    this.serverTabs = servers.map(server => {
      const existingTab = this.serverTabs.find(tab => tab.id === server.id);

      return {
        id: server.id,
        title: this.truncateHostname(server.hostname),
        hostname: server.hostname,
        server: server,
        connectionStatus: existingTab?.connectionStatus || null,
        realtimeStatus: existingTab?.realtimeStatus || RealtimeConnectionStatus.DISCONNECTED,
        isActive: server.is_active,
        hasError: existingTab?.hasError || false
      };
    });

    // Clean up realtime connections for removed servers
    existingTabIds.forEach(tabId => {
      if (!servers.find(s => s.id === tabId)) {
        this.realtimeService.disconnectFromServer(tabId);
      }
    });

    // Adjust selected tab index if necessary
    if (this.selectedTabIndex >= this.serverTabs.length) {
      this.selectedTabIndex = Math.max(0, this.serverTabs.length - 1);
    }
  }

  selectServerTab(index: number): void {
    if (index < 0 || index >= this.serverTabs.length) return;

    this.selectedTabIndex = index;
    const selectedTab = this.serverTabs[index];
    this.selectedServerId = selectedTab.id;

    // Update server service selection
    this.serverService.selectServer(selectedTab.server);

    // Navigate to the server's realtime page by default
    this.router.navigate(['/pages/servers', selectedTab.id, 'realtime']);

    // Start realtime monitoring for the selected server
    this.startRealtimeMonitoring(selectedTab.id);
  }

  navigateToSubRoute(serverId: string, route: string): void {
    this.router.navigate(['/pages/servers', serverId, route]);
  }

  private startRealtimeMonitoring(serverId: string): void {
    if (!this.realtimeService.isServerConnected(serverId)) {
      const connectionSub = this.realtimeService.connectToMetrics(serverId, ['vmstat', 'iostat', 'netstat', 'process'])
        .subscribe(status => {
          const tab = this.serverTabs.find(t => t.id === serverId);
          if (tab) {
            tab.realtimeStatus = status;
            this.cdr.detectChanges();
          }
        });

      this.subscriptions.push(connectionSub);
    }
  }

  // Server management methods
  openAddServerModal(): void {
    this.showAddServerModal = true;
  }

  closeAddServerModal(): void {
    this.showAddServerModal = false;
  }

  onServerAdded(server: Server): void {
    this.closeAddServerModal();
    // Server list will be updated automatically through the subscription

    // Select the newly added server
    setTimeout(() => {
      const newTabIndex = this.serverTabs.findIndex(tab => tab.id === server.id);
      if (newTabIndex !== -1) {
        this.selectServerTab(newTabIndex);
      }
    }, 100);
  }

  refreshServer(serverId: string): void {
    const tab = this.serverTabs.find(t => t.id === serverId);
    if (tab) {
      // Test connection
      this.serverService.testConnection(serverId).subscribe({
        next: (result) => {
          console.log(`Connection test for ${tab.hostname}:`, result);
          // Refresh server status
          this.serverService.getBulkServerStatus().subscribe();
        },
        error: (error) => {
          console.error(`Connection test failed for ${tab.hostname}:`, error);
        }
      });

      // Reconnect realtime monitoring
      this.realtimeService.reconnectToServer(serverId);
    }
  }

  removeServer(serverId: string): void {
    if (confirm('Are you sure you want to remove this server?')) {
      this.serverService.deleteServer(serverId).subscribe({
        next: () => {
          console.log(`Server ${serverId} removed successfully`);
          // Tab list will be updated automatically through subscription
        },
        error: (error) => {
          console.error(`Error removing server ${serverId}:`, error);
        }
      });
    }
  }

  // UI Helper methods
  private truncateHostname(hostname: string): string {
    if (hostname.length > 15) {
      return hostname.substring(0, 12) + '...';
    }
    return hostname;
  }

  getTabIcon(tab: ServerTab): string {
    if (!tab.isActive) return 'slash-outline';
    if (tab.hasError) return 'alert-triangle-outline';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTED) return 'checkmark-circle-outline';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTING) return 'loader-outline';
    return 'radio-outline';
  }

  getTabStatus(tab: ServerTab): string {
    if (!tab.isActive) return 'warning';
    if (tab.hasError) return 'danger';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTED) return 'success';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTING) return 'info';
    return 'basic';
  }

  getConnectionStatusText(tab: ServerTab): string {
    if (!tab.isActive) return 'Inactive';
    if (tab.connectionStatus?.status === 'error') return 'Connection Error';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTED) return 'Connected';
    if (tab.realtimeStatus === RealtimeConnectionStatus.CONNECTING) return 'Connecting...';
    if (tab.realtimeStatus === RealtimeConnectionStatus.ERROR) return 'Realtime Error';
    return 'Disconnected';
  }

  // Check if current route matches the sub-route
  isSubRouteActive(serverId: string, subRoute: string): boolean {
    const url = this.router.url;
    return url.includes(`/servers/${serverId}/${subRoute}`);
  }

  // Handle tab close (if you want to support closing tabs)
  closeTab(index: number, event: Event): void {
    event.stopPropagation();

    if (this.serverTabs.length <= 1) {
      return; // Don't close the last tab
    }

    const tab = this.serverTabs[index];

    // Disconnect realtime monitoring
    this.realtimeService.disconnectFromServer(tab.id);

    // Remove from local array (don't delete from server service)
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