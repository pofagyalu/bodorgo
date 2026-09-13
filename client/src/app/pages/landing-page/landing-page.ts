import { Component } from '@angular/core';
import { HeroComponent } from '../../hero/hero.component';

// Shown at '/' to logged-out visitors (see pages/home/home.ts, which picks
// between this and pages/homepage/homepage.ts based on auth state). This
// used to be the entire homepage (home/home.component.ts, now retired) -
// the weather forecast widget that lived alongside it was dropped, not
// carried over, per the plan to reintroduce weather differently later.
@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [HeroComponent],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
})
export class LandingPage {}
