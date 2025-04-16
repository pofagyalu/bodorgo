import { Component } from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { AuthService, SigninCredentials } from '../auth.service';
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  loginForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [
      Validators.required,
      Validators.minLength(6),
      Validators.maxLength(20),
    ]),
  });

  constructor(private authService: AuthService) {}

  onSubmit() {
    if (this.loginForm.invalid) {
      return;
    }

    this.authService
      .login(this.loginForm.value as SigninCredentials)
      .subscribe({
        next: (response) => {
          // navigate to another route
        },
        error: (err) => {
          if (!err.status) {
            this.loginForm.setErrors({ noConnection: true });
          } else {
            this.loginForm.setErrors({ credentials: true });
          }
          if (err.status === 'fail') {
            // this.notificationService.addError('Nem sikerült a regisztráció');
          }
        },
      });
  }
}
