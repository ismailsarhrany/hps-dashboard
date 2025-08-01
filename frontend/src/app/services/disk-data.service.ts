
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService, DateTimeRange, IostatData } from './monitoring.service'; // Adjust path as needed

// Define the specific type for historical iostat points within this service context
export interface HistoricalIostatPoint extends IostatData {
  disk: string; // Ensure disk is always string
  timestamp: string; // ISO string
  kb_read_rate: number;
  kb_wrtn_rate: number;
  tps: number;
}

@Injectable({
  providedIn: 'root' // Provide this service at the root level
})
export class DiskDataService {

  constructor(private apiService: ApiService) { }

  /**
   * Fetches historical iostat data for a given time range.
   * Handles basic error catching and data typing.
   * @param range The start and end timestamps.
   * @returns Observable array of historical iostat data points.
   */
  getHistoricalDiskData(serverId: string, range: DateTimeRange): Observable<HistoricalIostatPoint[]> {
    return this.apiService.getHistoricalIostat(serverId, range).pipe(
      map(response => {
        // Ensure data is typed correctly and default missing IDs
        const typedData = (response?.data || []).map(d => ({
          ...d,
          disk: d.disk || 'default', // Assign a default disk name if missing
          // Ensure numeric fields are numbers, default to 0 if null/undefined
          kb_read_rate: d.kb_read ?? 0,
          kb_wrtn_rate: d.kb_wrtn ?? 0,
          tps: d.tps ?? 0,
        })) as HistoricalIostatPoint[];
        console.log(`DiskDataService: Fetched ${typedData.length} iostat points.`);
        return typedData;
      }),
      catchError(error => {
        console.error('DiskDataService: Error loading historical iostat data:', error);
        return of([]); // Return an empty array on error to prevent downstream issues
      })
    );
  }
}

