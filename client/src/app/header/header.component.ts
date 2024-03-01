import { Component } from '@angular/core';
import { HeroComponent } from '../hero/hero.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [HeroComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.css',
})
export class HeaderComponent {
  toggle = false;

  navToggle() {
    this.toggle = !this.toggle;
  }
}
