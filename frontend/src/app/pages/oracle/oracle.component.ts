// src/app/pages/oracle/oracle.component.ts

import { Component, OnInit, OnDestroy, TemplateRef, ViewChild } from '@angular/core';
import { Subject, interval, timer, combineLatest } from 'rxjs';
import { NbDialogService, NbToastrService, NbMenuService } from '@nebular/theme';
import {
  OracleService,
  OracleDatabase,
  OracleTable,
  OracleTableData,
  DashboardData,
  OracleMonitoringTask
} from '../../services/oracle.service';
import { ServerService, Server } from '../../services/server.service';
import { takeUntil, switchMap, debounceTime, distinctUntilChanged, finalize } from 'rxjs/operators';
import { trigger, state, style, transition, animate } from '@angular/animations';

interface TableRow extends OracleTable {
  expanded?: boolean;
  currentData?: OracleTableData;
  loading?: boolean;
  tasks?: OracleMonitoringTask[];
  history?: OracleTableData[];
}

interface OracleTableConfig {
  id: number;
  full_table_name: string;
  polling_interval: number;
  columns_to_monitor: string;
  where_clause?: string;
  order_by?: string;
  timestamp_column?: string;
  primary_key_columns: string;
  is_active: boolean;
  table_name: string;
  database_id: number;
  database_name: string;
  server_name: string;
  schema_name: string;
  monitoring_status: string;
  last_poll_time: string;
  last_record_count: number;
  latest_snapshot: any;
  created_at: string;
  updated_at: string;
}

interface ExtendedOracleDatabase extends OracleDatabase {
  tables?: OracleTable[];
  statistics?: {
    table_count: number;
    recent_tasks: number;
    connection_status: string;
    last_connection_test: string;
  };
}

@Component({
  selector: 'ngx-oracle',
  templateUrl: './oracle.component.html',
  styleUrls: ['./oracle.component.scss'],
  animations: [
    trigger('slideDown', [
      transition(':enter', [
        style({ height: '0px', overflow: 'hidden' }),
        animate('300ms ease-in-out', style({ height: '*' }))
      ]),
      transition(':leave', [
        animate('300ms ease-in-out', style({ height: '0px', overflow: 'hidden' }))
      ])
    ])
  ]
})
export class OracleComponent implements OnInit, OnDestroy {
  @ViewChild('tableConfigDialog') tableConfigDialog: TemplateRef<any>;
  @ViewChild('databaseConfigDialog') databaseConfigDialog: TemplateRef<any>;
  @ViewChild('dataViewDialog') dataViewDialog: TemplateRef<any>;
  @ViewChild('taskHistoryDialog') taskHistoryDialog: TemplateRef<any>;
  @ViewChild('confirmDialog') confirmDialog: TemplateRef<any>;

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  // Data properties
  dashboardData: DashboardData | null = null;
  databases: ExtendedOracleDatabase[] = [];
  tables: TableRow[] = [];
  servers: Server[] = [];
  selectedDatabase: OracleDatabase | null = null;
  monitoringTasks: OracleMonitoringTask[] = [];

  // Loading states
  loading = {
    dashboard: false,
    databases: false,
    tables: false,
    servers: false,
    testing: new Set<number>(),
    monitoring: new Set<number>(),
    savingDatabase: false,
    savingTable: false,
    loadingTasks: false,
    bulkOperations: false
  };

  // Enhanced filters
  filters = {
    server_id: '',
    database_id: null as number | null,
    status: '',
    search: '',
    dateRange: {
      start: null as Date | null,
      end: null as Date | null
    }
  };

  // Dialog data
  dialogData = {
    table: null as OracleTableConfig | null,
    database: null as Partial<ExtendedOracleDatabase> | null,
    viewData: null as any[],
    tasks: [] as OracleMonitoringTask[],
    confirmation: {
      title: '',
      message: '',
      action: null as Function | null
    }
  };

  // Auto refresh with enhanced controls
  autoRefresh = true;
  refreshInterval = 30;
  refreshCountdown = 30;
  refreshStats = {
    lastRefresh: null as Date | null,
    totalRefreshes: 0,
    failedRefreshes: 0
  };

  // UI state
  showFilters = true;
  viewMode: 'grid' | 'list' = 'grid';
  selectedTables = new Set<number>();
  sortConfig = {
    field: 'full_table_name',
    direction: 'asc' as 'asc' | 'desc'
  };

