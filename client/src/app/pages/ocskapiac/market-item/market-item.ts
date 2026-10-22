import { Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import {
  HOLD_DAYS,
  MAX_NOTE_LENGTH,
  MarketItem,
  MarketService,
  categoryLabel,
  personName,
  priceLabel,
} from '../../../services/market';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { Avatar } from '../../../components/avatar/avatar';
import { errorMessage } from '../../../shared/errors';
import { linkParts } from '../../../shared/link-parts';
import { daysLeft } from '../market-card/market-card';

// One Ócskapiac item opened over the page: its photos (swiped sideways),
// what it costs, who asks for it, the one-line notes - and the buttons:
// Kérem! / Stipistopi! for others; Szerkesztés / Odaadtam / Törlés for its
// owner (Törlés for an admin too). Every change comes back as `changed`.
@Component({
  selector: 'app-market-item',
  imports: [MatIconModule, DatePipe, Avatar],
  templateUrl: './market-item.html',
  styleUrl: './market-item.scss',
})
export class MarketItemDialog {
  private market = inject(MarketService);
  private auth = inject(AuthService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);

  item = input.required<MarketItem>();
  // The description in pieces, its links apart ("katt ide").
  descriptionParts = computed(() => linkParts(this.item().description ?? ''));
  changed = output<MarketItem>();
  deleted = output<string>();
  edit = output<MarketItem>();
  closed = output<void>();

  readonly maxNote = MAX_NOTE_LENGTH;
  readonly holdDays = HOLD_DAYS;
  busy = signal(false);
  note = signal('');
  photoIndex = signal(0);

  price = computed(() => priceLabel(this.item().price));
  category = computed(() => categoryLabel(this.item().category));
  owner = computed(() => personName(this.item().owner));
  holder = computed(() => personName(this.item().reservedBy));
  days = computed(() => daysLeft(this.item().reservedUntil));
  wantedNames = computed(() =>
    this.item()
      .wanted.map((w) => personName(w.user))
      .join(', '),
  );
  canDelete = computed(() => this.item().mine || this.auth.user()?.role === 'admin');
  myId = computed(() => this.auth.user()?.id ?? '');

  photoUrl = (photoId: string) => this.market.photoUrl(this.item()._id, photoId);
  name = personName;

  @HostListener('document:keydown.escape')
  close() {
    if (!this.confirm.pending()) this.closed.emit();
  }

  onPhotosScroll(el: HTMLElement) {
    this.photoIndex.set(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
  }

  showPhoto(el: HTMLElement, i: number) {
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  private run(action: Observable<MarketItem>, done?: string, after?: () => void) {
    if (this.busy()) return;
    this.busy.set(true);
    action.subscribe({
      next: (item) => {
        this.busy.set(false);
        this.changed.emit(item);
        if (done) this.notifications.addSuccess(done);
        after?.();
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(errorMessage(err, 'Ez most nem sikerült.'));
      },
    });
  }

  toggleWant() {
    const id = this.item()._id;
    if (this.item().iWant) this.run(this.market.unwant(id));
    else this.run(this.market.want(id), 'Szóltunk a gazdájának, hogy kéred! 🙋');
  }

  dibs() {
    this.run(this.market.dibs(this.item()._id), `Stipistopi! ${HOLD_DAYS} napod van elvinni. ✋`);
  }

  async undibs() {
    const ok = await this.confirm.ask({
      message: 'Mégse kell?',
      detail: 'Elengeded a stipistopit – bárki lefoglalhatja.',
      confirmText: 'Mégse kell',
      cancelText: 'De kell!',
    });
    if (ok) this.run(this.market.undibs(this.item()._id));
  }

  async markGone() {
    const ok = await this.confirm.ask({
      title: 'Odaadtad?',
      message: `„${this.item().title}” elkelt?`,
      detail:
        'Kint marad „Elvitték!” pecséttel, de kérni már nem lehet. Ezt nem lehet visszacsinálni.',
      confirmText: 'Odaadtam 🤝',
      danger: false,
    });
    if (ok)
      this.run(this.market.markGone(this.item()._id), 'Gratulálunk, eggyel kevesebb kacat! 🎉');
  }

  async remove() {
    const ok = await this.confirm.ask({
      message: `Törlöd: „${this.item().title}”?`,
      // An admin's deletes it for real; its owner's only takes it off the
      // page (the server keeps it).
      detail:
        this.auth.user()?.role === 'admin'
          ? 'Végleg törlődik, a fotóival és a megjegyzésekkel együtt.'
          : 'Eltűnik az Ócskapiacról.',
    });
    if (!ok) return;
    this.busy.set(true);
    this.market.delete(this.item()._id).subscribe({
      next: () => {
        this.busy.set(false);
        this.deleted.emit(this.item()._id);
      },
      error: (err) => {
        this.busy.set(false);
        this.notifications.addError(errorMessage(err, 'Nem sikerült törölni.'));
      },
    });
  }

  sendNote(event: Event) {
    event.preventDefault();
    const text = this.note().trim();
    if (!text) return;
    this.run(this.market.addNote(this.item()._id, text), undefined, () => this.note.set(''));
  }

  deleteNote(noteId: string) {
    this.run(this.market.deleteNote(this.item()._id, noteId));
  }
}
