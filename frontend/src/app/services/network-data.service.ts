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

  constructor(private apiService: ApiService) { }

  /**
   * Fetches historical netstat data for a given time range.
   * Handles basic error catching and data typing.
   * Adds a warning if packet rates seem unrealistically high.
   * @param range The start and end timestamps.
   * @returns Observable array of historical netstat data points.
   */
  getHistoricalNetworkData(serverId: string,range: DateTimeRange ): Observable<HistoricalNetstatPoint[]> {
    return this.apiService.getHistoricalNetstat(serverId, range).pipe(
      map((response) => {
        let unrealisticRateDetected = false;
        // Ensure data is typed correctly and default missing IDs
        const typedData = (response?.data || []).map((d) => {
          const ipktsRate = d.ipkts_rate ?? 0;
          const opktsRate = d.opkts_rate ?? 0;

          // Check for potentially unrealistic rates
          if (
            !unrealisticRateDetected &&
            (ipktsRate > this.UNREALISTIC_RATE_THRESHOLD ||
              opktsRate > this.UNREALISTIC_RATE_THRESHOLD)
          ) {
            console.warn(
              `NetworkDataService: Detected potentially unrealistic packet rate (` +
              `ipkts_rate: ${ipktsRate}, opkts_rate: ${opktsRate}` +
              `) from API for timestamp ${d.timestamp}. ` +
              `This might indicate an issue with the source data (e.g., cumulative values instead of rates) ` +
              `or the API endpoint returning incorrect values. The chart Y-axis scale might be affected.`
            );
            unrealisticRateDetected = true; // Show warning only once per fetch
          }

          return {
            ...d,
            interface: d.interface || "default", // Assign a default interface name if missing
            // Ensure numeric fields are numbers, default to 0 if null/undefined
            ipkts_rate: ipktsRate,
            opkts_rate: opktsRate,
            ierrs_rate: d.ierrs_rate ?? 0,
            oerrs_rate: d.oerrs_rate ?? 0,
          } as HistoricalNetstatPoint;
        });

        console.log(
          `NetworkDataService: Fetched ${typedData.length} netstat points.`
        );
        return typedData;
      }),
      catchError((error) => {
        console.error(
          "NetworkDataService: Error loading historical netstat data:",
          error
        );
        return of([]); // Return an empty array on error
      })
    );
  }
}
