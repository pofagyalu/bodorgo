import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';

import {
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  ChildrenOutletContexts,
} from '@angular/router';
import { HeaderComponent } from './header/header.component';
import { slideAnimation } from './animations';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    HttpClientModule,
    AuthModule,
  ],
  animations: [slideAnimation],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  signedin = false;

  constructor(
    private contexts: ChildrenOutletContexts,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.authService.checkAuth().subscribe(() => {});
  }

  getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.data?.[
      'animation'
    ];
  }
}
