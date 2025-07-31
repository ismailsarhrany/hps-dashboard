import { Injectable, OnDestroy } from "@angular/core";
import {
  Observable,
  Subject,
  BehaviorSubject,
  timer,
  EMPTY,
  interval,
} from "rxjs";
import { webSocket, WebSocketSubject } from "rxjs/webSocket";
import {
  retry,
  retryWhen,
  delay,
  tap,
  catchError,
  filter,
  map,
} from "rxjs/operators";

import { ServerTabsService } from './server-tabs.service';


// Interfaces matching your existing data structures (updated with server info)
export interface VmstatData {
  timestamp: string;
  r: number;
  b: number;
  avm: number;
  fre: number;
  pi: number;
  po: number;
  fr: number;
  cs: number;
  us: number;
  sy: number;
  idle: number;
  interface_in: number;
  server_hostname?: string;
  server_id?: string;
}

export interface NetstatData {
  timestamp: string;
  interface: string;
  ipkts: number;
  ierrs: number;
  opkts: number;
  oerrs: number;
  time?: number;
  // Rates added by backend
  ipkts_rate?: number;
  opkts_rate?: number;
  ierrs_rate?: number;
  oerrs_rate?: number;
  server_hostname?: string;
  server_id?: string;
}

export interface IostatData {
  timestamp: string;
  disk: string;
  tps: number;
  kb_read: number;
  kb_wrtn: number;
  service_time: number;
  // Rates added by backend
  kb_read_rate?: number;
  kb_wrtn_rate?: number;
  server_hostname?: string;
  server_id?: string;
}

export interface ProcessData {
  timestamp: string;
  user: string;
  pid: number;
  cpu: number;
  mem: number;
  command: string;
  server_hostname?: string;
  server_id?: string;
}

// Updated WebSocket data structure for multi-server support
export interface WebSocketData {
  metric: "vmstat" | "netstat" | "iostat" | "process";
  timestamp: string; // Top-level timestamp from Django consumer
  server_id: string; // Server ID for multi-server support
  server_hostname?: string; // Server hostname for identification
  values: VmstatData | NetstatData | IostatData | ProcessData; // Contains raw data AND rates
  id?: number; // Optional DB id
  sequence_id?: number; // Optional sequence id
}

export enum RealtimeConnectionStatus {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

export interface MetricConnectionInfo {
  status: RealtimeConnectionStatus;
  reconnectAttempts: number;
  lastMessage?: string;
  url: string;
  serverId?: string;
}


// Configuration for buffering with server-specific buffers
interface BufferConfig {
  maxSize: number;
  flushInterval: number;
}

// Buffered data item - stores the full WebSocketData with server info
interface BufferedDataItem {
  data: WebSocketData; // Store the full message
  timestamp: Date; // Parsed timestamp for sorting
  serverId: string; // Server ID for filtering
}

@Injectable({
  providedIn: "root",
})
export class RealtimeService implements OnDestroy {
  private readonly BASE_WS_URL = "ws://localhost:8000/ws/metrics";
  private readonly RECONNECT_INTERVAL = 5000;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  private readonly bufferConfig: BufferConfig = {
    maxSize: 50,
    flushInterval: 500,
  };

  // WebSocket connections organized by metric and server
  private websockets: {
    [key: string]: { [serverId: string]: WebSocketSubject<any> | null };
  } = {
      vmstat: {},
      iostat: {},
      netstat: {},
      process: {},
    };

  // Connection status organized by metric and server
  private connectionStatus: {
    [key: string]: { [serverId: string]: BehaviorSubject<RealtimeConnectionStatus> };
  } = {
      vmstat: {},
      iostat: {},
      netstat: {},
      process: {},
    };

  private reconnectAttempts: {
    [key: string]: { [serverId: string]: number }
  } = {
      vmstat: {},
      iostat: {},
      netstat: {},
      process: {},
    };

  // Buffers store the full WebSocketData organized by metric and server
  private dataBuffers: {
    [key: string]: { [serverId: string]: BufferedDataItem[] };
  } = {
      vmstat: {},
      iostat: {},
      netstat: {},
      process: {},
    };

  // Subjects now emit server-specific data
  private vmstatSubject$ = new Subject<{ serverId: string; data: VmstatData }>();
  private netstatSubject$ = new Subject<{ serverId: string; data: WebSocketData }>();
  private iostatSubject$ = new Subject<{ serverId: string; data: WebSocketData }>();
  private processSubject$ = new Subject<{ serverId: string; data: ProcessData }>();

