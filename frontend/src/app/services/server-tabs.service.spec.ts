import { TestBed } from '@angular/core/testing';

import { ServerTabsService } from './server-tabs.service';

describe('ServerTabsService', () => {
  let service: ServerTabsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ServerTabsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
