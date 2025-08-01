// src/app/services/realtime.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, BehaviorSubject, Subject, EMPTY } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { retry, catchError, filter, tap, takeUntil, retryWhen,delay, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Enums
export enum RealtimeConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  RECONNECTING = 'reconnecting'
}

// Interfaces
export interface VmstatData {
  timestamp: string;
  r: number;
  b: number;
  avm: number;
  fre: number;
  us: number;
  sy: number;
  idle: number;
}

export interface NetstatData {
  timestamp: string;
  interface: string;
  ipkts_rate: number;
  opkts_rate: number;
  ierrs_rate: number;
  oerrs_rate: number;
}

export interface IostatData {
  timestamp: string;
  disk: string;
  kb_read_rate: number;
  kb_wrtn_rate: number;
  tps: number;
}

export interface ProcessData {
  pid: number;
  command: string;
  user: string;
  cpu: number;
  mem: number;
  timestamp: string;
}

export interface WebSocketMessage {
  metric: string;
  timestamp: string;
  values: any;
  server_id: string;
  server_hostname: string;
  id?: number;
  sequence_id?: number;
}

export interface ConnectionConfig {
  serverId: string;
  metrics: string[];
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
}

@Injectable({
  providedIn: 'root'
})
export class RealtimeService implements OnDestroy {
  private destroy$ = new Subject<void>();

  // WebSocket connections per server
  private connections = new Map<string, WebSocketSubject<any>>();
  private connectionStatus = new Map<string, BehaviorSubject<RealtimeConnectionStatus>>();

  // Data streams per server and metric
  private vmstatStreams = new Map<string, BehaviorSubject<VmstatData | null>>();
  private netstatStreams = new Map<string, BehaviorSubject<NetstatData | null>>();
  private iostatStreams = new Map<string, BehaviorSubject<IostatData | null>>();
  private processStreams = new Map<string, BehaviorSubject<ProcessData | null>>();

  // Overall connection status
  private overallStatusSubject = new BehaviorSubject<RealtimeConnectionStatus>(
    RealtimeConnectionStatus.DISCONNECTED
  );

  // Active configurations
  private activeConfigs = new Map<string, ConnectionConfig>();

  // Default connection settings
  private readonly defaultReconnectAttempts = 5;
  private readonly defaultReconnectInterval = 3000;

  constructor() { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.disconnectAll();
  }

  // --- Connection Management ---

  /**
   * Connect to metrics for a specific server
   */
  connectToMetrics(
    serverId: string,
    metrics: string[] = ['vmstat', 'iostat', 'netstat', 'process'],
    autoReconnect: boolean = true
  ): Observable<RealtimeConnectionStatus> {

    const config: ConnectionConfig = {
      serverId,
      metrics,
      autoReconnect,
      maxReconnectAttempts: this.defaultReconnectAttempts,
      reconnectInterval: this.defaultReconnectInterval
    };

    this.activeConfigs.set(serverId, config);
    this.initializeStreamsForServer(serverId);
    this.createConnection(config);

    return this.getConnectionStatus(serverId);
  }

  /**
   * Disconnect from a specific server
   */
  disconnectFromServer(serverId: string): void {
    const connection = this.connections.get(serverId);
    if (connection) {
      connection.complete();
      this.connections.delete(serverId);
    }

    // Update status
    const statusSubject = this.connectionStatus.get(serverId);
    if (statusSubject) {
      statusSubject.next(RealtimeConnectionStatus.DISCONNECTED);
    }

    // Clean up config
    this.activeConfigs.delete(serverId);

    this.updateOverallStatus();
  }

  /**
   * Disconnect from all servers
   */
  disconnectAll(): void {
    this.connections.forEach((connection, serverId) => {
      this.disconnectFromServer(serverId);
    });
    this.connections.clear();
    this.activeConfigs.clear();
    this.overallStatusSubject.next(RealtimeConnectionStatus.DISCONNECTED);
  }

  /**
   * Reconnect to a specific server
   */
  reconnectToServer(serverId: string): void {
    const config = this.activeConfigs.get(serverId);
    if (config) {
      this.disconnectFromServer(serverId);
      setTimeout(() => {
        this.connectToMetrics(config.serverId, config.metrics, config.autoReconnect);
      }, 1000);
    }
  }

