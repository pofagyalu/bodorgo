import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FutokorService } from '../../../../services/futokor';
import { ScanFlow } from '../scan-flow/scan-flow';

// fk/<token>: where a card's QR code (or NFC sticker) leads -
// opened by the phone's own camera. It counts the scan (scan-flow) and then
// goes on to Futókörök's Futás page. A phone that has never had the course gets
// it first, if it has a connection.
@Component({
  selector: 'app-futokor-tag',
  imports: [ScanFlow],
  template: `
    @if (ready()) {
      <app-scan-flow [token]="token" (done)="leave()" />
    }
  `,
})
export class FutokorTagPage {
  private futokor = inject(FutokorService);
  private router = inject(Router);
  readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  // (A card of a course this phone doesn't have yet: the courses first.)
  ready = signal(!!this.futokor.courseOfCard(this.token));

  constructor() {
    if (!this.ready()) void this.futokor.refresh().then(() => this.ready.set(true));
  }

  // The card's own address is left behind: "back" must not scan it again.
  leave() {
    void this.router.navigate(['/moka/futokor/futas'], { replaceUrl: true });
  }
}
