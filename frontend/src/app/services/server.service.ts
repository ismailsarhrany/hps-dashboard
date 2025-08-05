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
  ssh_password?: string;
  ssh_key_path?: string;
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
    this.http.get<any>(`${environment.apiUrl}/api/servers/`).subscribe({
      next: (response) => {
        // Handle both array response and paginated response
        let servers: Server[] = [];

        if (Array.isArray(response)) {
          // Direct array response
          servers = response;
        } else if (response.servers && Array.isArray(response.servers)) {
          // Paginated response
          servers = response.servers;
        } else {
          console.warn('Unexpected server response format:', response);
          servers = [];
        }

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

  createServer(serverData: any): Observable<any> {
    const url = `${environment.apiUrl}/api/servers/create/`;
    return this.http.post<any>(url, serverData);
  }

  updateServer(serverId: string, serverData: any): Observable<any> {
    const url = `${environment.apiUrl}/api/servers/${serverId}/`;  // Added trailing slash
    return this.http.put<any>(url, serverData);
  }
}