  // Subject for server-agnostic data (all servers combined)
  private allVmstatSubject$ = new Subject<VmstatData>();
  private allNetstatSubject$ = new Subject<WebSocketData>();
  private allIostatSubject$ = new Subject<WebSocketData>();
  private allProcessSubject$ = new Subject<ProcessData>();

  private activeConnections = new Set<string>();
  private flushTimer: any;

  constructor(private serverTabsService: ServerTabsService) {
    this.startBufferFlushTimer();
  }

  connectToActiveServer(): void {
    const activeServer = this.serverTabsService.getActiveServer();
    if (activeServer?.id) { // Add null check
      this.connectToServer(activeServer.id);
    }
  }

  // Connect to all metrics for a specific server
  connectToServer(serverId: string): void {
    const metrics = ["vmstat", "iostat", "netstat", "process"];
    metrics.forEach((metric) => {
      // Skip if already connected
      if (this.websockets[metric][serverId] &&
        this.connectionStatus[metric][serverId].value === RealtimeConnectionStatus.CONNECTED) {
        return;
      }

      this.connectToMetric(metric, serverId).subscribe({
        error: (error) => console.error(`Subscription error for ${metric}/${serverId}:`, error),
        complete: () => console.log(`${metric}/${serverId} subscription completed.`),
      });
    });
  }

