import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { ServerService, Server } from '../../../services/server.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'ngx-server-toggle',
  templateUrl: './server-toggle.component.html',
  styleUrls: ['./server-toggle.component.scss']
})
export class ServerToggleComponent implements OnInit, OnDestroy {
  @Input() servers: Server[] = [];
  @Output() serverChange = new EventEmitter<string>();
  
  selectedServerId: string | null = null;
  private destroy$ = new Subject<void>();

  constructor(private serverService: ServerService) {}

  ngOnInit() {
    // Subscribe to selected server changes
    this.serverService.selectedServerId$
      .pipe(takeUntil(this.destroy$))
      .subscribe(serverId => {
        this.selectedServerId = serverId;
      });

    // If no servers provided via input, load from service
    if (!this.servers || this.servers.length === 0) {
      this.serverService.servers$
        .pipe(takeUntil(this.destroy$))
        .subscribe(servers => {
          this.servers = servers;
        });
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectServer(serverId: string) {
    this.serverService.setSelectedServerId(serverId);
    this.serverChange.emit(serverId);
  }

  getStatusClass(status: string): string {
    switch(status?.toLowerCase()) {
      case 'active': return 'success';
      case 'error': return 'danger';
      case 'maintenance': return 'warning';
      default: return 'basic';
    }
  }

  getDisplayName(server: Server): string {
    return server.alias || server.hostname;
  }

  getStatusIcon(status: string): string {
    switch(status?.toLowerCase()) {
      case 'active': return 'checkmark-circle-outline';
      case 'error': return 'alert-circle-outline';
      case 'maintenance': return 'clock-outline';
      default: return 'radio-button-off-outline';
    }
  }

  trackByServerId(index: number, server: Server): string {
    return server.id;
  }

  getTooltipText(server: Server): string {
    return `${server.hostname} (${server.ip_address}) - Status: ${server.status}`;
  }
}