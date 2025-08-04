import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Server {
  id: string;
  alias: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  status: 'active' | 'error' | 'maintenance';
  last_seen?: Date;
  // Add other properties from your API response
  os_type?: string;
  os_version?: string;
  architecture?: string;
  ssh_username?: string;
  monitoring_enabled?: boolean;
  monitoring_interval?: number;
  description?: string;
  location?: string;
  environment?: string;
}

export interface ServerApiResponse {
  count: number;
  page: number;
  total_pages: number;
  servers: Server[];
}

@Injectable({
  providedIn: 'root'
})
export class ServerService {
  private selectedServerIdSubject = new BehaviorSubject<string | null>(null);
  selectedServerId$ = this.selectedServerIdSubject.asObservable();

  private serversSubject = new BehaviorSubject<Server[]>([]);
  servers$ = this.serversSubject.asObservable();

  constructor(private http: HttpClient) { }

  fetchServers(): void {
    this.http.get<ServerApiResponse>(`${environment.apiUrl}/api/servers/`).subscribe({
      next: (response) => {
        // Extract servers from the response object
        const servers = response.servers || [];
        const mappedServers = servers.map(s => ({
          ...s,
          status: s.status || 'active',
          last_seen: s.last_seen ? new Date(s.last_seen) : undefined
        }));
        
        this.serversSubject.next(mappedServers);

        // Auto-select first server if none selected
        if (!this.selectedServerIdSubject.value && mappedServers.length > 0) {
          this.setSelectedServerId(mappedServers[0].id);
        }
      },
      error: (err) => {
        console.error('Failed to fetch servers', err);
        this.serversSubject.next([]); // Set empty array on error
      }
    });
  }

  setSelectedServerId(serverId: string): void {
    this.selectedServerIdSubject.next(serverId);
  }

  getSelectedServer(): Observable<Server | null> {
    return this.selectedServerId$.pipe(
      map(selectedId => {
        if (!selectedId) return null;
        const servers = this.serversSubject.value;
        return servers.find(server => server.id === selectedId) || null;
      })
    );
  }

  // Add new methods required by server-tabs
  loadServers(): Observable<Server[]> {
    return this.servers$;
  }

  selectServer(server: Server): void {
    this.setSelectedServerId(server.id);
  }

  testConnection(serverId: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/api/servers/${serverId}/test-connection`, {});
  }

  deleteServer(serverId: string): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/api/servers/${serverId}`);
  }

  refreshServers(): void {
    this.fetchServers();
  }
}