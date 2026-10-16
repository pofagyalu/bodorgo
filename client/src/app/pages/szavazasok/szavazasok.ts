import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { PollService, Poll } from '../../services/poll';
import { TourService, Tour } from '../../services/tour';
import { AuthService } from '../../auth/auth.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PollCard } from '../../components/poll-card/poll-card';
import { PollCreate } from '../../components/poll-create/poll-create';
import { TabOption, TabStrip } from '../../components/tab-strip/tab-strip';
import { PeriodOption, PeriodPicker } from '../../components/period-picker/period-picker';

// The tabs, each a filter on the polls (after the search and the tour).
type PollFilter = 'all' | 'waiting' | 'open' | 'closed' | 'voted';
const FILTERS: { value: PollFilter; label: string; test: (p: Poll) => boolean }[] = [
  { value: 'all', label: 'Mind', test: () => true },
  // Exactly what the Voks badge counts - see Poll.awaitsMyVote.
  { value: 'waiting', label: 'Rád vár', test: (p) => p.awaitsMyVote },
  { value: 'open', label: 'Nyitott', test: (p) => !p.isClosed },
  { value: 'closed', label: 'Lezárt', test: (p) => p.isClosed },
  { value: 'voted', label: 'Szavaztam', test: (p) => p.hasVoted },
];

// "matra" finds "Mátra": lower case, no accents.
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// What the search looks in: the question, the details (their text) and
// the tour's name.
function searchText(p: Poll): string {
  const details = p.details.replace(/<[^>]*>/g, ' ');
  const tour = p.tour ? `${p.tour.order}. ${p.tour.title}` : 'általános';
  return plain(`${p.question} ${details} ${tour}`);
}

const byClosing = (a: Poll, b: Poll) => a.closesAt.localeCompare(b.closesAt);

// Every poll, open ones first: the ones started in a tour's chat (with a
// link back to it) and the ones an admin creates here. An open one is the
// same card as in the chat (components/poll-card) - voting, results,
// Nyílt / Titkos, minimum, close/delete for whoever started it; a closed
// one is a short row (its winner, my vote) that opens into that card.
// The search, the tabs (Mind, Rád vár...) and the tour picker narrow the
// list - kept in the address (q, szuro, tabor), so Back finds them again.
// Admins can also
// create and edit polls here - in the same dialog as the chat's
// (components/poll-create), with "Hol?" (Általános or a tour).
@Component({
  selector: 'app-szavazasok',
  imports: [MatIconModule, PollCard, PollCreate, TabStrip, PeriodPicker],
  templateUrl: './szavazasok.html',
  styleUrl: './szavazasok.scss',
})
export class Szavazasok implements OnInit {
  private pollService = inject(PollService);
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  auth = inject(AuthService);

  loading = signal(true);
  polls = signal<Poll[]>([]);
  tours = signal<Tour[]>([]);

  private query = this.route.snapshot.queryParamMap;
  search = signal(this.query.get('q') ?? '');
  filter = signal<PollFilter>(
    FILTERS.find((f) => f.value === this.query.get('szuro'))?.value ?? 'all',
  );
  // 'all', 'general' (no tour) or a tour's id.
  tour = signal(this.query.get('tabor') ?? 'all');

  // The tours that have polls, newest first.
  tourOptions = computed<PeriodOption[]>(() => {
    const tours = new Map<string, { label: string; order: number }>();
    for (const p of this.polls()) {
      if (p.tour) {
        tours.set(p.tour._id, { label: `${p.tour.order}. ${p.tour.title}`, order: p.tour.order });
      }
    }
    return [
      { value: 'all', label: 'Minden tábor' },
      { value: 'general', label: 'Általános' },
      ...[...tours.entries()]
        .sort((a, b) => b[1].order - a[1].order)
        .map(([value, t]) => ({ value, label: t.label })),
    ];
  });

