import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  ChildrenOutletContexts,
} from '@angular/router';
import { HeaderComponent } from './header/header.component';
import { slideInAnimation } from './animations';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
  ],
  animations: [slideInAnimation],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  constructor(private contexts: ChildrenOutletContexts) {}

  getRouteAnimationData() {
    return this.contexts.getContext('primary')?.route?.snapshot?.data?.[
      'animation'
    ];
  }
}
