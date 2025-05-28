import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, BehaviorSubject, timer, EMPTY, interval } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { retry, retryWhen, delay, tap, catchError, filter, map } from 'rxjs/operators';

// Interfaces matching your existing data structures
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
  time: number;
}

export interface IostatData {
  timestamp: string;
  disk: string;
  tps: number;
  kb_read: number;
  kb_wrtn: number;
  service_time: number;
}

export interface ProcessData {
  timestamp: string;
  user: string;
  pid: number;
  cpu: number;
  mem: number;
  command: string;
}

// Updated WebSocket message structure to match Django consumer output
export interface WebSocketMessage {
  metric: 'vmstat' | 'netstat' | 'iostat' | 'process';
  timestamp: string;
  values: VmstatData | NetstatData | IostatData | ProcessData;
  id?: number;
  parsed_timestamp?: string;
}

export enum RealtimeConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
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

// Simplified buffered data item
interface BufferedDataItem<T> {
  data: T;
  timestamp: Date;
  originalTimestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class RealtimeService implements OnDestroy {
  private readonly BASE_WS_URL = 'ws://localhost:8000/ws/metrics';
  private readonly RECONNECT_INTERVAL = 5000;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  // Simplified buffer configuration
  private readonly bufferConfig: BufferConfig = {
    maxSize: 50, // Reduced buffer size
    flushInterval: 500 // Flush every 500ms
  };

  // Individual WebSocket connections for each metric
  private websockets: {
    [key: string]: WebSocketSubject<any> | null;
  } = {
    vmstat: null,
    iostat: null,
    netstat: null,
    process: null
  };

  // Connection status for each metric
  private connectionStatus: {
    [key: string]: BehaviorSubject<RealtimeConnectionStatus>;
  } = {
    vmstat: new BehaviorSubject<RealtimeConnectionStatus>(RealtimeConnectionStatus.DISCONNECTED),
    iostat: new BehaviorSubject<RealtimeConnectionStatus>(RealtimeConnectionStatus.DISCONNECTED),
    netstat: new BehaviorSubject<RealtimeConnectionStatus>(RealtimeConnectionStatus.DISCONNECTED),
    process: new BehaviorSubject<RealtimeConnectionStatus>(RealtimeConnectionStatus.DISCONNECTED)
  };

  // Reconnection attempts for each metric
  private reconnectAttempts: { [key: string]: number } = {
    vmstat: 0,
    iostat: 0,
    netstat: 0,
    process: 0
  };

  // Simplified data buffers
  private dataBuffers: {
    [key: string]: BufferedDataItem<any>[];
  } = {
    vmstat: [],
    iostat: [],
    netstat: [],
    process: []
  };

  // Data streams for each metric
  private vmstatSubject$ = new Subject<VmstatData>();
  private netstatSubject$ = new Subject<NetstatData>();
  private iostatSubject$ = new Subject<IostatData>();
  private processSubject$ = new Subject<ProcessData>();

  // Active connections tracking
  private activeConnections = new Set<string>();

  // Buffer flush timer
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

  /**
   * Start the buffer flush timer
   */
  private startBufferFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushAllBuffers();
    }, this.bufferConfig.flushInterval);
  }

  /**
   * Parse timestamp string to Date object with better error handling
   */
  private parseTimestamp(timestamp: string): Date {
    // Handle ISO and Unix timestamps consistently
    if (timestamp.includes('T')) {
        return new Date(timestamp);
    } else if (!isNaN(Number(timestamp))) {
        return new Date(Number(timestamp) * 1000);
    } else {
        // Fallback to current time
        console.warn('Unparseable timestamp:', timestamp);
        return new Date();
    }
}

  /**
   * Transform raw Django consumer message to expected format
   */
  private transformMessage(rawMessage: any, metric: string): WebSocketMessage | null {
    try {
      if (!rawMessage || typeof rawMessage !== 'object') {
        console.warn(`Invalid message format for ${metric}:`, rawMessage);
        return null;
      }

      // Check if it's already in the expected format
      if (rawMessage.metric && rawMessage.values && rawMessage.values.timestamp) {
        return rawMessage as WebSocketMessage;
      }
      
      // Handle direct data from Django consumer
      if (rawMessage.timestamp) {
        return {
          metric: metric as any,
          timestamp: rawMessage.timestamp,
          values: rawMessage,
          id: rawMessage.id,
          parsed_timestamp: rawMessage.parsed_timestamp
        };
      }
      
      console.warn(`Unable to transform message for ${metric}:`, rawMessage);
      return null;
    } catch (error) {
      console.error(`Error transforming message for ${metric}:`, error, rawMessage);
      return null;
    }
  }

  /**
   * Add data to buffer - simplified approach
   */
  private addToBuffer<T>(metric: string, data: T): void {
    if (!data || !(data as any).timestamp) {
      console.warn(`Invalid data for ${metric}, missing timestamp:`, data);
      return;
    }

    const timestamp = this.parseTimestamp((data as any).timestamp);
    
    const bufferedItem: BufferedDataItem<T> = {
      data,
      timestamp,
      originalTimestamp: (data as any).timestamp
    };

    // Add to buffer
    this.dataBuffers[metric].push(bufferedItem);

    // Keep buffer size manageable
    if (this.dataBuffers[metric].length > this.bufferConfig.maxSize) {
      this.dataBuffers[metric].pop(); // Remove oldest item
    }
  }

  /**
   * Simplified buffer flushing - just sort and emit oldest items
   */
  private flushBuffer(metric: string): void {
    const buffer = this.dataBuffers[metric];
    if (buffer.length === 0) return;

    // Sort buffer by timestamp
    buffer.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Emit all items in chronological order
    while (buffer.length > 0) {
      const item = buffer.shift()!;
      this.emitSortedData(metric, item.data);
    }
  }

  /**
   * Flush all buffers
   */
  private flushAllBuffers(): void {
    Object.keys(this.dataBuffers).forEach(metric => {
      this.flushBuffer(metric);
    });
  }

  /**
   * Emit sorted data to the appropriate subject
   */
  private emitSortedData(metric: string, data: any): void {
    try {
      switch (metric) {
        case 'vmstat':
          this.vmstatSubject$.next(data as VmstatData);
          break;
        case 'netstat':
          this.netstatSubject$.next(data as NetstatData);
          break;
        case 'iostat':
          this.iostatSubject$.next(data as IostatData);
          break;
        case 'process':
          this.processSubject$.next(data as ProcessData);
          break;
        default:
          console.warn('Unknown metric type:', metric);
      }
    } catch (error) {
      console.error(`Error emitting ${metric} data:`, error, data);
    }
  }

  /**
   * Get connection status for a specific metric
   */
  getConnectionStatus(metric: string): Observable<RealtimeConnectionStatus> {
    return this.connectionStatus[metric]?.asObservable() || EMPTY;
  }

  /**
   * Get overall connection status
   */
  getOverallConnectionStatus(): Observable<RealtimeConnectionStatus> {
    return new Observable(observer => {
      const subscription = timer(0, 1000).subscribe(() => {
        const statuses = Object.values(this.connectionStatus).map(status => status.value);

        if (statuses.every(status => status === RealtimeConnectionStatus.CONNECTED)) {
          observer.next(RealtimeConnectionStatus.CONNECTED);
        } else if (statuses.some(status => status === RealtimeConnectionStatus.CONNECTING ||
                                          status === RealtimeConnectionStatus.RECONNECTING)) {
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

  /**
   * Connect to a specific metric WebSocket
   */
  private connectToMetric(metric: string): Observable<any> {
    if (this.websockets[metric] && !this.websockets[metric]!.closed) {
      return this.websockets[metric]!.asObservable();
    }

    const url = `${this.BASE_WS_URL}/${metric}/`;
    this.connectionStatus[metric].next(RealtimeConnectionStatus.CONNECTING);
    console.log(`Connecting to ${metric} WebSocket:`, url);

    // Clear buffer on new connection
    this.dataBuffers[metric] = [];

    this.websockets[metric] = webSocket<any>({
      url: url,
      openObserver: {
        next: () => {
          console.log(`${metric} WebSocket connected successfully`);
          this.connectionStatus[metric].next(RealtimeConnectionStatus.CONNECTED);
          this.reconnectAttempts[metric] = 0;
          this.activeConnections.add(metric);
        }
      },
      closeObserver: {
        next: (event) => {
          console.log(`${metric} WebSocket disconnected:`, event);
          this.connectionStatus[metric].next(RealtimeConnectionStatus.DISCONNECTED);
          this.activeConnections.delete(metric);
          this.websockets[metric] = null;

          // Only attempt reconnection if it wasn't a normal closure
          if (event.code !== 1000) {
            this.handleReconnection(metric);
          }
        }
      }
    });

    return this.websockets[metric]!.pipe(
      tap((rawMessage: any) => {
        const transformedMessage = this.transformMessage(rawMessage, metric);
        if (transformedMessage) {
          this.handleIncomingMessage(metric, transformedMessage);
        }
      }),
      retryWhen(errors =>
        errors.pipe(
          tap(error => {
            console.error(`${metric} WebSocket error:`, error);
            this.connectionStatus[metric].next(RealtimeConnectionStatus.ERROR);
            this.websockets[metric]?.complete();
            this.websockets[metric] = null;
          }),
          delay(this.RECONNECT_INTERVAL),
          tap(() => {
            if (this.reconnectAttempts[metric] < this.MAX_RECONNECT_ATTEMPTS) {
              this.reconnectAttempts[metric]++;
              this.connectionStatus[metric].next(RealtimeConnectionStatus.RECONNECTING);
              console.log(`${metric} reconnection attempt ${this.reconnectAttempts[metric]}/${this.MAX_RECONNECT_ATTEMPTS}`);
            } else {
              console.error(`${metric} max reconnection attempts reached.`);
              this.connectionStatus[metric].next(RealtimeConnectionStatus.ERROR);
            }
          }),
          filter(() => this.reconnectAttempts[metric] < this.MAX_RECONNECT_ATTEMPTS &&
                       this.connectionStatus[metric].value !== RealtimeConnectionStatus.CONNECTED &&
                       this.connectionStatus[metric].value !== RealtimeConnectionStatus.CONNECTING
                )
        )
      ),
      catchError(error => {
        console.error(`${metric} WebSocket stream error after retries:`, error);
        if (this.connectionStatus[metric].value !== RealtimeConnectionStatus.ERROR) {
          this.connectionStatus[metric].next(RealtimeConnectionStatus.ERROR);
        }
        this.websockets[metric] = null;
        return EMPTY;
      })
    );
  }

  /**
   * Connect to all metric WebSockets
   */
  connectAll(): void {
    const metrics = ['vmstat', 'iostat', 'netstat', 'process'];

    metrics.forEach(metric => {
      if (!this.websockets[metric]) {
        this.connectToMetric(metric).subscribe({
          error: (error) => {
            console.error(`Subscription error for ${metric}:`, error);
          },
          complete: () => {
            console.log(`${metric} subscription completed.`);
          }
        });
      }
    });
  }

  /**
   * Connect to specific metrics
   */
  connectToMetrics(metrics: string[]): void {
    metrics.forEach(metric => {
      if (['vmstat', 'iostat', 'netstat', 'process'].includes(metric)) {
        if (!this.websockets[metric]) {
          this.connectToMetric(metric).subscribe({
            error: (error) => {
              console.error(`Subscription error for ${metric}:`, error);
            },
            complete: () => {
              console.log(`${metric} subscription completed.`);
            }
          });
        }
      }
    });
  }

  /**
   * Disconnect from a specific metric
   */
  disconnect(metric: string): void {
    if (this.websockets[metric]) {
      console.log(`Disconnecting ${metric} WebSocket`);
      this.websockets[metric]!.complete();
      this.websockets[metric] = null;
    }
    this.activeConnections.delete(metric);
    this.connectionStatus[metric].next(RealtimeConnectionStatus.DISCONNECTED);
    this.reconnectAttempts[metric] = 0;
    this.dataBuffers[metric] = [];
  }

  /**
   * Disconnect from all WebSockets
   */
  disconnectAll(): void {
    Object.keys(this.websockets).forEach(metric => {
      this.disconnect(metric);
    });
    Object.keys(this.connectionStatus).forEach(metric => {
      if (this.connectionStatus[metric].value !== RealtimeConnectionStatus.DISCONNECTED) {
        this.connectionStatus[metric].next(RealtimeConnectionStatus.DISCONNECTED);
      }
    });
  }

  /**
   * Start realtime monitoring for all metrics
   */
  startRealtimeMonitoring(): void {
    this.connectAll();
  }

  /**
   * Start realtime monitoring for specific metrics
   */
  startSelectiveMonitoring(metrics: string[]): void {
    this.connectToMetrics(metrics);
  }

  /**
   * Stop realtime monitoring
   */
  stopRealtimeMonitoring(): void {
    this.disconnectAll();
  }

  /**
   * Get vmstat data stream
   */
  getRealtimeVmstat(): Observable<VmstatData> {
    return this.vmstatSubject$.asObservable();
  }

  /**
   * Get netstat data stream
   */
  getRealtimeNetstat(): Observable<NetstatData> {
    return this.netstatSubject$.asObservable();
  }

  /**
   * Get iostat data stream
   */
  getRealtimeIostat(): Observable<IostatData> {
    return this.iostatSubject$.asObservable();
  }

  /**
   * Get process data stream
   */
  getRealtimeProcess(): Observable<ProcessData> {
    return this.processSubject$.asObservable();
  }

  /**
   * Send message through specific WebSocket
   */
  sendMessage(metric: string, message: any): void {
    if (this.websockets[metric] &&
        this.connectionStatus[metric].value === RealtimeConnectionStatus.CONNECTED) {
      this.websockets[metric]!.next(message);
    } else {
      console.warn(`${metric} WebSocket not connected, cannot send message:`, message);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleIncomingMessage(metric: string, message: WebSocketMessage): void {
    try {
        // Use top-level timestamp instead of values.timestamp
        const correctedData = {
            ...message.values,
            timestamp: message.timestamp // Use top-level timestamp
        };
        
        // Add to buffer for timestamp sorting
        this.addToBuffer(metric, correctedData);
    } catch (error) {
        console.error(`Error handling ${metric} message:`, error, message);
    }
  }

  /**
   * Handle reconnection logic for specific metric
   */
  private handleReconnection(metric: string): void {
    console.log(`Reconnection logic triggered for ${metric}. Relying on retryWhen.`);
  }

  /**
   * Check if a specific metric WebSocket is connected
   */
  isConnected(metric: string): boolean {
    return this.connectionStatus[metric]?.value === RealtimeConnectionStatus.CONNECTED;
  }

  /**
   * Check if all required WebSockets are connected
   */
  areAllConnected(metrics: string[]): boolean {
    return metrics.every(metric => this.isConnected(metric));
  }
}