  // Searched for, and of the chosen tour - what the tabs count.
  private matching = computed(() => {
    const words = plain(this.search()).split(/\s+/).filter(Boolean);
    const tour = this.tour();
    return this.polls().filter((p) => {
      if (tour === 'general' && p.tour) return false;
      if (tour !== 'all' && tour !== 'general' && p.tour?._id !== tour) return false;
      const text = searchText(p);
      return words.every((w) => text.includes(w));
    });
  });

  tabOptions = computed<TabOption[]>(() =>
    FILTERS.map((f) => ({
      value: f.value,
      label: f.label,
      count: this.matching().filter(f.test).length,
    })),
  );

  private shown = computed(() => {
    const test = FILTERS.find((f) => f.value === this.filter())!.test;
    return this.matching().filter(test);
  });

  // Open ones as cards - mine to vote on first, then the soonest to
  // close; the closed ones as rows, the last closed first.
  sections = computed(() => {
    const open = this.shown()
      .filter((p) => !p.isClosed)
      .sort(byClosing);
    const closed = this.shown()
      .filter((p) => p.isClosed)
      .sort((a, b) => byClosing(b, a));
    return [
      { title: 'Rád vár', polls: open.filter((p) => p.awaitsMyVote), rows: false },
      { title: 'Nyitott', polls: open.filter((p) => !p.awaitsMyVote), rows: false },
      { title: 'Lezárt', polls: closed, rows: true },
    ];
  });

  nothingShown = computed(() => this.sections().every((s) => !s.polls.length));

  // The closed rows opened into their full card.
  expanded = signal<ReadonlySet<string>>(new Set());

  toggleRow(id: string) {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A closed row's result: the answer with the most votes, or a tie.
  winner(p: Poll): string {
    if (!p.results || !p.totalVotes) return 'Nem szavazott senki';
    const top = Math.max(...p.results.map((r) => r.count));
    const best = p.results.filter((r) => r.count === top);
    return best.length > 1 ? 'Döntetlen' : `${best[0].text} ${best[0].percentage}%`;
  }

  myAnswer(p: Poll): string | null {
    return p.options.find((o) => o._id === p.myOptionId)?.text ?? null;
  }

  // "okt. 3." - with the year when it isn't this one.
  closedOn(p: Poll): string {
    const d = new Date(p.closesAt);
    const thisYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('hu-HU', {
      year: thisYear ? undefined : 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  setSearch(value: string) {
    this.search.set(value);
    this.remember();
  }

  setFilter(value: string) {
    this.filter.set(value as PollFilter);
    this.remember();
  }

  setTour(value: string) {
    this.tour.set(value);
    this.remember();
  }

  clearFilters() {
    this.search.set('');
    this.filter.set('all');
    this.tour.set('all');
    this.remember();
  }

  // Into the address - replacing it, not a step of Back each.
  private remember() {
    const q = this.search().trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: q || null,
        szuro: this.filter() === 'all' ? null : this.filter(),
        tabor: this.tour() === 'all' ? null : this.tour(),
      },
      replaceUrl: true,
    });
  }

  // The poll dialog: open, and the poll being edited (null: a new one).
  showForm = signal(false);
  editingPoll = signal<Poll | null>(null);

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
        this.notifications.addError('A voks betöltése nem sikerült.');
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

  // A vote (or a close) moves the poll between the sections, and the
  // badge's number follows.
  onChanged(poll: Poll) {
    this.polls.update((list) => list.map((p) => (p._id === poll._id ? poll : p)));
    this.pollService.refreshPending();
  }

  onRemoved(id: string) {
    this.polls.update((list) => list.filter((p) => p._id !== id));
  }

  openCreate() {
    this.editingPoll.set(null);
    this.loadTours();
    this.showForm.set(true);
  }

  openEdit(poll: Poll) {
    this.editingPoll.set(poll);
    this.loadTours();
    this.showForm.set(true);
  }

  onSaved(poll: Poll) {
    if (this.editingPoll()) {
      this.polls.update((list) => list.map((p) => (p._id === poll._id ? poll : p)));
      this.notifications.addSuccess('Szavazás mentve');
    } else {
      this.polls.update((list) => [poll, ...list]);
      this.notifications.addSuccess('Szavazás létrehozva');
    }
  }
}
