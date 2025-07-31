// src/app/services/server-tab.service.ts
import { Injectable } from '@angular/core';
import { NbTabComponent } from '@nebular/theme';
import { Server } from 'D:\\projet\\frontend\\src\\app\\services\\server.services.ts';

export interface ServerTab {
  id: string;
  title: string;
  server: Server;
  subTabs: SubTab[];
  activeSubTab: string;
}

export interface SubTab {
  id: string;
  title: string;
  route: string;
}

@Injectable({ providedIn: 'root' })
export class ServerTabService {
  private serverTabs = new BehaviorSubject<ServerTab[]>([]);
  serverTabs$ = this.serverTabs.asObservable();

  private activeTabId = new BehaviorSubject<string | null>(null);
  activeTabId$ = this.activeTabId.asObservable();

  private subTabs: SubTab[] = [
    { id: 'realtime', title: 'Realtime', route: './realtime' },
    { id: 'historic', title: 'Historic', route: './historic' },
    { id: 'process', title: 'Processes', route: './process' },
  ];

  addServerTab(server: Server): void {
    const existing = this.serverTabs.value.find(t => t.id === server.id);
    if (!existing) {
      const newTab: ServerTab = {
        id: server.id,
        title: server.hostname,
        server,
        subTabs: [...this.subTabs],
        activeSubTab: 'realtime'
      };
      this.serverTabs.next([...this.serverTabs.value, newTab]);
    }
    this.setActiveTab(server.id);
  }

  removeServerTab(tabId: string): void {
    this.serverTabs.next(this.serverTabs.value.filter(t => t.id !== tabId));
  }

  setActiveTab(tabId: string): void {
    this.activeTabId.next(tabId);
  }

  setActiveSubTab(tabId: string, subTabId: string): void {
    const tabs = [...this.serverTabs.value];
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex > -1) {
      tabs[tabIndex].activeSubTab = subTabId;
      this.serverTabs.next(tabs);
    }
  }

  getTabByServerId(serverId: string): ServerTab | null {
    return this.serverTabs.value.find(t => t.id === serverId) || null;
  }
}