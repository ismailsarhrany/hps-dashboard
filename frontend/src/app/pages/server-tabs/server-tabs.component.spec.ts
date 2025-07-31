import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ServerTabsComponent } from './server-tabs.component';

describe('ServerTabsComponent', () => {
  let component: ServerTabsComponent;
  let fixture: ComponentFixture<ServerTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ServerTabsComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ServerTabsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
