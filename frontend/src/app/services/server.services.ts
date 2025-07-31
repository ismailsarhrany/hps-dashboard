// src/app/services/server.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Server {
    id: string;
    hostname: string;
    ip_address: string;
    ssh_port: number;
    ssh_username: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface ServerConnectionStatus {
    server_id: string;
    hostname: string;
    status: 'connected' | 'disconnected' | 'error';
    last_checked: string;
    error_message?: string;
}

export interface CreateServerRequest {
    hostname: string;
    ip_address: string;
    ssh_port: number;
    ssh_username: string;
    ssh_password: string;
    is_active?: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class ServerService {
    private readonly baseUrl = `${environment.apiUrl}/api/servers`;

    // Observables for server management
    private serversSubject = new BehaviorSubject<Server[]>([]);
    private selectedServerSubject = new BehaviorSubject<Server | null>(null);
    private serverStatusSubject = new BehaviorSubject<Map<string, ServerConnectionStatus>>(new Map());
    private selectedServerId = new BehaviorSubject<string | null>(null);
    selectedServerId$ = this.selectedServerId.asObservable();

    public servers$ = this.serversSubject.asObservable();
    public selectedServer$ = this.selectedServerSubject.asObservable();
    public serverStatus$ = this.serverStatusSubject.asObservable();

    // Current selected server for easy access
    get currentServer(): Server | null {
        return this.selectedServerSubject.value;
    }

    constructor(private http: HttpClient) {
        this.loadServers();
        this.startStatusPolling();
    }

    // Add this method to set the selected server
    setSelectedServer(serverId: string): void {
        this.selectedServerId.next(serverId);
        localStorage.setItem('selectedServerId', serverId);
    }

    // Add this method to get the current server ID
    getCurrentServerId(): string | null {
        return this.selectedServerId.value || localStorage.getItem('selectedServerId');
    }

  // Modify loadServers to restore selection
  loadServers(): Observable<Server[]> {
    return this.http.get<Server[]>(this.baseUrl).pipe(
      tap(servers => {
        this.serversSubject.next(servers);
        const savedId = localStorage.getItem('selectedServerId');
        if (savedId && servers.some(s => s.id === savedId)) {
          this.setSelectedServer(savedId);
        }
      })
    );
  }


    // Get server by ID
    getServer(serverId: string): Observable<Server> {
        return this.http.get<Server>(`${this.baseUrl}/${serverId}`).pipe(
            catchError(this.handleError)
        );
    }

    // Create new server
    createServer(serverData: CreateServerRequest): Observable<Server> {
        return this.http.post<Server>(`${this.baseUrl}/create/`, serverData).pipe(
            tap(newServer => {
                const currentServers = this.serversSubject.value;
                this.serversSubject.next([...currentServers, newServer]);
            }),
            catchError(this.handleError)
        );
    }

    // Update server
    updateServer(serverId: string, serverData: Partial<CreateServerRequest>): Observable<Server> {
        return this.http.put<Server>(`${this.baseUrl}/${serverId}/`, serverData).pipe(
            tap(updatedServer => {
                const currentServers = this.serversSubject.value;
                const index = currentServers.findIndex(s => s.id === serverId);
                if (index !== -1) {
                    currentServers[index] = updatedServer;
                    this.serversSubject.next([...currentServers]);
                }
            }),
            catchError(this.handleError)
        );
    }

    // Delete server
    deleteServer(serverId: string): Observable<void> {
        return this.http.delete<void>(`${this.baseUrl}/${serverId}/`).pipe(
            tap(() => {
                const currentServers = this.serversSubject.value;
                const filteredServers = currentServers.filter(s => s.id !== serverId);
                this.serversSubject.next(filteredServers);

                // If deleted server was selected, select another one
                if (this.currentServer?.id === serverId) {
                    this.selectServer(filteredServers[0] || null);
                }
            }),
            catchError(this.handleError)
        );
    }

    // Test server connection
    testConnection(serverId: string): Observable<{ status: string; message: string }> {
        return this.http.post<{ status: string; message: string }>(
            `${this.baseUrl}/${serverId}/test-connection/`,
            {}
        ).pipe(
            catchError(this.handleError)
        );
    }

    // Get bulk server status
    getBulkServerStatus(): Observable<ServerConnectionStatus[]> {
        return this.http.get<ServerConnectionStatus[]>(`${this.baseUrl}/bulk-status/`).pipe(
            tap(statuses => {
                const statusMap = new Map();
                statuses.forEach(status => {
                    statusMap.set(status.server_id, status);
                });
                this.serverStatusSubject.next(statusMap);
            }),
            catchError(this.handleError)
        );
    }

    // Select a server (used by components)
    selectServer(server: Server | null): void {
        this.selectedServerSubject.next(server);
        localStorage.setItem('selectedServerId', server?.id || '');
    }

    // Get server status by ID
    getServerStatus(serverId: string): ServerConnectionStatus | null {
        return this.serverStatusSubject.value.get(serverId) || null;
    }

    // Start polling server status periodically
    private startStatusPolling(): void {
        // Poll every 30 seconds
        setInterval(() => {
            this.getBulkServerStatus().subscribe();
        }, 30000);

        // Initial load
        this.getBulkServerStatus().subscribe();
    }

    // Restore selected server from localStorage on app init
    restoreSelectedServer(): void {
        const savedServerId = localStorage.getItem('selectedServerId');
        if (savedServerId) {
            const servers = this.serversSubject.value;
            const savedServer = servers.find(s => s.id === savedServerId);
            if (savedServer) {
                this.selectServer(savedServer);
            }
        }
    }

    // Helper method to check if server is active and connected
    isServerHealthy(serverId: string): boolean {
        const server = this.serversSubject.value.find(s => s.id === serverId);
        const status = this.getServerStatus(serverId);
        return server?.is_active === true && status?.status === 'connected';
    }

    // Get active servers only
    getActiveServers(): Server[] {
        return this.serversSubject.value.filter(server => server.is_active);
    }

    private handleError = (error: HttpErrorResponse) => {
        console.error('ServerService Error:', error);

        let errorMessage = 'An unknown error occurred';

        if (error.error instanceof ErrorEvent) {
            // Client-side error
            errorMessage = `Client Error: ${error.error.message}`;
        } else {
            // Server-side error
            errorMessage = `Server Error: ${error.status} - ${error.message}`;
            if (error.error?.message) {
                errorMessage += ` - ${error.error.message}`;
            }
        }

        return throwError(() => new Error(errorMessage));
    };
}