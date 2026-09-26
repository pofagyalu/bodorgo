import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PollService, Poll, PollPayload, PollVisibility } from '../../services/poll';
import { TourService, Tour } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PollCard } from '../../components/poll-card/poll-card';

interface PollFormModel {
  tour: string;
  question: string;
  options: string[];
  closesAtLocal: string;
  visibility: PollVisibility;
  // On the first answer; empty = none.
  minimumCount: number | null;
}

function emptyForm(): PollFormModel {
  return {
    tour: '',
    question: '',
    options: ['', ''],
    closesAtLocal: '',
    visibility: 'secret',
    minimumCount: null,
  };
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not
// the UTC ISO string the API returns/expects - same helper as tour-edit.ts.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Every poll, open ones first: the ones started in a tour's chat (with a
// link back to it) and the ones an admin creates here. Each is the same
// card as in the chat (components/poll-card) - voting, results, Nyílt /
// Titkos, minimum, close/delete for whoever started it. Admins can also
// create and edit polls here.
@Component({
  selector: 'app-szavazasok',
  imports: [FormsModule, MatIconModule, PollCard],
  templateUrl: './szavazasok.html',
  styleUrl: './szavazasok.scss',
})
export class Szavazasok implements OnInit {
  private pollService = inject(PollService);
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  auth = inject(AuthService);

  loading = signal(true);
  polls = signal<Poll[]>([]);
  tours = signal<Tour[]>([]);

  sections = computed(() => [
    { title: 'Nyitott', polls: this.polls().filter((p) => !p.isClosed) },
    { title: 'Lezárt', polls: this.polls().filter((p) => p.isClosed) },
  ]);

  showForm = signal(false);
  editingId = signal<string | null>(null);
  form: PollFormModel = emptyForm();
  saving = signal(false);
  formError = signal<string | null>(null);

  ngOnInit() {
    this.loadPolls();
    this.pollService.refreshPending();
  }

  private loadPolls() {
    this.loading.set(true);
    this.pollService.getPolls().subscribe({
      next: (res) => {
        this.polls.set(res.data.polls);
        this.loading.set(false);
      },
      error: () => {
        this.notifications.addError('A szavazások betöltése nem sikerült.');
        this.loading.set(false);
      },
    });
  }

  // Only fetched once, and only once an admin actually opens the form -
  // nobody else on this page ever needs the full tour list.
  private loadTours() {
    if (this.tours().length) return;
    this.tourService.getTours().subscribe({
      next: (res) => this.tours.set(res.data.tours),
      error: () => this.notifications.addError('A táborok betöltése nem sikerült.'),
    });
  }

  isAdmin(): boolean {
    return this.auth.user()?.role === 'admin';
  }

  onRemoved(id: string) {
    this.polls.update((list) => list.filter((p) => p._id !== id));
  }

  openCreate() {
    this.editingId.set(null);
    this.form = emptyForm();
    this.formError.set(null);
    this.loadTours();
    this.showForm.set(true);
  }

  openEdit(poll: Poll) {
    this.editingId.set(poll._id);
    this.form = {
      tour: poll.tour._id,
      question: poll.question,
      options: poll.options.map((o) => o.text),
      closesAtLocal: toDatetimeLocal(poll.closesAt),
      visibility: poll.visibility,
      minimumCount: poll.minimum?.count ?? null,
    };
    this.formError.set(null);
    this.loadTours();
    this.showForm.set(true);
  }

  closeForm() {
    if (this.saving()) return;
    this.showForm.set(false);
  }

  addOptionField() {
    this.form.options.push('');
  }

  removeOptionField(index: number) {
    if (this.form.options.length <= 2) return;
    this.form.options.splice(index, 1);
  }

  onSubmit(event: Event) {
    // Plain native (submit), not (ngSubmit) - see finance.ts's identical
    // fix: (ngSubmit) is an NgForm/FormsModule output, easy to end up
    // silently never firing.
    event.preventDefault();
    this.saveForm();
  }

  private saveForm() {
    const cleanedOptions = this.form.options.map((o) => o.trim()).filter(Boolean);

    if (!this.form.tour) {
      this.formError.set('Válassz tábort.');
      return;
    }
    if (!this.form.question.trim()) {
      this.formError.set('Adj meg egy kérdést.');
      return;
    }
    if (cleanedOptions.length < 2) {
      this.formError.set('Legalább 2 válaszlehetőség szükséges.');
      return;
    }
    if (!this.form.closesAtLocal) {
      this.formError.set('Adj meg egy záró időpontot.');
      return;
    }

    const payload: PollPayload = {
      tour: this.form.tour,
      question: this.form.question.trim(),
      options: cleanedOptions,
      closesAt: new Date(this.form.closesAtLocal).toISOString(),
      visibility: this.form.visibility,
      minimumCount: this.form.minimumCount ? Number(this.form.minimumCount) : null,
    };

    this.saving.set(true);
    this.formError.set(null);
    const editId = this.editingId();
    const request = editId
      ? this.pollService.updatePoll(editId, payload)
      : this.pollService.createPoll(payload);

    request.subscribe({
      next: (res) => {
        this.saving.set(false);
        this.showForm.set(false);
        if (editId) {
          this.polls.update((list) => list.map((p) => (p._id === editId ? res.data.poll : p)));
          this.notifications.addSuccess('Szavazás mentve');
        } else {
          this.polls.update((list) => [res.data.poll, ...list]);
          this.notifications.addSuccess('Szavazás létrehozva');
        }
      },
      error: (err) => {
        this.formError.set(err?.error?.message ?? 'Hiba történt a mentés során.');
        this.saving.set(false);
      },
    });
  }
}
