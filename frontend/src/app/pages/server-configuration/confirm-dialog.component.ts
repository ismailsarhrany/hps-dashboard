// confirm-dialog.component.ts
import { Component, Input } from '@angular/core';
import { NbDialogRef } from '@nebular/theme';

@Component({
  selector: 'ngx-confirm-dialog',
  template: `
    <nb-card>
      <nb-card-header>{{ title }}</nb-card-header>
      <nb-card-body>
        <p>{{ message }}</p>
      </nb-card-body>
      <nb-card-footer>
        <div class="dialog-actions">
          <button nbButton ghost (click)="cancel()">{{ cancelText || 'Cancel' }}</button>
          <button nbButton [status]="status || 'primary'" (click)="confirm()">
            {{ confirmText || 'Confirm' }}
          </button>
        </div>
      </nb-card-footer>
    </nb-card>
  `,
  styles: [`
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
  `]
})
export class ConfirmDialogComponent {
  @Input() title: string = 'Confirm';
  @Input() message: string = 'Are you sure?';
  @Input() confirmText: string = 'Confirm';
  @Input() cancelText: string = 'Cancel';
  @Input() status: string = 'primary';

  constructor(protected ref: NbDialogRef<ConfirmDialogComponent>) { }

  cancel() {
    this.ref.close(false);
  }

  confirm() {
    this.ref.close(true);
  }
}