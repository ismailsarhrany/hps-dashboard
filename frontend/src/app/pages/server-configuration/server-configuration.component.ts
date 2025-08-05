// server-configuration.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ServerService, Server } from '../../services/server.service';
import { NbDialogService, NbToastrService } from '@nebular/theme';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  selector: 'ngx-server-configuration',
  templateUrl: './server-configuration.component.html',
  styleUrls: ['./server-configuration.component.scss']
})
export class ServerConfigurationComponent implements OnInit, OnDestroy {
  servers: Server[] = [];
  selectedServer: Server | null = null;
  serverForm: FormGroup;
  isEditing = false;
  isAddingNew = false;
  loading = false;
  saving = false;
  testing = false;

  // For password/key visibility toggle
  showPassword = false;
  showSshKey = false;

  private destroy$ = new Subject<void>();

  // Status options for dropdown
  statusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'error', label: 'Error' },
    { value: 'maintenance', label: 'Maintenance' }
  ];

  // OS type options - match your API response format
  osTypeOptions = [
    { value: 'Linux', label: 'Linux' },
    { value: 'Windows', label: 'Windows' },
    { value: 'Unix', label: 'Unix' },
    { value: 'Other', label: 'Other' }
  ];

  constructor(
    private fb: FormBuilder,
    private serverService: ServerService,
    private dialogService: NbDialogService,
    private toastrService: NbToastrService
  ) {
    this.initializeForm();
  }

  ngOnInit() {
    this.loadServers();
    this.setupFormSubscriptions();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForm() {
    this.serverForm = this.fb.group({
      alias: [''],
      hostname: ['', [Validators.required, Validators.pattern(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/)]],
      ip_address: ['', [Validators.required, Validators.pattern(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/)]],
      ssh_port: [22, [Validators.required, Validators.min(1), Validators.max(65535)]],
      ssh_username: ['', Validators.required],
      ssh_password: [''],
      ssh_key_path: [''],
      os_type: ['Linux'], // Changed default to match API
      os_version: [''],
      architecture: [''],
      status: ['active'],
      monitoring_enabled: [true],
      monitoring_interval: [60, [Validators.min(30), Validators.max(3600)]],
      description: [''],
      location: [''],
      environment: ['']
    });
  }

  private setupFormSubscriptions() {
    // Auto-save draft changes (debounced)
    this.serverForm.valueChanges
      .pipe(
        takeUntil(this.destroy$),
        debounceTime(1000),
        distinctUntilChanged()
      )
      .subscribe(() => {
        if (this.isEditing && !this.saving) {
          this.saveDraft();
        }
      });
  }

  public loadServers() {
    this.loading = true;
    this.serverService.fetchServers();

    this.serverService.servers$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (servers) => {
          this.servers = servers;
          this.loading = false;

          // Keep selected server if it still exists
          if (this.selectedServer) {
            const updatedServer = servers.find(s => s.id === this.selectedServer?.id);
            if (updatedServer) {
              this.selectedServer = updatedServer;
              // Refresh the form with updated data if not editing
              if (!this.isEditing) {
                this.loadServerDetails(updatedServer);
              }
            } else {
              this.selectedServer = null;
              this.cancelEdit();
            }
          }
        },
        error: (error) => {
          this.loading = false;
          this.toastrService.danger('Failed to load servers', 'Error');
          console.error('Failed to load servers:', error);
        }
      });
  }

  selectServer(server: Server) {
    if (this.isEditing && this.serverForm.dirty) {
      this.dialogService.open(ConfirmDialogComponent, {
        context: {
          title: 'Unsaved Changes',
          message: 'You have unsaved changes. Do you want to save them before switching servers?',
          confirmText: 'Save Changes',
          cancelText: 'Discard Changes'
        }
      }).onClose.subscribe((confirmed) => {
        if (confirmed) {
          this.saveServer().then(() => {
            this.loadServerDetails(server);
          });
        } else {
          this.loadServerDetails(server);
        }
      });
    } else {
      this.loadServerDetails(server);
    }
  }

  private loadServerDetails(server: Server) {
    this.selectedServer = server;
    this.isAddingNew = false;
    this.isEditing = false;

    // Create a clean copy of server data
    const formData = {
      alias: server.alias || '',
      hostname: server.hostname || '',
      ip_address: server.ip_address || '',
      ssh_port: server.ssh_port || 22,
      ssh_username: server.ssh_username || '',
      ssh_password: server.ssh_password ? '••••••••' : '',
      ssh_key_path: server.ssh_key_path ? '••••••••••••••••' : '',
      os_type: server.os_type || 'Linux',
      os_version: server.os_version || '',
      architecture: server.architecture || '',
      status: server.status || 'active',
      monitoring_enabled: server.monitoring_enabled !== undefined ? server.monitoring_enabled : true,
      monitoring_interval: server.monitoring_interval || 60,
      description: server.description || '',
      location: server.location || '',
      environment: server.environment || ''
    };

    console.log('Loading server details:', server);
    console.log('Form data:', formData);

    // Reset form first, then patch values, then disable
    this.serverForm.reset();
    this.serverForm.patchValue(formData);
    this.serverForm.disable();
    this.showPassword = false;
    this.showSshKey = false;
  }

  startAddNew() {
    if (this.isEditing && this.serverForm.dirty) {
      this.dialogService.open(ConfirmDialogComponent, {
        context: {
          title: 'Unsaved Changes',
          message: 'You have unsaved changes. Do you want to save them before adding a new server?',
          confirmText: 'Save Changes',
          cancelText: 'Discard Changes'
        }
      }).onClose.subscribe((confirmed) => {
        if (confirmed) {
          this.saveServer().then(() => {
            this.initializeNewServer();
          });
        } else {
          this.initializeNewServer();
        }
      });
    } else {
      this.initializeNewServer();
    }
  }

  private initializeNewServer() {
    this.selectedServer = null;
    this.isAddingNew = true;
    this.isEditing = true;
    
    // Reset form with default values
    this.serverForm.reset({
      alias: '',
      hostname: '',
      ip_address: '',
      ssh_port: 22,
      ssh_username: '',
      ssh_password: '',
      ssh_key_path: '',
      os_type: 'Linux',
      os_version: '',
      architecture: '',
      status: 'active',
      monitoring_enabled: true,
      monitoring_interval: 60,
      description: '',
      location: '',
      environment: ''
    });
    
    this.serverForm.enable();
    this.showPassword = false;
    this.showSshKey = false;
  }

  startEdit() {
    if (!this.selectedServer) return;

    this.isEditing = true;
    this.serverForm.enable();

    // Clear masked sensitive fields to allow editing
    if (this.serverForm.get('ssh_password')?.value === '••••••••') {
      this.serverForm.patchValue({ ssh_password: '' });
    }
    if (this.serverForm.get('ssh_key_path')?.value === '••••••••••••••••') {
      this.serverForm.patchValue({ ssh_key_path: '' });
    }
  }

  cancelEdit() {
    if (this.isAddingNew) {
      this.isAddingNew = false;
      this.selectedServer = null;
      this.serverForm.reset();
      this.serverForm.disable();
    } else if (this.selectedServer) {
      this.loadServerDetails(this.selectedServer);
    }
    this.isEditing = false;
  }

  async saveServer(): Promise<boolean> {
    if (!this.serverForm.valid) {
      this.markFormGroupTouched(this.serverForm);
      this.toastrService.warning('Please fix form errors before saving', 'Validation Error');
      return false;
    }

    this.saving = true;
    const formData = { ...this.serverForm.value };

    // Clean up form data
    Object.keys(formData).forEach(key => {
      if (formData[key] === null || formData[key] === undefined) {
        formData[key] = '';
      }
    });

    // Don't send masked passwords
    if (formData.ssh_password === '••••••••') {
      delete formData.ssh_password;
    }
    if (formData.ssh_key_path === '••••••••••••••••') {
      delete formData.ssh_key_path;
    }

    // Convert empty strings to null for nullable fields
    const nullableFields = ['description', 'location', 'environment', 'os_version', 'architecture'];
    nullableFields.forEach(field => {
      if (formData[field] === '') {
        formData[field] = null;
      }
    });

    try {
      if (this.isAddingNew) {
        await this.createServer(formData);
      } else if (this.selectedServer) {
        await this.updateServer(this.selectedServer.id, formData);
      }

      this.saving = false;
      this.isEditing = false;
      this.isAddingNew = false;
      this.loadServers();
      return true;
    } catch (error) {
      this.saving = false;
      console.error('Save error:', error);
      return false;
    }
  }

  private createServer(serverData: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.serverService.createServer(serverData).subscribe({
        next: (response) => {
          this.toastrService.success('Server created successfully', 'Success');
          resolve();
        },
        error: (error) => {
          console.error('Create server error:', error);
          let errorMessage = 'Failed to create server';
          if (error.error && error.error.message) {
            errorMessage = error.error.message;
          } else if (error.message) {
            errorMessage = error.message;
          }
          this.toastrService.danger(errorMessage, 'Error');
          reject(error);
        }
      });
    });
  }

  private updateServer(serverId: string, serverData: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.serverService.updateServer(serverId, serverData).subscribe({
        next: (response) => {
          this.toastrService.success('Server updated successfully', 'Success');
          resolve();
        },
        error: (error) => {
          console.error('Update server error:', error);
          let errorMessage = 'Failed to update server';
          if (error.error && error.error.message) {
            errorMessage = error.error.message;
          } else if (error.message) {
            errorMessage = error.message;
          }
          this.toastrService.danger(errorMessage, 'Error');
          reject(error);
        }
      });
    });
  }

  deleteServer() {
    if (!this.selectedServer) return;

    this.dialogService.open(ConfirmDialogComponent, {
      context: {
        title: 'Delete Server',
        message: `Are you sure you want to delete server "${this.selectedServer.alias || this.selectedServer.hostname}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        status: 'danger'
      }
    }).onClose.subscribe((confirmed) => {
      if (confirmed && this.selectedServer) {
        this.performDelete(this.selectedServer.id);
      }
    });
  }

  private performDelete(serverId: string) {
    this.serverService.deleteServer(serverId).subscribe({
      next: () => {
        this.toastrService.success('Server deleted successfully', 'Success');
        this.selectedServer = null;
        this.cancelEdit();
        this.loadServers();
      },
      error: (error) => {
        this.toastrService.danger('Failed to delete server', 'Error');
        console.error('Delete error:', error);
      }
    });
  }

  testConnection() {
    if (!this.selectedServer) return;

    this.testing = true;
    this.serverService.testConnection(this.selectedServer.id).subscribe({
      next: (response) => {
        this.testing = false;
        if (response.status === 'success') {
          this.toastrService.success('Connection test successful', 'Success');
        } else {
          this.toastrService.warning(`Connection test failed: ${response.error}`, 'Warning');
        }
      },
      error: (error) => {
        this.testing = false;
        this.toastrService.danger('Connection test failed', 'Error');
        console.error('Connection test error:', error);
      }
    });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleSshKeyVisibility() {
    this.showSshKey = !this.showSshKey;
  }

  private saveDraft() {
    // Implement draft saving logic if needed
    console.log('Saving draft...');
  }

  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }

  // Utility methods for form validation
  isFieldInvalid(fieldName: string): boolean {
    const field = this.serverForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  // Add method to check form validity for debugging
  checkFormValidity(): void {
    console.log('Form valid:', this.serverForm.valid);
    console.log('Form errors:', this.getFormErrors());
    console.log('Form value:', this.serverForm.value);
  }

  private getFormErrors(): any {
    const errors: any = {};
    Object.keys(this.serverForm.controls).forEach(key => {
      const control = this.serverForm.get(key);
      if (control && control.errors) {
        errors[key] = control.errors;
      }
    });
    return errors;
  }

  getFieldError(fieldName: string): string {
    const field = this.serverForm.get(fieldName);
    if (field?.errors) {
      if (field.errors['required']) return `${fieldName.replace('_', ' ')} is required`;
      if (field.errors['pattern']) return `Invalid ${fieldName.replace('_', ' ')} format`;
      if (field.errors['min']) return `${fieldName.replace('_', ' ')} must be at least ${field.errors['min'].min}`;
      if (field.errors['max']) return `${fieldName.replace('_', ' ')} must be at most ${field.errors['max'].max}`;
    }
    return '';
  }

  // Track by function for ngFor
  trackByServerId(index: number, server: Server): string {
    return server.id;
  }
}