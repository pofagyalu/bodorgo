import { Component } from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { MatchPassword } from '../validators/match-password';
import { AuthService, SignupCredentials } from '../auth.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  styleUrl: './signup.component.css',
})
export class SignupComponent {
  signupForm = new FormGroup(
    {
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [
        Validators.required,
        Validators.minLength(6),
        Validators.maxLength(20),
      ]),
      passwordConfirm: new FormControl('', [
        Validators.required,
        Validators.minLength(6),
        Validators.maxLength(20),
      ]),
    },
    { validators: [this.matchPassword.validate] }
  );

  constructor(
    private matchPassword: MatchPassword,
    private authService: AuthService,
    private notificationService: NotificationsService
  ) {}

  onSubmit() {
    if (this.signupForm.invalid) {
      return;
    }

    this.authService
      .signup(this.signupForm.value as SignupCredentials)
      .subscribe({
        next: (response) => {
          // navigate to another route
        },
        error: (error) => {
          if (!error.status) {
            this.signupForm.setErrors({ noConnection: true });
          }
          if (error.status === 'fail') {
            this.notificationService.addError('Nem sikerült a regisztráció');
          }
        },
      });
  }
}
