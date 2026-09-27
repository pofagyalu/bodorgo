import { Component } from '@angular/core';
import { SiteFooter } from '../../shared/site-footer/site-footer';

// The privacy notice (adatkezelési tájékoztató) - public, no login needed.
// A playful intro, then the serious part: what GDPR Article 13 asks a
// data controller to tell people, in plain words.
@Component({
  selector: 'app-adatkezeles',
  imports: [SiteFooter],
  templateUrl: './adatkezeles.html',
  styleUrl: './adatkezeles.scss',
})
export class Adatkezeles {}
