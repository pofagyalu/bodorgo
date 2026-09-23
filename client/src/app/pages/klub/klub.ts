import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

// Outer shell for every klub/* subpage - a persistent dark sidebar (desktop)
// / horizontal bar (mobile) for switching between them, with the actual
// content rendered by the matching child route below.
@Component({
  selector: 'app-klub',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule],
  templateUrl: './klub.html',
  styleUrl: './klub.scss',
})
export class Klub {}
