import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

// import { AuthRoutingModule } from './auth-routing.module';
import { SignupComponent } from './signup/signup.component';
import { LoginComponent } from './login/login.component';
import { SharedModule } from '../shared/shared.module';
import { NotificationsModule } from '../notifications/notifications.module';

@NgModule({
  declarations: [SignupComponent, LoginComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedModule,
    NotificationsModule,
  ],
  // exports: [SignupComponent, LoginComponent],
})
export class AuthModule {}
