import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
import {
  ApiService,
  DateTimeRange,
  NetstatData,
} from "./monitoring.service"; // Adjust path as needed

// Define the specific type for historical netstat points within this service context
export interface HistoricalNetstatPoint extends NetstatData {
  interface: string; // Ensure interface is always string
  timestamp: string; // ISO string
  ipkts_rate: number;
  opkts_rate: number;
  ierrs_rate: number;
  oerrs_rate: number;
}

@Injectable({
  providedIn: "root", // Provide this service at the root level
})
export class NetworkDataService {
  // Define a threshold for potentially unrealistic packet rates (e.g., 1 billion pps)
  private readonly UNREALISTIC_RATE_THRESHOLD = 1_000_000_000;

  constructor(private apiService: ApiService) {}

  /**
   * Fetches historical netstat data for a given time range.
   * Handles basic error catching and data typing.
   * Adds a warning if packet rates seem unrealistically high.
   * @param range The start and end timestamps.
   * @returns Observable array of historical netstat data points.
   */
 getHistoricalNetworkData(range: DateTimeRange,serverId?: string): Observable<HistoricalNetstatPoint[]> {
    return this.apiService.getHistoricalNetstat(range, serverId).pipe(
      map(response => (response?.data || []).map(d => ({
        ...d,
        interface: d.interface || "default",
        ipkts_rate: d.ipkts_rate ?? 0,
        opkts_rate: d.opkts_rate ?? 0,
        ierrs_rate: d.ierrs_rate ?? 0,
        oerrs_rate: d.oerrs_rate ?? 0,
        // Ensure server fields are present
        server_hostname: d.server_hostname || d['server']?.hostname,
        server_id: d.server_id || d['server']?.server_id
      } as HistoricalNetstatPoint))),
      catchError(() => of([]))
    );
  }
}