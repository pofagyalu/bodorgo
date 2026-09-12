import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  ChildrenOutletContexts,
} from '@angular/router';
import { Header } from './components/header/header';
import { slideInAnimation } from './animations';
import { AuthService } from './auth/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, Header, RouterOutlet, RouterLink, RouterLinkActive],
  animations: [slideInAnimation],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  constructor(
    private contexts: ChildrenOutletContexts,
    private authService: AuthService,
  ) {}

  ngOnInit() {
    this.authService.checkAuth().subscribe();
  }

  getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.data?.[
      'animation'
    ];
  }
}
