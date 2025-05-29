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

// Interfaces matching your existing data structures (kept for reference within values)
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
}

export interface NetstatData {
  timestamp: string;
  interface: string;
  ipkts: number;
  ierrs: number;
  opkts: number;
  oerrs: number;
  time?: number; // Optional as it might not always be present
  // Rates added by backend
  ipkts_rate?: number;
  opkts_rate?: number;
  ierrs_rate?: number;
  oerrs_rate?: number;
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
}

export interface ProcessData {
  timestamp: string;
  user: string;
  pid: number;
  cpu: number;
  mem: number;
  command: string;
}

// --- MODIFIED: Renamed and defined to match component's expectation ---
// Represents the full structure received from WebSocket, including rates in 'values'
export interface WebSocketData {
  metric: "vmstat" | "netstat" | "iostat" | "process";
  timestamp: string; // Top-level timestamp from Django consumer
  values: VmstatData | NetstatData | IostatData | ProcessData; // Contains raw data AND rates
  id?: number; // Optional DB id
  sequence_id?: number; // Optional sequence id
}
// --- END MODIFICATION ---

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
}

// Simplified buffer configuration
interface BufferConfig {
  maxSize: number;
  flushInterval: number;
}

// Simplified buffered data item - stores the full WebSocketData
interface BufferedDataItem {
  data: WebSocketData; // Store the full message
  timestamp: Date; // Parsed timestamp for sorting
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

  private websockets: {
    [key: string]: WebSocketSubject<any> | null;
  } = {
    vmstat: null,
    iostat: null,
    netstat: null,
    process: null,
  };

  private connectionStatus: {
    [key: string]: BehaviorSubject<RealtimeConnectionStatus>;
  } = {
    vmstat: new BehaviorSubject<RealtimeConnectionStatus>(
      RealtimeConnectionStatus.DISCONNECTED
    ),
    iostat: new BehaviorSubject<RealtimeConnectionStatus>(
      RealtimeConnectionStatus.DISCONNECTED
    ),
    netstat: new BehaviorSubject<RealtimeConnectionStatus>(
      RealtimeConnectionStatus.DISCONNECTED
    ),
    process: new BehaviorSubject<RealtimeConnectionStatus>(
      RealtimeConnectionStatus.DISCONNECTED
    ),
  };

  private reconnectAttempts: { [key: string]: number } = {
    vmstat: 0,
    iostat: 0,
    netstat: 0,
    process: 0,
  };

  // Buffers store the full WebSocketData
  private dataBuffers: {
    [key: string]: BufferedDataItem[];
  } = {
    vmstat: [],
    iostat: [],
    netstat: [],
    process: [],
  };

  // --- MODIFIED: Subjects now emit WebSocketData for netstat/iostat ---
  private vmstatSubject$ = new Subject<VmstatData>(); // Vmstat doesn't have rates calculated
  private netstatSubject$ = new Subject<WebSocketData>();
  private iostatSubject$ = new Subject<WebSocketData>();
  private processSubject$ = new Subject<ProcessData>(); // Process doesn't have rates calculated
  // --- END MODIFICATION ---

  private activeConnections = new Set<string>();
  private flushTimer: any;

