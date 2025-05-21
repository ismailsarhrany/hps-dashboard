import { TestBed } from '@angular/core/testing';

import { MockMonitoringService } from './mock-monitoring.service';

describe('MockMonitoringService', () => {
  let service: MockMonitoringService

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MockMonitoringService
      );
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
