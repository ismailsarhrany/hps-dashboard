// src/app/pages/server-dashboard/server-dashboard.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ServerTabService, ServerTab } from '../../services/server-tab.service';
import { ServerService } from '../../services/server.service';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'ngx-server-dashboard',
  templateUrl: './server-dashboard.component.html',
  styleUrls: ['./server-dashboard.component.scss']
})
export class ServerDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(
    public tabService: ServerTabService,
    private serverService: ServerService
  ) {}

  ngOnInit() {
    this.serverService.servers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(servers => {
        const currentServerId = this.serverService.getCurrentServerId();
        if (currentServerId) {
          const server = servers.find(s => s.id === currentServerId);
          if (server) this.tabService.addServerTab(server);
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onTabChange(tab: NbTabComponent) {
    this.tabService.setActiveTab(tab.tabId);
    this.serverService.setSelectedServer(tab.tabId);
  }

  onSubTabChange(subTabId: string, serverTab: ServerTab) {
    this.tabService.setActiveSubTab(serverTab.id, subTabId);
  }
}