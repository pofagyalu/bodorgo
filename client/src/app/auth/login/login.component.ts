import { Component } from '@angular/core';
import { AuthService } from '../auth.service';

// Angular 20 defaults components to standalone: true; this can no longer
// be declared in AuthModule (see auth.module.ts).
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  constructor(private authService: AuthService) {}

  continueWithAuthentik() {
    this.authService.login();
  }
}