  // Performance tracking
  performanceMetrics = {
    loadTime: 0,
    lastUpdate: null as Date | null,
    totalDataPoints: 0
  };

  constructor(
    private oracleService: OracleService,
    private serverService: ServerService,
    private dialogService: NbDialogService,
    private toastrService: NbToastrService,
    private menuService: NbMenuService
  ) {
    this.initializeNewDatabase();
    this.setupSearchDebouncing();
    this.setupMenuActions();
  }

  ngOnInit(): void {
    const startTime = performance.now();
    this.loadInitialData().then(() => {
      this.performanceMetrics.loadTime = performance.now() - startTime;
      this.performanceMetrics.lastUpdate = new Date();
    });
    this.setupAutoRefresh();
    this.setupRealtimeSubscriptions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupMenuActions(): void {
    this.menuService.onItemClick()
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        this.handleMenuAction(event);
      });
  }

  handleMenuAction(event: any): void {
    const action = event.item.data?.action;
    const value = event.item.data?.value;

    switch (action) {
      case 'setRefreshInterval':
        this.setRefreshInterval(value);
        break;
      case 'clearCache':
        this.clearCache();
        break;
      case 'resetComponent':
        this.resetComponent();
        break;
    }
  }

  handleTableAction(event: any): void {
    const action = event.item.data?.action;
    const table = event.item.data?.table;

    switch (action) {
      case 'viewData':
        if (table.currentData?.data) {
          this.openDataViewDialog(table.currentData.data, table.full_table_name);
        }
        break;
      case 'taskHistory':
        this.openTaskHistoryDialog(table);
        break;
      case 'exportData':
        this.exportTableData(table);
        break;
      case 'analyze':
        this.analyzeTableData(table);
        break;
      case 'delete':
        this.deleteTable(table);
        break;
    }
  }

  // Enhanced initialization methods
  private async loadInitialData(): Promise<void> {
    try {
      // Load data in parallel for better performance
      await Promise.all([
        this.loadServers(),
        this.loadDashboardData(),
        this.loadDatabases(),
        this.loadTables()
      ]);
    } catch (error) {
      this.showError('Failed to load initial data');
      console.error('Initialization error:', error);
    }
  }

  private setupRealtimeSubscriptions(): void {
    // Enhanced real-time subscriptions with error handling
    this.oracleService.dashboardData$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          if (data) {
            this.dashboardData = data;
            this.performanceMetrics.totalDataPoints += 1;
          }
        },
        error: (error) => this.showError('Real-time dashboard updates failed')
      });

    this.oracleService.tables$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (tables) => {
          if (tables.length > 0) {
            this.updateTables(tables);
          }
        },
        error: (error) => this.showError('Real-time table updates failed')
      });

    this.oracleService.databases$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (databases) => {
          if (databases.length > 0) {
            this.databases = databases.map(db => ({ ...db, tables: [], statistics: undefined }));
          }
        },
        error: (error) => this.showError('Real-time database updates failed')
      });
  }

  private setupAutoRefresh(): void {
    interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.autoRefresh) {
          this.refreshCountdown--;
          if (this.refreshCountdown <= 0) {
            this.refreshCountdown = this.refreshInterval;
            this.refreshData();
          }
        } else {
          this.refreshCountdown = this.refreshInterval;
        }
      });
  }

  private setupSearchDebouncing(): void {
    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      this.filters.search = searchTerm;
      // Could trigger server-side search here if needed
    });
  }

  private initializeNewDatabase(): void {
    this.dialogData.database = {
      name: '',
      host: '',
      port: 1521,
      sid: '',
      username: '',
      password: '',
      connection_timeout: 30,
      is_active: true,
      server_id: undefined,
      connection_status: 'unknown',
      connection_status_display: 'Not Tested',
      last_connection_test: '',
      monitored_tables_count: 0,
      created_at: '',
      updated_at: ''
    };
  }

  // Enhanced data loading methods
  loadServers(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loading.servers = true;
      this.serverService.getServers()
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.loading.servers = false)
        )
        .subscribe({
          next: (response) => {
            this.servers = response.servers || [];
            resolve();
          },
          error: (error) => {
            this.showError('Failed to load servers');
            reject(error);
          }
        });
    });
  }

  loadDashboardData(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loading.dashboard = true;
      this.oracleService.getDashboardData()
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.loading.dashboard = false)
        )
        .subscribe({
          next: (data) => {
            this.dashboardData = data;
            resolve();
          },
          error: (error) => {
            this.showError('Failed to load dashboard data');
            reject(error);
          }
        });
    });
  }

  loadDatabases(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loading.databases = true;
      this.oracleService.getDatabases(this.filters.server_id || undefined)
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.loading.databases = false)
        )
        .subscribe({
          next: async (databases) => {
            // Enhanced database loading with statistics
            this.databases = await Promise.all(
              databases.map(async db => {
                try {
                  const [status, tables] = await Promise.all([
                    this.oracleService.getDatabaseStatus(db.id).toPromise(),
                    this.oracleService.getTables({ database_id: db.id }).toPromise()
                  ]);
                  return {
                    ...db,
                    statistics: status.statistics,
                    tables: tables || []
                  } as ExtendedOracleDatabase;
                } catch (error) {
                  return {
                    ...db,
                    statistics: undefined,
                    tables: []
                  } as ExtendedOracleDatabase;
                }
              })
            );
            resolve();
          },
          error: (error) => {
            this.showError('Failed to load databases');
            reject(error);
          }
        });
    });
  }

  loadTables(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loading.tables = true;
      const filters = {
        database_id: this.filters.database_id,
        server_id: this.filters.server_id || undefined
      };

      this.oracleService.getTables(filters)
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.loading.tables = false)
        )
        .subscribe({
          next: (tables) => {
            this.updateTables(tables);
            resolve();
          },
          error: (error) => {
            this.showError('Failed to load tables');
            reject(error);
          }
        });
    });
  }

  // Enhanced table management
  private updateTables(newTables: OracleTable[]): void {
    const expandedIds = new Set(this.tables.filter(t => t.expanded).map(t => t.id));
    const loadingIds = new Set(this.tables.filter(t => t.loading).map(t => t.id));

    this.tables = newTables.map(table => ({
      ...table,
      expanded: expandedIds.has(table.id),
      loading: loadingIds.has(table.id),
      tasks: [],
      history: []
    }));
  }

  // Enhanced filter methods
  onSearchChange(searchTerm: string): void {
    this.searchSubject$.next(searchTerm);
  }

  onServerFilterChange(serverId: string): void {
    this.filters.server_id = serverId;
    this.filters.database_id = null;
    this.selectedDatabase = null;
    this.loadDatabases();
    this.loadTables();
  }

  onDatabaseFilterChange(databaseId: number | null): void {
    this.filters.database_id = databaseId;
    this.selectedDatabase = this.databases.find(db => db.id === databaseId) || null;
    this.loadTables();
  }

  onStatusFilterChange(status: string): void {
    this.filters.status = status;
  }

  onDateRangeChange(start: Date | null, end: Date | null): void {
    this.filters.dateRange = { start, end };
    // Implement date-based filtering if needed
  }

  clearFilters(): void {
    this.filters = {
      server_id: '',
      database_id: null,
      status: '',
      search: '',
      dateRange: { start: null, end: null }
    };
    this.selectedDatabase = null;
    this.loadDatabases();
    this.loadTables();
  }

  // Enhanced table operations
  testDatabaseConnection(database: ExtendedOracleDatabase): void {
    this.loading.testing.add(database.id);

    this.oracleService.testDatabaseConnection(database.id)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.testing.delete(database.id))
      )
      .subscribe({
        next: (result) => {
          if (result.success) {
            this.showSuccess(`Connection to ${database.name} successful`);
            database.connection_status = 'connected';
            database.connection_status_display = 'Connected';
          } else {
            this.showError(`Connection failed: ${result.message}`);
            database.connection_status = 'failed';
            database.connection_status_display = 'Failed';
          }
          this.loadDatabases();
        },
        error: (error) => {
          this.showError('Connection test failed');
          database.connection_status = 'error';
          database.connection_status_display = 'Error';
        }
      });
  }

  monitorTableNow(table: TableRow): void {
    this.loading.monitoring.add(table.id);
    table.loading = true;

    this.oracleService.monitorTableNow(table.id)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.loading.monitoring.delete(table.id);
          table.loading = false;
        })
      )
      .subscribe({
        next: (result) => {
          if (result.success) {
            this.showSuccess(
              `Monitoring completed for ${table.table_name}: ${result.records_collected || 0} records`
            );
            this.loadTables();
            this.loadTableCurrentData(table);
          } else {
            this.showError(`Monitoring failed: ${result.error}`);
          }
        },
        error: (error) => {
          this.showError('Monitoring failed');
        }
      });
  }

  toggleTableExpansion(table: TableRow): void {
    table.expanded = !table.expanded;

    if (table.expanded) {
      this.loadTableDetails(table);
    }
  }

  private async loadTableDetails(table: TableRow): Promise<void> {
    table.loading = true;
    try {
      const [currentData, history, tasks] = await Promise.all([
        this.oracleService.getCurrentTableData(table.id).toPromise(),
        this.oracleService.getTableHistory(table.id, 5).toPromise(),
        this.oracleService.getTableMonitoringTasks(table.id, 10).toPromise()
      ]);

      table.currentData = currentData;
      table.history = history;
      table.tasks = tasks;
    } catch (error) {
      this.showError('Failed to load table details');
    } finally {
      table.loading = false;
    }
  }

  private loadTableCurrentData(table: TableRow): void {
    this.oracleService.getCurrentTableData(table.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          table.currentData = result;
        },
        error: (error) => {
          this.showError('Failed to load table data');
        }
      });
  }

  // Enhanced dialog methods
  openTableConfigDialog(table: OracleTable): void {
    this.dialogData.table = {
      ...table,
      columns_to_monitor: Array.isArray(table.columns_to_monitor) 
        ? table.columns_to_monitor.join(', ')
        : table.columns_to_monitor || '',
      primary_key_columns: Array.isArray(table.primary_key_columns)
        ? table.primary_key_columns.join(', ')
        : table.primary_key_columns || ''
    } as OracleTableConfig;

    this.dialogService.open(this.tableConfigDialog, {
      autoFocus: true,
      closeOnBackdropClick: false
    });
  }

  openDatabaseConfigDialog(database?: ExtendedOracleDatabase): void {
    if (database) {
      this.dialogData.database = { ...database };
    } else {
      this.initializeNewDatabase();
    }

    this.dialogService.open(this.databaseConfigDialog, {
      autoFocus: true,
      closeOnBackdropClick: false
    });
  }

  openDataViewDialog(data: any[], title?: string): void {
    this.dialogData.viewData = data;
    this.dialogService.open(this.dataViewDialog, {
      autoFocus: false,
      closeOnBackdropClick: true,
      context: { title: title || 'Table Data' }
    });
  }

  openTaskHistoryDialog(table: TableRow): void {
    this.loading.loadingTasks = true;
    this.oracleService.getTableMonitoringTasks(table.id, 50)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.loadingTasks = false)
      )
      .subscribe({
        next: (tasks) => {
          this.dialogData.tasks = tasks;
          this.dialogService.open(this.taskHistoryDialog, {
            autoFocus: false,
            closeOnBackdropClick: true,
            context: { table: table }
          });
        },
        error: (error) => {
          this.showError('Failed to load task history');
        }
      });
  }

  openConfirmDialog(title: string, message: string, action: Function): void {
    this.dialogData.confirmation = { title, message, action };
    this.dialogService.open(this.confirmDialog, {
      autoFocus: true,
      closeOnBackdropClick: false
    });
  }

  // Enhanced save methods
  saveDatabaseConfig(): void {
    if (!this.dialogData.database) return;

    this.loading.savingDatabase = true;
    const dbData = { ...this.dialogData.database };

    if (dbData.server_id) {
      dbData.server_id = dbData.server_id.toString();
    }

    const saveObservable = dbData.id
      ? this.oracleService.updateDatabase(dbData.id, dbData)
      : this.oracleService.createDatabase(dbData);

    saveObservable
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.savingDatabase = false)
      )
      .subscribe({
        next: (result) => {
          this.showSuccess(`Database ${dbData.id ? 'updated' : 'created'} successfully`);
          this.loadDatabases();
          this.loadTables();
        },
        error: (error) => {
          this.showError(`Failed to ${dbData.id ? 'update' : 'create'} database`);
        }
      });
  }

  saveTableConfig(): void {
    if (!this.dialogData.table) return;

    this.loading.savingTable = true;

    const config = {
      polling_interval: this.dialogData.table.polling_interval,
      columns_to_monitor: this.dialogData.table.columns_to_monitor,
      where_clause: this.dialogData.table.where_clause,
      order_by: this.dialogData.table.order_by,
      timestamp_column: this.dialogData.table.timestamp_column,
      primary_key_columns: this.dialogData.table.primary_key_columns,
      is_active: this.dialogData.table.is_active
    };

    this.oracleService.updateTableConfig(this.dialogData.table.id, config)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.savingTable = false)
      )
      .subscribe({
        next: (result) => {
          this.showSuccess('Table configuration updated');
          this.loadTables();
        },
        error: (error) => {
          this.showError('Failed to update configuration');
        }
      });
  }

  // Enhanced refresh and auto-refresh
  toggleAutoRefresh(): void {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.refreshCountdown = this.refreshInterval;
      this.showSuccess('Auto refresh enabled');
    } else {
      this.showInfo('Auto refresh disabled');
    }
  }

  refreshData(): void {
    this.refreshStats.totalRefreshes++;
    try {
      Promise.all([
        this.loadDashboardData(),
        this.loadDatabases(),
        this.loadTables()
      ]).then(() => {
        this.refreshStats.lastRefresh = new Date();
        this.showInfo('Data refreshed');
      }).catch(() => {
        this.refreshStats.failedRefreshes++;
        this.showError('Refresh failed');
      });
    } catch (error) {
      this.refreshStats.failedRefreshes++;
      this.showError('Refresh failed');
    }
  }

  setRefreshInterval(seconds: number): void {
    this.refreshInterval = seconds;
    this.refreshCountdown = seconds;
    this.showInfo(`Refresh interval set to ${seconds} seconds`);
  }

  // Enhanced table selection and bulk operations
  toggleTableSelection(table: TableRow): void {
    if (this.selectedTables.has(table.id)) {
      this.selectedTables.delete(table.id);
    } else {
      this.selectedTables.add(table.id);
    }
  }

  selectAllTables(select: boolean): void {
    if (select) {
      this.filteredTables.forEach(table => this.selectedTables.add(table.id));
    } else {
      this.selectedTables.clear();
    }
  }

  bulkActivateTables(active: boolean): void {
    if (this.selectedTables.size === 0) {
      this.showWarning('No tables selected');
      return;
    }

    const action = active ? 'activate' : 'deactivate';
    this.openConfirmDialog(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Tables`,
      `Are you sure you want to ${action} ${this.selectedTables.size} selected tables?`,
      () => this.processBulkActivation(active)
    );
  }

  bulkMonitorTables(): void {
    if (this.selectedTables.size === 0) {
      this.showWarning('No tables selected');
      return;
    }

    this.openConfirmDialog(
      'Monitor Selected Tables',
      `Are you sure you want to start monitoring ${this.selectedTables.size} selected tables?`,
      () => this.processBulkMonitoring()
    );
  }

  private processBulkActivation(active: boolean): void {
    this.loading.bulkOperations = true;
    const selectedTableIds = Array.from(this.selectedTables);

    const updates = selectedTableIds.map(tableId => 
      this.oracleService.updateTableConfig(tableId, { is_active: active }).toPromise()
    );

    Promise.all(updates)
      .then(() => {
        this.showSuccess(`${selectedTableIds.length} tables updated successfully`);
        this.selectedTables.clear();
        this.loadTables();
      })
      .catch(error => {
        this.showError(`Failed to update tables: ${error.message}`);
      })
      .finally(() => {
        this.loading.bulkOperations = false;
      });
  }

  private processBulkMonitoring(): void {
    this.loading.bulkOperations = true;
    const selectedTableIds = Array.from(this.selectedTables);

    const monitoringTasks = selectedTableIds.map(tableId =>
      this.oracleService.monitorTableNow(tableId).toPromise()
    );

    Promise.all(monitoringTasks)
      .then(() => {
        this.showSuccess(`Started monitoring ${selectedTableIds.length} tables`);
        this.selectedTables.clear();
        this.loadTables();
      })
      .catch(error => {
        this.showError(`Failed to start monitoring: ${error.message}`);
      })
      .finally(() => {
        this.loading.bulkOperations = false;
      });
  }

  // Enhanced sorting and filtering
  sortTables(field: string): void {
    if (this.sortConfig.field === field) {
      this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortConfig.field = field;
      this.sortConfig.direction = 'asc';
    }
  }

  /**
   * Get the appropriate sort icon based on current sort configuration
   * @param field The field to check sort status for
   * @returns The icon name for the sort indicator
   */
  getSortIcon(field: string): string {
    if (this.sortConfig.field !== field) {
      return 'minus-outline'; // No sort applied to this field
    }
    
    return this.sortConfig.direction === 'asc' 
      ? 'arrow-up-outline' 
      : 'arrow-down-outline';
  }

  get filteredTables(): TableRow[] {
    let filtered = [...this.tables];

    // Apply filters
    if (this.filters.status) {
      filtered = filtered.filter(t => t.monitoring_status === this.filters.status);
    }

    if (this.filters.search) {
      const search = this.filters.search.toLowerCase();
      filtered = filtered.filter(t =>
        t.table_name.toLowerCase().includes(search) ||
        t.database_name.toLowerCase().includes(search) ||
        t.server_name.toLowerCase().includes(search) ||
        t.schema_name.toLowerCase().includes(search) ||
        t.full_table_name.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue = a[this.sortConfig.field];
      let bValue = b[this.sortConfig.field];

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) {
        return this.sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return this.sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return filtered;
  }

  // Enhanced export functionality
  exportTableData(table: TableRow): void {
    if (!table.currentData?.data) {
      this.showWarning('No data available to export');
      return;
    }

    const csvContent = this.convertToCSV(table.currentData.data);
    this.downloadFile(csvContent, `${table.full_table_name}_${new Date().getTime()}.csv`, 'text/csv');
  }

  exportData(): void {
    if (!this.dialogData.viewData) {
      this.showWarning('No data available to export');
      return;
    }

    const csvContent = this.convertToCSV(this.dialogData.viewData);
    this.downloadFile(csvContent, `table_data_${new Date().getTime()}.csv`, 'text/csv');
  }

  exportConfiguration(): void {
    const config = {
      databases: this.databases,
      tables: this.tables,
      exportedAt: new Date().toISOString()
    };

    const jsonContent = JSON.stringify(config, null, 2);
    this.downloadFile(jsonContent, `oracle_config_${new Date().getTime()}.json`, 'application/json');
  }

  private downloadFile(content: string, filename: string, contentType: string): void {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  private convertToCSV(data: any[]): string {
    if (!data.length) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row =>
        headers.map(header => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      )
    ];

    return csvRows.join('\n');
  }

  // Utility methods
  getStatusBadgeStatus(status: string): string {
    return this.oracleService.getMonitoringStatusColor(status);
  }

  getConnectionStatusBadgeStatus(status: string): string {
    return this.oracleService.getConnectionStatusColor(status);
  }

  formatDuration(seconds: number): string {
    return this.oracleService.formatDuration(seconds);
  }

  formatTimestamp(timestamp: string): string {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  formatCellValue(value: any): string {
    if (value === null || value === undefined) {
      return '-';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    if (typeof value === 'string' && value.length > 50) {
      return value.substring(0, 50) + '...';
    }
    return String(value);
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // UI Helper methods
  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
  }

  getProgressPercentage(current: number, total: number): number {
    return total > 0 ? Math.round((current / total) * 100) : 0;
  }

  // Advanced statistics and analytics
  getTableHealthScore(table: TableRow): number {
    let score = 100;
    
    if (!table.is_active) score -= 30;
    if (table.monitoring_status === 'error') score -= 40;
    if (table.monitoring_status === 'overdue') score -= 20;
    if (!table.last_poll_time) score -= 25;
    
    const lastPoll = table.last_poll_time ? new Date(table.last_poll_time) : null;
    if (lastPoll) {
      const minutesSinceLastPoll = (Date.now() - lastPoll.getTime()) / 60000;
      const expectedInterval = table.polling_interval / 60;
      if (minutesSinceLastPoll > expectedInterval * 2) score -= 15;
    }

    return Math.max(0, score);
  }

  getDatabaseHealthScore(database: ExtendedOracleDatabase): number {
    let score = 100;
    
    if (database.connection_status !== 'connected') score -= 50;
    if (!database.is_active) score -= 30;
    
    const tables = database.tables || [];
    const activeTables = tables.filter(t => t.is_active).length;
    const totalTables = tables.length;
    
    if (totalTables > 0 && activeTables / totalTables < 0.5) score -= 20;

    return Math.max(0, score);
  }

  getSystemOverallHealth(): number {
    if (this.databases.length === 0) return 0;
    
    const dbScores = this.databases.map(db => this.getDatabaseHealthScore(db));
    return Math.round(dbScores.reduce((sum, score) => sum + score, 0) / dbScores.length);
  }

  // Notification methods
  private showSuccess(message: string): void {
    this.toastrService.success(message, 'Success', { duration: 3000 });
  }

  private showError(message: string): void {
    this.toastrService.danger(message, 'Error', { duration: 5000 });
  }

  private showInfo(message: string): void {
    this.toastrService.info(message, 'Info', { duration: 3000 });
  }

  private showWarning(message: string): void {
    this.toastrService.warning(message, 'Warning', { duration: 4000 });
  }

  // Template helper methods
  trackByTableId(index: number, table: TableRow): number {
    return table.id;
  }

  trackByDatabaseId(index: number, database: ExtendedOracleDatabase): number {
    return database.id;
  }

  trackByServerId(index: number, server: Server): string {
    return server.id;
  }

  getObjectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }

  isTableSelected(table: TableRow): boolean {
    return this.selectedTables.has(table.id);
  }

  // Validation helpers
  isDatabaseFormValid(): boolean {
    const db = this.dialogData.database;
    return !!(db?.name && db?.host && db?.port && db?.sid && db?.username && db?.server_id);
  }

  isTableFormValid(): boolean {
    const table = this.dialogData.table;
    return !!(table?.polling_interval && table.polling_interval >= 10);
  }

  // Advanced getters for template
  get uniqueStatuses(): string[] {
    const statuses = new Set(this.tables.map(t => t.monitoring_status));
    return Array.from(statuses).sort();
  }

  get uniqueServers(): string[] {
    const servers = new Set(this.tables.map(t => t.server_name));
    return Array.from(servers).sort();
  }

  get filteredDatabases(): ExtendedOracleDatabase[] {
    if (!this.filters.server_id) {
      return this.databases;
    }
    return this.databases.filter(db => db.server_id === this.filters.server_id);
  }

  get refreshProgressPercentage(): number {
    return Math.round(((this.refreshInterval - this.refreshCountdown) / this.refreshInterval) * 100);
  }

  get selectedTableCount(): number {
    return this.selectedTables.size;
  }

  get isAllTablesSelected(): boolean {
    return this.filteredTables.length > 0 && this.filteredTables.every(table => this.selectedTables.has(table.id));
  }

  get isSomeTablesSelected(): boolean {
    return this.selectedTables.size > 0 && this.selectedTables.size < this.filteredTables.length;
  }

  // Enhanced statistics
  get tableStatusCounts(): { [key: string]: number } {
    const counts = { total: this.tables.length };
    this.tables.forEach(table => {
      const status = table.monitoring_status;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }

  get databaseStatusCounts(): { [key: string]: number } {
    const counts = { total: this.databases.length };
    this.databases.forEach(database => {
      const status = database.connection_status;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }

  get systemStatistics() {
    return {
      totalDatabases: this.databases.length,
      connectedDatabases: this.databases.filter(db => db.connection_status === 'connected').length,
      totalTables: this.tables.length,
      activeTables: this.tables.filter(t => t.is_active).length,
      healthyTables: this.tables.filter(t => this.getTableHealthScore(t) >= 80).length,
      overallHealth: this.getSystemOverallHealth(),
      lastRefresh: this.refreshStats.lastRefresh,
      totalRefreshes: this.refreshStats.totalRefreshes,
      failedRefreshes: this.refreshStats.failedRefreshes
    };
  }

  // Connection and monitoring methods
  testAllDatabaseConnections(): void {
    if (this.databases.length === 0) {
      this.showWarning('No databases to test');
      return;
    }

    this.openConfirmDialog(
      'Test All Connections',
      `Are you sure you want to test connections for all ${this.databases.length} databases?`,
      () => this.processConnectionTests()
    );
  }

  private processConnectionTests(): void {
    this.loading.bulkOperations = true;
    let completed = 0;
    let successful = 0;

    this.databases.forEach(database => {
      this.oracleService.testDatabaseConnection(database.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (result) => {
            completed++;
            if (result.success) {
              successful++;
              database.connection_status = 'connected';
              database.connection_status_display = 'Connected';
            } else {
              database.connection_status = 'failed';
              database.connection_status_display = 'Failed';
            }

            if (completed === this.databases.length) {
              this.loading.bulkOperations = false;
              this.showInfo(`Connection tests completed: ${successful}/${completed} successful`);
            }
          },
          error: () => {
            completed++;
            database.connection_status = 'error';
            database.connection_status_display = 'Error';

            if (completed === this.databases.length) {
              this.loading.bulkOperations = false;
              this.showInfo(`Connection tests completed: ${successful}/${completed} successful`);
            }
          }
        });
    });
  }

  // Database management methods
  deleteDatabase(database: ExtendedOracleDatabase): void {
    this.openConfirmDialog(
      'Delete Database',
      `Are you sure you want to delete database "${database.name}"? This will also remove all associated table configurations.`,
      () => this.confirmDeleteDatabase(database.id)
    );
  }

  private confirmDeleteDatabase(databaseId: number): void {
    this.oracleService.deleteDatabase(databaseId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showSuccess('Database deleted successfully');
          this.loadDatabases();
          this.loadTables();
        },
        error: (error) => {
          this.showError('Failed to delete database');
        }
      });
  }

  // Table management methods
  deleteTable(table: TableRow): void {
    this.openConfirmDialog(
      'Delete Table Configuration',
      `Are you sure you want to delete monitoring configuration for table "${table.full_table_name}"?`,
      () => this.confirmDeleteTable(table.id)
    );
  }

  private confirmDeleteTable(tableId: number): void {
    this.oracleService.deleteTable(tableId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showSuccess('Table configuration deleted successfully');
          this.loadTables();
        },
        error: (error) => {
          this.showError('Failed to delete table configuration');
        }
      });
  }

  // Data analysis methods
  analyzeTableData(table: TableRow): void {
    if (!table.currentData?.data || table.currentData.data.length === 0) {
      this.showWarning('No data available for analysis');
      return;
    }

    const analysis = this.performDataAnalysis(table.currentData.data);
    this.showInfo(`Analysis complete: ${analysis.recordCount} records, ${analysis.columnCount} columns`);
  }

  private performDataAnalysis(data: any[]): any {
    if (!data || data.length === 0) return {};

    const analysis = {
      recordCount: data.length,
      columnCount: Object.keys(data[0] || {}).length,
      columns: {},
      summary: {}
    };

    const columns = Object.keys(data[0] || {});
    
    columns.forEach(column => {
      const values = data.map(row => row[column]).filter(val => val !== null && val !== undefined);
      analysis.columns[column] = {
        nonNullCount: values.length,
        nullCount: data.length - values.length,
        uniqueValues: new Set(values).size,
        dataTypes: [...new Set(values.map(val => typeof val))]
      };
    });

    return analysis;
  }

  // Real-time monitoring controls
  pauseRealTimeUpdates(): void {
    this.autoRefresh = false;
    this.showInfo('Real-time updates paused');
  }

  resumeRealTimeUpdates(): void {
    this.autoRefresh = true;
    this.refreshCountdown = this.refreshInterval;
    this.showInfo('Real-time updates resumed');
  }

  // Performance monitoring
  getComponentPerformance() {
    return {
      loadTime: this.performanceMetrics.loadTime,
      lastUpdate: this.performanceMetrics.lastUpdate,
      totalDataPoints: this.performanceMetrics.totalDataPoints,
      refreshStats: this.refreshStats,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  private estimateMemoryUsage(): number {
    // Rough estimation of memory usage
    const jsonString = JSON.stringify({
      databases: this.databases,
      tables: this.tables,
      dashboardData: this.dashboardData
    });
    return new Blob([jsonString]).size;
  }

  // Help and documentation methods
  openHelp(): void {
    this.showInfo('Help documentation would open here');
  }

  openDocumentation(): void {
    this.showInfo('API documentation would open here');
  }

  // Cleanup and resource management
  clearCache(): void {
    this.tables.forEach(table => {
      table.currentData = undefined;
      table.history = [];
      table.tasks = [];
    });
    this.showInfo('Cache cleared');
  }

  resetComponent(): void {
    this.openConfirmDialog(
      'Reset Component',
      'Are you sure you want to reset all data and reload from server?',
      () => {
        this.clearCache();
        this.selectedTables.clear();
        this.filters = {
          server_id: '',
          database_id: null,
          status: '',
          search: '',
          dateRange: { start: null, end: null }
        };
        this.loadInitialData();
      }
    );
  }
}