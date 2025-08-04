import { Component } from '@angular/core';

@Component({
  selector: 'ngx-one-column-layout',
  template: `
<nb-layout windowMode>
  <nb-layout-header fixed>
    <ngx-header></ngx-header>
  </nb-layout-header>

  <nb-layout-column>
    <ng-content></ng-content>
  </nb-layout-column>

  <nb-layout-footer fixed>
    <ngx-footer></ngx-footer>
  </nb-layout-footer>
</nb-layout>
  `,
  styleUrls: ['./one-column.layout.scss']
})
export class OneColumnLayoutComponent { }