  // --- Status Observables ---

  /**
   * Get connection status for a specific server
   */
  getConnectionStatus(serverId: string): Observable<RealtimeConnectionStatus> {
    if (!this.connectionStatus.has(serverId)) {
      this.connectionStatus.set(serverId, new BehaviorSubject(RealtimeConnectionStatus.DISCONNECTED));
    }
    return this.connectionStatus.get(serverId)!.asObservable();
  }

  /**
   * Get overall connection status
   */
  getOverallConnectionStatus(): Observable<RealtimeConnectionStatus> {
    return this.overallStatusSubject.asObservable();
  }

  /**
   * Check if server is connected
   */
  isServerConnected(serverId: string): boolean {
    const status = this.connectionStatus.get(serverId);
    return status?.value === RealtimeConnectionStatus.CONNECTED;
  }

  // --- Data Observables ---

  /**
   * Get vmstat data stream for a specific server
   */
  getRealtimeVmstat(serverId: string): Observable<VmstatData> {
    if (!this.vmstatStreams.has(serverId)) {
      this.vmstatStreams.set(serverId, new BehaviorSubject<VmstatData | null>(null));
    }
    return this.vmstatStreams.get(serverId)!.asObservable().pipe(
      filter(data => data !== null)
    ) as Observable<VmstatData>;
  }

  /**
   * Get netstat data stream for a specific server
   */
  getRealtimeNetstat(serverId: string): Observable<NetstatData> {
    if (!this.netstatStreams.has(serverId)) {
      this.netstatStreams.set(serverId, new BehaviorSubject<NetstatData | null>(null));
    }
    return this.netstatStreams.get(serverId)!.asObservable().pipe(
      filter(data => data !== null)
    ) as Observable<NetstatData>;
  }

  /**
   * Get iostat data stream for a specific server
   */
  getRealtimeIostat(serverId: string): Observable<IostatData> {
    if (!this.iostatStreams.has(serverId)) {
      this.iostatStreams.set(serverId, new BehaviorSubject<IostatData | null>(null));
    }
    return this.iostatStreams.get(serverId)!.asObservable().pipe(
      filter(data => data !== null)
    ) as Observable<IostatData>;
  }

  /**
   * Get process data stream for a specific server
   */
  getRealtimeProcess(serverId: string): Observable<ProcessData> {
    if (!this.processStreams.has(serverId)) {
      this.processStreams.set(serverId, new BehaviorSubject<ProcessData | null>(null));
    }
    return this.processStreams.get(serverId)!.asObservable().pipe(
      filter(data => data !== null)
    ) as Observable<ProcessData>;
  }

  // --- Private Methods ---

  private initializeStreamsForServer(serverId: string): void {
    if (!this.connectionStatus.has(serverId)) {
      this.connectionStatus.set(serverId, new BehaviorSubject(RealtimeConnectionStatus.DISCONNECTED));
    }
    if (!this.vmstatStreams.has(serverId)) {
      this.vmstatStreams.set(serverId, new BehaviorSubject<VmstatData | null>(null));
    }
    if (!this.netstatStreams.has(serverId)) {
      this.netstatStreams.set(serverId, new BehaviorSubject<NetstatData | null>(null));
    }
    if (!this.iostatStreams.has(serverId)) {
      this.iostatStreams.set(serverId, new BehaviorSubject<IostatData | null>(null));
    }
    if (!this.processStreams.has(serverId)) {
      this.processStreams.set(serverId, new BehaviorSubject<ProcessData | null>(null));
    }
  }

