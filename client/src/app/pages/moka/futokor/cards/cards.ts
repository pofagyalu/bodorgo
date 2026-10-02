import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { errorMessage } from '../../../../shared/errors';
import { FutokorService, FutokorTag } from '../../../../services/futokor';

// Móka → Futókörök → Kártyák (admins): the club's own cards, the ones the
// tours' courses use. Made once, printed (the PDF sheet), cut and
// laminated, then used on every tour - which checkpoint a card is depends
// on the tour's course (Pályaszerkesztő). A user's own track has its own
// cards, with the track.
@Component({
  selector: 'app-futokor-cards',
  imports: [RouterLink, MatIconModule],
  templateUrl: './cards.html',
  styleUrl: '../admin.scss',
})
export class FutokorCards {
  private futokor = inject(FutokorService);
  private notifications = inject(NotificationsService);

  readonly sheetUrl = this.futokor.tagSheetUrl;
  tags = signal<FutokorTag[]>([]);
  count = signal(5);
  hasStart = computed(() => this.tags().some((t) => t.kind === 'startFinish' && !t.retired));

  constructor() {
    this.load();
  }

  private load() {
    this.futokor.getTags().subscribe({
      next: (tags) => this.tags.set(tags),
      error: (err) => this.fail(err, 'Nem sikerült betölteni a kártyákat.'),
    });
  }

  private fail(err: unknown, fallback: string) {
    this.notifications.addError(errorMessage(err, fallback));
  }

  add(startFinish: boolean) {
    const body = startFinish ? ({ kind: 'startFinish' } as const) : { count: this.count() };
    this.futokor.createTags(body).subscribe({
      next: () => this.load(),
      error: (err) => this.fail(err, 'Nem sikerült kártyát készíteni.'),
    });
  }

  retire(tag: FutokorTag) {
    this.futokor.retireTag(tag.tagId, !tag.retired).subscribe({
      next: () => this.load(),
      error: (err) => this.fail(err, 'Nem sikerült.'),
    });
  }

  // The card's link, e.g. to write onto an NFC sticker.
  async copy(tag: FutokorTag) {
    try {
      await navigator.clipboard.writeText(tag.url);
      this.notifications.addSuccess(`A(z) ${tag.tagId} kártya linkje a vágólapon van.`);
    } catch {
      this.notifications.addError('Nem sikerült a vágólapra másolni.');
    }
  }
}
