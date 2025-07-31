// src/app/services/server-tabs.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './monitoring.service';

// Replace the Server interface with:
export interface Server {
  id: string; // Add missing ID
  hostname: string; 
  os_type: string; 
  ip_address: string; 
  status: string; 
  alias: string;
  os_version: string;
  architecture: string;
  ssh_port: number;
  monitoring_enabled: boolean;
  description: string | null;
  location: string | null;
  environment: string | null;
}

@Injectable({ providedIn: 'root' })
export class ServerTabsService {
  private activeServer = new BehaviorSubject<Server | null>(null);
  private servers = new BehaviorSubject<Server[]>([]);

  constructor(private apiService: ApiService) {
    this.loadServers();
  }

  async loadServers() {
    try {
      const response = await this.apiService.getServers().toPromise();
      // Cast to our Server type
      this.servers.next(response.servers as unknown as Server[]);
      
      if (response.servers.length > 0 && !this.activeServer.value) {
        this.setActiveServer(response.servers[0].id);
      }
    } catch (error) {
      console.error('Error loading servers:', error);
    }
  }

  setActiveServer(serverId: string) {
    const server = this.servers.value.find(s => s.id === serverId);
    if (server) this.activeServer.next(server);
  }

  getActiveServer(): Server | null {
    return this.activeServer.value;
  }

  getServers() {
    return this.servers.asObservable();
  }
}