  private createConnection(config: ConnectionConfig): void {
    const wsUrl = this.buildWebSocketUrl(config.serverId);

    const statusSubject = this.connectionStatus.get(config.serverId)!;
    statusSubject.next(RealtimeConnectionStatus.CONNECTING);

    const ws$ = webSocket({
      url: wsUrl,
      openObserver: {
        next: () => {
          console.log(`WebSocket connected to server ${config.serverId}`);
          statusSubject.next(RealtimeConnectionStatus.CONNECTED);
          this.updateOverallStatus();
        }
      },
      closeObserver: {
        next: () => {
          console.log(`WebSocket disconnected from server ${config.serverId}`);
          statusSubject.next(RealtimeConnectionStatus.DISCONNECTED);
          this.updateOverallStatus();
        }
      }
    });

    // Store connection
    this.connections.set(config.serverId, ws$);

    // Subscribe to messages
    ws$.pipe(
      retryWhen(errors => errors.pipe(
        delay(config.reconnectInterval || this.defaultReconnectInterval),
        take(config.maxReconnectAttempts || this.defaultReconnectAttempts)
      ))
      ,
      catchError(error => {
        console.error(`WebSocket error for server ${config.serverId}:`, error);
        statusSubject.next(RealtimeConnectionStatus.ERROR);
        this.updateOverallStatus();
        return EMPTY;
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (message: WebSocketMessage) => {
        this.handleWebSocketMessage(config.serverId, message);
      },
      error: (error) => {
        console.error(`WebSocket error for server ${config.serverId}:`, error);
        statusSubject.next(RealtimeConnectionStatus.ERROR);
        this.updateOverallStatus();

        // Auto-reconnect if enabled
        if (config.autoReconnect) {
          setTimeout(() => {
            this.reconnectToServer(config.serverId);
          }, config.reconnectInterval || this.defaultReconnectInterval);
        }
      }
    });
  }

  private buildWebSocketUrl(metric: string ,serverId: string): string {
    // const protocol = environment.production ? 'wss' : 'ws';
    // const host = environment.wsUrl || environment.apiUrl.replace(/^https?:\/\//, '');
    // return `${protocol}://${host}/ws/metrics//${metric}/${serverId}/`;
      return `.../ws/metrics/${metric}/${serverId}/`;
  }

  private handleWebSocketMessage(serverId: string, message: WebSocketMessage): void {
    try {
      const metric = message.metric?.toLowerCase();
      const data = message.values || message;

      switch (metric) {
        case 'vmstat':
          const vmstatSubject = this.vmstatStreams.get(serverId);
          if (vmstatSubject && this.isValidVmstatData(data)) {
            vmstatSubject.next(data as VmstatData);
          }
          break;

        case 'netstat':
          const netstatSubject = this.netstatStreams.get(serverId);
          if (netstatSubject && this.isValidNetstatData(data)) {
            netstatSubject.next(data as NetstatData);
          }
          break;

        case 'iostat':
          const iostatSubject = this.iostatStreams.get(serverId);
          if (iostatSubject && this.isValidIostatData(data)) {
            iostatSubject.next(data as IostatData);
          }
          break;

        case 'process':
          const processSubject = this.processStreams.get(serverId);
          if (processSubject && this.isValidProcessData(data)) {
            processSubject.next(data as ProcessData);
          }
          break;

        default:
          console.warn(`Unknown metric type: ${metric} from server ${serverId}`);
      }
    } catch (error) {
      console.error(`Error handling WebSocket message from server ${serverId}:`, error);
    }
  }

  private updateOverallStatus(): void {
    const statuses = Array.from(this.connectionStatus.values()).map(s => s.value);

    if (statuses.length === 0) {
      this.overallStatusSubject.next(RealtimeConnectionStatus.DISCONNECTED);
      return;
    }

    // If any connection has error, overall status is error
    if (statuses.includes(RealtimeConnectionStatus.ERROR)) {
      this.overallStatusSubject.next(RealtimeConnectionStatus.ERROR);
      return;
    }

    // If any connection is connecting/reconnecting, overall status reflects that
    if (statuses.includes(RealtimeConnectionStatus.CONNECTING) ||
      statuses.includes(RealtimeConnectionStatus.RECONNECTING)) {
      this.overallStatusSubject.next(RealtimeConnectionStatus.CONNECTING);
      return;
    }

    // If all connections are connected, overall status is connected
    if (statuses.every(status => status === RealtimeConnectionStatus.CONNECTED)) {
      this.overallStatusSubject.next(RealtimeConnectionStatus.CONNECTED);
      return;
    }

    // Otherwise, overall status is disconnected
    this.overallStatusSubject.next(RealtimeConnectionStatus.DISCONNECTED);
  }

  // --- Data Validation Methods ---

  private isValidVmstatData(data: any): boolean {
    return data &&
      typeof data.timestamp === 'string' &&
      typeof data.r === 'number' &&
      typeof data.b === 'number' &&
      typeof data.avm === 'number' &&
      typeof data.fre === 'number' &&
      typeof data.us === 'number' &&
      typeof data.sy === 'number' &&
      typeof data.idle === 'number';
  }

  private isValidNetstatData(data: any): boolean {
    return data &&
      typeof data.timestamp === 'string' &&
      typeof data.interface === 'string' &&
      typeof data.ipkts_rate === 'number' &&
      typeof data.opkts_rate === 'number' &&
      typeof data.ierrs_rate === 'number' &&
      typeof data.oerrs_rate === 'number';
  }

  private isValidIostatData(data: any): boolean {
    return data &&
      typeof data.timestamp === 'string' &&
      typeof data.disk === 'string' &&
      typeof data.kb_read_rate === 'number' &&
      typeof data.kb_wrtn_rate === 'number' &&
      typeof data.tps === 'number';
  }

  private isValidProcessData(data: any): boolean {
    return data &&
      typeof data.timestamp === 'string' &&
      typeof data.pid === 'number' &&
      typeof data.command === 'string' &&
      typeof data.user === 'string' &&
      typeof data.cpu === 'number' &&
      typeof data.mem === 'number';
  }

  // --- Public Utility Methods ---

  /**
   * Get list of connected servers
   */
  getConnectedServers(): string[] {
    const connectedServers: string[] = [];
    this.connectionStatus.forEach((statusSubject, serverId) => {
      if (statusSubject.value === RealtimeConnectionStatus.CONNECTED) {
        connectedServers.push(serverId);
      }
    });
    return connectedServers;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    total: number;
    connected: number;
    disconnected: number;
    error: number;
    connecting: number;
  } {
    const stats = {
      total: 0,
      connected: 0,
      disconnected: 0,
      error: 0,
      connecting: 0
    };

    this.connectionStatus.forEach((statusSubject) => {
      stats.total++;
      switch (statusSubject.value) {
        case RealtimeConnectionStatus.CONNECTED:
          stats.connected++;
          break;
        case RealtimeConnectionStatus.DISCONNECTED:
          stats.disconnected++;
          break;
        case RealtimeConnectionStatus.ERROR:
          stats.error++;
          break;
        case RealtimeConnectionStatus.CONNECTING:
        case RealtimeConnectionStatus.RECONNECTING:
          stats.connecting++;
          break;
      }
    });

    return stats;
  }

  /**
   * Force reconnect all servers
   */
  reconnectAll(): void {
    const configs = Array.from(this.activeConfigs.values());
    this.disconnectAll();

    setTimeout(() => {
      configs.forEach(config => {
        this.connectToMetrics(config.serverId, config.metrics, config.autoReconnect);
      });
    }, 2000);
  }

  // --- Legacy Support Methods ---

  // /**
  //  * @deprecated Use connectToMetrics with serverId instead
  //  */
  // startRealtimeMonitoring(): void {
  //   console.warn('startRealtimeMonitoring() is deprecated. Use connectToMetrics(serverId, metrics) instead.');
  // }

  // /**
  //  * @deprecated Use disconnectAll() instead
  //  */
  // stopRealtimeMonitoring(): void {
  //   console.warn('stopRealtimeMonitoring() is deprecated. Use disconnectAll() instead.');
  //   this.disconnectAll();
  // }

  // /**
  //  * @deprecated Use getRealtimeVmstat(serverId) instead
  //  */
  // getRealtimeVmstatLegacy(): Observable<VmstatData> {
  //   console.warn('getRealtimeVmstat() without serverId is deprecated.');
  //   return EMPTY;
  // }

  // /**
  //  * @deprecated Use getRealtimeNetstat(serverId) instead
  //  */
  // getRealtimeNetstatLegacy(): Observable<NetstatData> {
  //   console.warn('getRealtimeNetstat() without serverId is deprecated.');
  //   return EMPTY;
  // }

  // /**
  //  * @deprecated Use getRealtimeIostat(serverId) instead
  //  */
  // getRealtimeIostatLegacy(): Observable<IostatData> {
  //   console.warn('getRealtimeIostat() without serverId is deprecated.');
  //   return EMPTY;
  // }

  // /**
  //  * @deprecated Use getRealtimeProcess(serverId) instead
  //  */
  // getRealtimeProcessLegacy(): Observable<ProcessData> {
  //   console.warn('getRealtimeProcess() without serverId is deprecated.');
  //   return EMPTY;
  // }
}