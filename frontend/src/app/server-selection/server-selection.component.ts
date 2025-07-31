// src/app/components/server-selector/server-selector.component.ts
import { Component } from '@angular/core';
import { ServerService } from '../../services/server.service';

@Component({
  selector: 'ngx-server-selector',
  template: `
    <nb-select [(selected)]="selectedServerId" (selectedChange)="onServerChange($event)">
      <nb-option *ngFor="let server of servers" [value]="server.id">
        {{ server.hostname }}
      </nb-option>
    </nb-select>
  `
})
export class ServerSelectorComponent {
  servers: any[] = [];
  selectedServerId: string | null = null;

  constructor(private serverService: ServerService) {}

  ngOnInit() {
    this.serverService.servers$.subscribe(servers => {
      this.servers = servers;
      this.selectedServerId = this.serverService.getCurrentServerId();
    });
  }

  onServerChange(serverId: string) {
    this.serverService.setSelectedServer(serverId);
  }
}