  constructor() {
    this.startBufferFlushTimer();
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
      // Handle ISO format primarily
      if (timestamp?.includes("T")) {
        return new Date(timestamp);
      } else {
        console.warn("Unexpected timestamp format:", timestamp);
        return new Date(); // Fallback
      }
    } catch (e) {
      console.error("Error parsing timestamp:", timestamp, e);
      return new Date(); // Fallback
    }
  }

  // --- MODIFIED: Add data to buffer - expects full WebSocketData ---
  private addToBuffer(metric: string, message: WebSocketData): void {
    if (!message || !message.timestamp) {
      console.warn(
        `Invalid message for ${metric}, missing timestamp:`,
        message
      );
      return;
    }

    const timestamp = this.parseTimestamp(message.timestamp);

    const bufferedItem: BufferedDataItem = {
      data: message, // Store the full message
      timestamp,
    };

    this.dataBuffers[metric].push(bufferedItem);

    if (this.dataBuffers[metric].length > this.bufferConfig.maxSize) {
      // Remove oldest item if buffer exceeds max size
      this.dataBuffers[metric].shift();
    }
  }
  // --- END MODIFICATION ---

  private flushBuffer(metric: string): void {
    const buffer = this.dataBuffers[metric];
    if (buffer.length === 0) return;

    buffer.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    while (buffer.length > 0) {
      const item = buffer.shift()!;
      this.emitSortedData(metric, item.data); // Emit the full WebSocketData
    }
  }

  private flushAllBuffers(): void {
    Object.keys(this.dataBuffers).forEach((metric) => {
      this.flushBuffer(metric);
    });
  }

  // --- MODIFIED: Emit full WebSocketData for netstat/iostat ---
  private emitSortedData(metric: string, data: WebSocketData): void {
    try {
      switch (metric) {
        case "vmstat":
          // Vmstat doesn't have rates, emit only values
          this.vmstatSubject$.next(data.values as VmstatData);
          break;
        case "netstat":
          this.netstatSubject$.next(data); // Emit the full object
          break;
        case "iostat":
          this.iostatSubject$.next(data); // Emit the full object
          break;
        case "process":
          // Process doesn't have rates, emit only values
          this.processSubject$.next(data.values as ProcessData);
          break;
        default:
          console.warn("Unknown metric type:", metric);
      }
    } catch (error) {
      console.error(`Error emitting ${metric} data:`, error, data);
    }
  }
  // --- END MODIFICATION ---

  getConnectionStatus(metric: string): Observable<RealtimeConnectionStatus> {
    return this.connectionStatus[metric]?.asObservable() || EMPTY;
  }

  getOverallConnectionStatus(): Observable<RealtimeConnectionStatus> {
    // Logic remains the same
    return new Observable((observer) => {
      const subscription = timer(0, 1000).subscribe(() => {
        const statuses = Object.values(this.connectionStatus).map(
          (status) => status.value
        );

        if (
          statuses.every(
            (status) => status === RealtimeConnectionStatus.CONNECTED
          )
        ) {
          observer.next(RealtimeConnectionStatus.CONNECTED);
        } else if (
          statuses.some(
            (status) =>
              status === RealtimeConnectionStatus.CONNECTING ||
              status === RealtimeConnectionStatus.RECONNECTING
          )
        ) {
          observer.next(RealtimeConnectionStatus.CONNECTING);
        } else if (
          statuses.some((status) => status === RealtimeConnectionStatus.ERROR)
        ) {
          observer.next(RealtimeConnectionStatus.ERROR);
        } else {
          observer.next(RealtimeConnectionStatus.DISCONNECTED);
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  private connectToMetric(metric: string): Observable<any> {
    if (this.websockets[metric] && !this.websockets[metric]!.closed) {
      return this.websockets[metric]!.asObservable();
    }

    const url = `${this.BASE_WS_URL}/${metric}/`;
    this.connectionStatus[metric].next(RealtimeConnectionStatus.CONNECTING);
    console.log(`Connecting to ${metric} WebSocket:`, url);
    this.dataBuffers[metric] = [];

    this.websockets[metric] = webSocket<any>({
      url: url,
      openObserver: {
        next: () => {
          console.log(`${metric} WebSocket connected successfully`);
          this.connectionStatus[metric].next(
            RealtimeConnectionStatus.CONNECTED
          );
          this.reconnectAttempts[metric] = 0;
          this.activeConnections.add(metric);
        },
      },
      closeObserver: {
        next: (event) => {
          console.log(`${metric} WebSocket disconnected:`, event);
          this.connectionStatus[metric].next(
            RealtimeConnectionStatus.DISCONNECTED
          );
          this.activeConnections.delete(metric);
          this.websockets[metric] = null;
          if (event.code !== 1000) {
            this.handleReconnection(metric);
          }
        },
      },
    });

    return this.websockets[metric]!.pipe(
      // --- MODIFIED: Ensure rawMessage is treated as WebSocketData ---
      tap((rawMessage: any) => {
        // Assuming rawMessage is already in WebSocketData format from backend
        if (rawMessage && rawMessage.metric && rawMessage.values) {
          this.handleIncomingMessage(metric, rawMessage as WebSocketData);
        } else {
          console.warn(
            `Received unexpected message format for ${metric}:`,
            rawMessage
          );
        }
      }),
      // --- END MODIFICATION ---
      retryWhen((errors) =>
        errors.pipe(
          tap((error) => {
            console.error(`${metric} WebSocket error:`, error);
            this.connectionStatus[metric].next(RealtimeConnectionStatus.ERROR);
            this.websockets[metric]?.complete();
            this.websockets[metric] = null;
          }),
          delay(this.RECONNECT_INTERVAL),
          tap(() => {
            if (this.reconnectAttempts[metric] < this.MAX_RECONNECT_ATTEMPTS) {
              this.reconnectAttempts[metric]++;
              this.connectionStatus[metric].next(
                RealtimeConnectionStatus.RECONNECTING
              );
              console.log(
                `${metric} reconnection attempt ${this.reconnectAttempts[metric]}/${this.MAX_RECONNECT_ATTEMPTS}`
              );
            } else {
              console.error(`${metric} max reconnection attempts reached.`);
              this.connectionStatus[metric].next(
                RealtimeConnectionStatus.ERROR
              );
            }
          }),
          filter(
            () =>
              this.reconnectAttempts[metric] < this.MAX_RECONNECT_ATTEMPTS &&
              this.connectionStatus[metric].value !==
                RealtimeConnectionStatus.CONNECTED &&
              this.connectionStatus[metric].value !==
                RealtimeConnectionStatus.CONNECTING
          )
        )
      ),
      catchError((error) => {
        console.error(`${metric} WebSocket stream error after retries:`, error);
        if (
          this.connectionStatus[metric].value !== RealtimeConnectionStatus.ERROR
        ) {
          this.connectionStatus[metric].next(RealtimeConnectionStatus.ERROR);
        }
        this.websockets[metric] = null;
        return EMPTY;
      })
    );
  }

  private handleReconnection(metric: string): void {
    if (this.reconnectAttempts[metric] < this.MAX_RECONNECT_ATTEMPTS) {
      timer(this.RECONNECT_INTERVAL).subscribe(() => {
        if (
          this.connectionStatus[metric].value ===
          RealtimeConnectionStatus.DISCONNECTED
        ) {
          console.log(`Attempting to reconnect ${metric}...`);
          this.connectToMetric(metric).subscribe({
            error: (err) =>
              console.error(`Reconnection failed for ${metric}:`, err),
          });
        }
      });
    } else {
      console.error(
        `${metric} max reconnection attempts reached. Stopping reconnection.`
      );
      this.connectionStatus[metric].next(RealtimeConnectionStatus.ERROR);
    }
  }

  connectAll(): void {
    const metrics = ["vmstat", "iostat", "netstat", "process"];
    metrics.forEach((metric) => {
      if (!this.websockets[metric]) {
        this.connectToMetric(metric).subscribe({
          error: (error) =>
            console.error(`Subscription error for ${metric}:`, error),
          complete: () => console.log(`${metric} subscription completed.`),
        });
      }
    });
  }

  connectToMetrics(metrics: string[]): void {
    metrics.forEach((metric) => {
      if (["vmstat", "iostat", "netstat", "process"].includes(metric)) {
        if (!this.websockets[metric]) {
          this.connectToMetric(metric).subscribe({
            error: (error) =>
              console.error(`Subscription error for ${metric}:`, error),
            complete: () => console.log(`${metric} subscription completed.`),
          });
        }
      }
    });
  }

  disconnect(metric: string): void {
    if (this.websockets[metric]) {
      console.log(`Disconnecting ${metric} WebSocket`);
      this.websockets[metric]!.complete(); // Use code 1000 for normal closure
      this.websockets[metric] = null;
    }
    this.activeConnections.delete(metric);
    if (
      this.connectionStatus[metric].value !==
      RealtimeConnectionStatus.DISCONNECTED
    ) {
      this.connectionStatus[metric].next(RealtimeConnectionStatus.DISCONNECTED);
    }
    this.reconnectAttempts[metric] = 0;
    this.dataBuffers[metric] = [];
  }

  disconnectAll(): void {
    Object.keys(this.websockets).forEach((metric) => {
      this.disconnect(metric);
    });
  }

  startRealtimeMonitoring(): void {
    this.connectAll();
  }

  startSelectiveMonitoring(metrics: string[]): void {
    this.connectToMetrics(metrics);
  }

  stopRealtimeMonitoring(): void {
    this.disconnectAll();
  }

  // --- MODIFIED: Return type changed for netstat/iostat ---
  getRealtimeVmstat(): Observable<VmstatData> {
    return this.vmstatSubject$.asObservable();
  }

  getRealtimeNetstat(): Observable<WebSocketData> {
    return this.netstatSubject$.asObservable();
  }

  getRealtimeIostat(): Observable<WebSocketData> {
    return this.iostatSubject$.asObservable();
  }

  getRealtimeProcess(): Observable<ProcessData> {
    return this.processSubject$.asObservable();
  }
  // --- END MODIFICATION ---

  sendMessage(metric: string, message: any): void {
    if (
      this.websockets[metric] &&
      this.connectionStatus[metric].value === RealtimeConnectionStatus.CONNECTED
    ) {
      this.websockets[metric]!.next(message);
    } else {
      console.warn(
        `${metric} WebSocket not connected, cannot send message:`,
        message
      );
    }
  }

  // --- MODIFIED: Handle full WebSocketData ---
  private handleIncomingMessage(metric: string, message: WebSocketData): void {
    try {
      // Add the full message to the buffer
      this.addToBuffer(metric, message);
    } catch (error) {
      console.error(
        `Error handling incoming message for ${metric}:`,
        error,
        message
      );
    }
  }
  // --- END MODIFICATION ---
}
