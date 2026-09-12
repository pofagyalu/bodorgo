// Angular 20 defaults components to standalone: true, so LoginComponent and
// SignupComponent can no longer be declared in an NgModule - they're
// imported directly wherever they're used (routes, other standalone
// components). This module is kept only for reference, not wired up anywhere.

// import { NgModule } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ReactiveFormsModule } from '@angular/forms';

// import { AuthRoutingModule } from './auth-routing.module';
// import { SignupComponent } from './signup/signup.component'; // superseded by Authentik self-service registration
// import { LoginComponent } from './login/login.component';

// @NgModule({
//   declarations: [SignupComponent, LoginComponent],
//   imports: [CommonModule, ReactiveFormsModule],
//   exports: [SignupComponent, LoginComponent],
// })
// export class AuthModule {}
