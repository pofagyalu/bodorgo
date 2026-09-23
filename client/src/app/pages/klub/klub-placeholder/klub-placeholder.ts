import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

// Shared stand-in for the klub/* subpages not built yet (Áttekintés,
// Felhasználók, Profilom) - which one it is comes from the route's own
// `data.title`, so this one component covers all three instead of three
// near-identical files.
@Component({
  selector: 'app-klub-placeholder',
  imports: [],
  templateUrl: './klub-placeholder.html',
  styleUrl: './klub-placeholder.scss',
})
export class KlubPlaceholder {
  private route = inject(ActivatedRoute);
  title: string = this.route.snapshot.data['title'] ?? 'Hamarosan';
}