  ngOnDestroy(): void {
    this.disconnectAll();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  private startBufferFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushAllBuffers();
    }, this.bufferConfig.flushInterval);
  }

  private parseTimestamp(timestamp: string): Date {
    try {
      if (timestamp?.includes("T")) {
        return new Date(timestamp);
      } else {
        console.warn("Unexpected timestamp format:", timestamp);
        return new Date();
      }
    } catch (e) {
      console.error("Error parsing timestamp:", timestamp, e);
      return new Date();
    }
  }

  private getConnectionKey(metric: string, serverId: string): string {
    return `${metric}-${serverId}`;
  }

  private initializeServerConnections(metric: string, serverId: string): void {
    if (!this.websockets[metric][serverId]) {
      this.websockets[metric][serverId] = null;
    }
    if (!this.connectionStatus[metric][serverId]) {
      this.connectionStatus[metric][serverId] = new BehaviorSubject<RealtimeConnectionStatus>(
        RealtimeConnectionStatus.DISCONNECTED
      );
    }
    if (!this.reconnectAttempts[metric][serverId]) {
      this.reconnectAttempts[metric][serverId] = 0;
    }
    if (!this.dataBuffers[metric][serverId]) {
      this.dataBuffers[metric][serverId] = [];
    }
  }

  // Add data to server-specific buffer
  private addToBuffer(metric: string, serverId: string, message: WebSocketData): void {
    if (!message || !message.timestamp) {
      console.warn(
        `Invalid message for ${metric}/${serverId}, missing timestamp:`,
        message
      );
      return;
    }

    this.initializeServerConnections(metric, serverId);

    const timestamp = this.parseTimestamp(message.timestamp);

    const bufferedItem: BufferedDataItem = {
      data: message,
      timestamp,
      serverId,
    };

    this.dataBuffers[metric][serverId].push(bufferedItem);

    if (this.dataBuffers[metric][serverId].length > this.bufferConfig.maxSize) {
      this.dataBuffers[metric][serverId].shift();
    }
  }

  private flushBuffer(metric: string, serverId: string): void {
    const buffer = this.dataBuffers[metric]?.[serverId];
    if (!buffer || buffer.length === 0) return;

    buffer.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    while (buffer.length > 0) {
      const item = buffer.shift()!;
      this.emitSortedData(metric, serverId, item.data);
    }
  }

  private flushAllBuffers(): void {
    Object.keys(this.dataBuffers).forEach((metric) => {
      Object.keys(this.dataBuffers[metric]).forEach((serverId) => {
        this.flushBuffer(metric, serverId);
      });
    });
  }

  // Emit server-specific data
  private emitSortedData(metric: string, serverId: string, data: WebSocketData): void {
    try {
      switch (metric) {
        case "vmstat":
          const vmstatData = data.values as VmstatData;
          this.vmstatSubject$.next({ serverId, data: vmstatData });
          this.allVmstatSubject$.next(vmstatData);
          break;
        case "netstat":
          this.netstatSubject$.next({ serverId, data });
          this.allNetstatSubject$.next(data);
          break;
        case "iostat":
          this.iostatSubject$.next({ serverId, data });
          this.allIostatSubject$.next(data);
          break;
        case "process":
          const processData = data.values as ProcessData;
          this.processSubject$.next({ serverId, data: processData });
          this.allProcessSubject$.next(processData);
          break;
        default:
          console.warn("Unknown metric type:", metric);
      }
    } catch (error) {
      console.error(`Error emitting ${metric}/${serverId} data:`, error, data);
    }
  }

  // Get connection status for specific server
  getConnectionStatus(metric: string, serverId: string): Observable<RealtimeConnectionStatus> {
    this.initializeServerConnections(metric, serverId);
    return this.connectionStatus[metric][serverId]?.asObservable() || EMPTY;
  }

  // Get overall connection status for a specific server
  getServerConnectionStatus(serverId: string): Observable<RealtimeConnectionStatus> {
    return new Observable((observer) => {
      const subscription = timer(0, 1000).subscribe(() => {
        const metrics = ['vmstat', 'iostat', 'netstat', 'process'];
        const statuses = metrics.map(metric =>
          this.connectionStatus[metric]?.[serverId]?.value || RealtimeConnectionStatus.DISCONNECTED
        );

        if (statuses.every(status => status === RealtimeConnectionStatus.CONNECTED)) {
          observer.next(RealtimeConnectionStatus.CONNECTED);
        } else if (statuses.some(status =>
          status === RealtimeConnectionStatus.CONNECTING ||
          status === RealtimeConnectionStatus.RECONNECTING
        )) {
          observer.next(RealtimeConnectionStatus.CONNECTING);
        } else if (statuses.some(status => status === RealtimeConnectionStatus.ERROR)) {
          observer.next(RealtimeConnectionStatus.ERROR);
        } else {
          observer.next(RealtimeConnectionStatus.DISCONNECTED);
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  // Get overall connection status across all servers
  getOverallConnectionStatus(): Observable<RealtimeConnectionStatus> {
    return new Observable((observer) => {
      const subscription = timer(0, 1000).subscribe(() => {
        const allStatuses: RealtimeConnectionStatus[] = [];

        Object.keys(this.connectionStatus).forEach(metric => {
          Object.keys(this.connectionStatus[metric]).forEach(serverId => {
            allStatuses.push(this.connectionStatus[metric][serverId].value);
          });
        });

        if (allStatuses.length === 0) {
          observer.next(RealtimeConnectionStatus.DISCONNECTED);
          return;
        }

        if (allStatuses.every(status => status === RealtimeConnectionStatus.CONNECTED)) {
          observer.next(RealtimeConnectionStatus.CONNECTED);
        } else if (allStatuses.some(status =>
          status === RealtimeConnectionStatus.CONNECTING ||
          status === RealtimeConnectionStatus.RECONNECTING
        )) {
          observer.next(RealtimeConnectionStatus.CONNECTING);
        } else if (allStatuses.some(status => status === RealtimeConnectionStatus.ERROR)) {
          observer.next(RealtimeConnectionStatus.ERROR);
        } else {
          observer.next(RealtimeConnectionStatus.DISCONNECTED);
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  private connectToMetric(metric: string, serverId: string): Observable<any> {
    this.initializeServerConnections(metric, serverId);

    if (this.websockets[metric][serverId] && !this.websockets[metric][serverId]!.closed) {
      return this.websockets[metric][serverId]!.asObservable();
    }

    // Updated URL structure to include server ID
    const url = `${this.BASE_WS_URL}/${metric}/${serverId}/`;
    this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.CONNECTING);
    console.log(`Connecting to ${metric}/${serverId} WebSocket:`, url);
    this.dataBuffers[metric][serverId] = [];

    this.websockets[metric][serverId] = webSocket<any>({
      url: url,
      openObserver: {
        next: () => {
          console.log(`${metric}/${serverId} WebSocket connected successfully`);
          this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.CONNECTED);
          this.reconnectAttempts[metric][serverId] = 0;
          this.activeConnections.add(this.getConnectionKey(metric, serverId));
        },
      },
      closeObserver: {
        next: (event) => {
          console.log(`${metric}/${serverId} WebSocket disconnected:`, event);
          this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.DISCONNECTED);
          this.activeConnections.delete(this.getConnectionKey(metric, serverId));
          this.websockets[metric][serverId] = null;
          if (event.code !== 1000) {
            this.handleReconnection(metric, serverId);
          }
        },
      },
    });

    return this.websockets[metric][serverId]!.pipe(
      tap((rawMessage: any) => {
        if (rawMessage && rawMessage.metric && rawMessage.values) {
          // Ensure server info is included
          const message: WebSocketData = {
            ...rawMessage,
            server_id: serverId,
            server_hostname: rawMessage.server_hostname || undefined
          };
          this.handleIncomingMessage(metric, serverId, message);
        } else {
          console.warn(
            `Received unexpected message format for ${metric}/${serverId}:`,
            rawMessage
          );
        }
      }),
      retryWhen((errors) =>
        errors.pipe(
          tap((error) => {
            console.error(`${metric}/${serverId} WebSocket error:`, error);
            this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.ERROR);
            this.websockets[metric][serverId]?.complete();
            this.websockets[metric][serverId] = null;
          }),
          delay(this.RECONNECT_INTERVAL),
          tap(() => {
            if (this.reconnectAttempts[metric][serverId] < this.MAX_RECONNECT_ATTEMPTS) {
              this.reconnectAttempts[metric][serverId]++;
              this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.RECONNECTING);
              console.log(
                `${metric}/${serverId} reconnection attempt ${this.reconnectAttempts[metric][serverId]}/${this.MAX_RECONNECT_ATTEMPTS}`
              );
            } else {
              console.error(`${metric}/${serverId} max reconnection attempts reached.`);
              this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.ERROR);
            }
          }),
          filter(() =>
            this.reconnectAttempts[metric][serverId] < this.MAX_RECONNECT_ATTEMPTS &&
            this.connectionStatus[metric][serverId].value !== RealtimeConnectionStatus.CONNECTED &&
            this.connectionStatus[metric][serverId].value !== RealtimeConnectionStatus.CONNECTING
          )
        )
      ),
      catchError((error) => {
        console.error(`${metric}/${serverId} WebSocket stream error after retries:`, error);
        if (this.connectionStatus[metric][serverId].value !== RealtimeConnectionStatus.ERROR) {
          this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.ERROR);
        }
        this.websockets[metric][serverId] = null;
        return EMPTY;
      })
    );
  }

  private handleReconnection(metric: string, serverId: string): void {
    if (this.reconnectAttempts[metric][serverId] < this.MAX_RECONNECT_ATTEMPTS) {
      timer(this.RECONNECT_INTERVAL).subscribe(() => {
        if (this.connectionStatus[metric][serverId].value === RealtimeConnectionStatus.DISCONNECTED) {
          console.log(`Attempting to reconnect ${metric}/${serverId}...`);
          this.connectToMetric(metric, serverId).subscribe({
            error: (err) => console.error(`Reconnection failed for ${metric}/${serverId}:`, err),
          });
        }
      });
    } else {
      console.error(`${metric}/${serverId} max reconnection attempts reached. Stopping reconnection.`);
      this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.ERROR);
    }
  }

  // Connect to specific metrics for a server
  connectToServerMetrics(serverId: string, metrics: string[]): void {
    metrics.forEach((metric) => {
      if (["vmstat", "iostat", "netstat", "process"].includes(metric)) {
        this.connectToMetric(metric, serverId).subscribe({
          error: (error) => console.error(`Subscription error for ${metric}/${serverId}:`, error),
          complete: () => console.log(`${metric}/${serverId} subscription completed.`),
        });
      }
    });
  }

  // Connect to all metrics for multiple servers
  connectToServers(serverIds: string[]): void {
    serverIds.forEach(serverId => {
      this.connectToServer(serverId);
    });
  }

  // Legacy methods for backward compatibility (connects to all available servers)
  connectAll(): void {
    // This method would need server IDs, so it's deprecated
    console.warn('connectAll() is deprecated. Use connectToServers() with specific server IDs.');
  }

  connectToMetrics(metrics: string[]): void {
    // This method would need server IDs, so it's deprecated
    console.warn('connectToMetrics() is deprecated. Use connectToServerMetrics() with specific server IDs.');
  }

  // Disconnect specific server and metric
  disconnect(metric: string, serverId: string): void {
    if (this.websockets[metric]?.[serverId]) {
      console.log(`Disconnecting ${metric}/${serverId} WebSocket`);
      this.websockets[metric][serverId]!.complete();
      this.websockets[metric][serverId] = null;
    }
    this.activeConnections.delete(this.getConnectionKey(metric, serverId));
    if (this.connectionStatus[metric]?.[serverId]?.value !== RealtimeConnectionStatus.DISCONNECTED) {
      this.connectionStatus[metric][serverId].next(RealtimeConnectionStatus.DISCONNECTED);
    }
    this.reconnectAttempts[metric][serverId] = 0;
    if (this.dataBuffers[metric]?.[serverId]) {
      this.dataBuffers[metric][serverId] = [];
    }
  }

  // Disconnect all metrics for a specific server
  disconnectServer(serverId: string): void {
    const metrics = ["vmstat", "iostat", "netstat", "process"];
    metrics.forEach(metric => {
      this.disconnect(metric, serverId);
    });
  }

  // Disconnect all servers and metrics
  disconnectAll(): void {
    Object.keys(this.websockets).forEach((metric) => {
      Object.keys(this.websockets[metric]).forEach((serverId) => {
        this.disconnect(metric, serverId);
      });
    });
  }

  // Server-specific monitoring methods
  startServerMonitoring(serverId: string): void {
    this.connectToServer(serverId);
  }

  startServerSelectiveMonitoring(serverId: string, metrics: string[]): void {
    this.connectToServerMetrics(serverId, metrics);
  }

  stopServerMonitoring(serverId: string): void {
    this.disconnectServer(serverId);
  }

  // Legacy methods for backward compatibility
  startRealtimeMonitoring(): void {
    console.warn('startRealtimeMonitoring() is deprecated. Use startServerMonitoring() with specific server IDs.');
  }

  startSelectiveMonitoring(metrics: string[]): void {
    console.warn('startSelectiveMonitoring() is deprecated. Use startServerSelectiveMonitoring() with specific server IDs.');
  }

  stopRealtimeMonitoring(): void {
    this.disconnectAll();
  }

  // Server-specific data retrieval methods
  getRealtimeVmstat(serverId?: string): Observable<VmstatData> {
    if (serverId) {
      return this.vmstatSubject$.asObservable().pipe(
        filter(item => item.serverId === serverId),
        map(item => item.data)
      );
    }
    return this.allVmstatSubject$.asObservable();
  }

  getRealtimeNetstat(serverId?: string): Observable<WebSocketData> {
    if (serverId) {
      return this.netstatSubject$.asObservable().pipe(
        filter(item => item.serverId === serverId),
        map(item => item.data)
      );
    }
    return this.allNetstatSubject$.asObservable();
  }

  getRealtimeIostat(serverId?: string): Observable<WebSocketData> {
    if (serverId) {
      return this.iostatSubject$.asObservable().pipe(
        filter(item => item.serverId === serverId),
        map(item => item.data)
      );
    }
    return this.allIostatSubject$.asObservable();
  }

  getRealtimeProcess(serverId?: string): Observable<ProcessData> {
    if (serverId) {
      return this.processSubject$.asObservable().pipe(
        filter(item => item.serverId === serverId),
        map(item => item.data)
      );
    }
    return this.allProcessSubject$.asObservable();
  }

  // Get all server-specific data streams
  getServerSpecificVmstat(): Observable<{ serverId: string; data: VmstatData }> {
    return this.vmstatSubject$.asObservable();
  }

  getServerSpecificNetstat(): Observable<{ serverId: string; data: WebSocketData }> {
    return this.netstatSubject$.asObservable();
  }

  getServerSpecificIostat(): Observable<{ serverId: string; data: WebSocketData }> {
    return this.iostatSubject$.asObservable();
  }

  getServerSpecificProcess(): Observable<{ serverId: string; data: ProcessData }> {
    return this.processSubject$.asObservable();
  }

  // Send message to specific server
  sendMessage(metric: string, serverId: string, message: any): void {
    if (
      this.websockets[metric]?.[serverId] &&
      this.connectionStatus[metric][serverId].value === RealtimeConnectionStatus.CONNECTED
    ) {
      this.websockets[metric][serverId]!.next(message);
    } else {
      console.warn(
        `${metric}/${serverId} WebSocket not connected, cannot send message:`,
        message
      );
    }
  }

  // Get connected servers for a metric
  getConnectedServers(metric: string): string[] {
    return Object.keys(this.connectionStatus[metric] || {}).filter(
      serverId => this.connectionStatus[metric][serverId].value === RealtimeConnectionStatus.CONNECTED
    );
  }

  // Get all connected servers across all metrics
  getAllConnectedServers(): string[] {
    const connectedServers = new Set<string>();
    Object.keys(this.connectionStatus).forEach(metric => {
      this.getConnectedServers(metric).forEach(serverId => {
        connectedServers.add(serverId);
      });
    });
    return Array.from(connectedServers);
  }

  private handleIncomingMessage(metric: string, serverId: string, message: WebSocketData): void {
    try {
      this.addToBuffer(metric, serverId, message);
    } catch (error) {
      console.error(
        `Error handling incoming message for ${metric}/${serverId}:`,
        error,
        message
      );
    }
  }
}