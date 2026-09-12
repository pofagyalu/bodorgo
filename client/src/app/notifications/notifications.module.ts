// Angular 20 defaults components to standalone: true, so
// NotificationListComponent can no longer be declared in an NgModule - it's
// imported directly wherever it's used (see home.component.ts). This module
// is kept only for reference, not wired up anywhere.

// import { NgModule } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { NotificationListComponent } from './notification-list/notification-list.component';

// @NgModule({
//   declarations: [NotificationListComponent],
//   imports: [CommonModule],
//   exports: [NotificationListComponent],
// })
// export class NotificationsModule {}
