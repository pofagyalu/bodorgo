import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MemberUser, MembershipService } from '../../services/membership';

export interface MediaEdit {
  title: string;
  // The only members who see it - empty: every member does.
  viewers: string[];
}

// The role manager's edit dialog of a Média video or photo - its own title (a
// photo's name), and who may see it: every member, or only the chosen ones (admins
// always do). The page saves what `saved` gives it, and says how that goes
// through `saving` and `error`.
@Component({
  selector: 'app-media-edit-dialog',
  templateUrl: './media-edit-dialog.html',
  styleUrl: './media-edit-dialog.scss',
})
export class MediaEditDialog implements OnInit {
  heading = input.required<string>();
  title = input.required<string>();
  // What the field is called ("Cím", a photo's "Név").
  titleLabel = input('Cím');
  // What the title goes back to when emptied, and where that comes from
  // ("A fájl neve szerint") - a video's; a photo has no name but the one
  // given here, so neither.
  discoveredTitle = input('');
  discoveredLabel = input('');
  viewers = input<string[]>([]);
  saving = input(false);
  error = input<string | null>(null);

  saved = output<MediaEdit>();
  cancelled = output<void>();

  private membership = inject(MembershipService);
  private titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  editTitle = signal('');
  restricted = signal(false);
  chosen = signal<ReadonlySet<string>>(new Set());
  // Asked to save "only the chosen" with nobody chosen.
  nobodyChosen = signal(false);

  private users = signal<MemberUser[]>([]);
  membersLoading = signal(true);
  membersError = signal(false);
  // The club's members - Média is theirs alone, and an admin sees
  // everything anyway. Someone already chosen stays listed whatever they
  // are now, so they can be seen and taken off.
  members = computed(() => {
    const before = new Set(this.viewers());
    return this.users().filter((u) => before.has(u._id) || (u.role === 'member' && !u.retired));
  });

  ngOnInit() {
    this.editTitle.set(this.title());
    this.chosen.set(new Set(this.viewers()));
    this.restricted.set(this.viewers().length > 0);
    // The cursor in the field, the title selected.
    setTimeout(() => this.titleInput()?.nativeElement.select());
    this.membership.getMembers().subscribe({
      next: (res) => {
        this.users.set(res.data.users);
        this.membersLoading.set(false);
      },
      error: () => {
        this.membersError.set(true);
        this.membersLoading.set(false);
      },
    });
  }

  toggle(id: string) {
    this.nobodyChosen.set(false);
    this.chosen.update((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  @HostListener('document:keydown.escape')
  cancel() {
    if (!this.saving()) this.cancelled.emit();
  }

  // An emptied title goes back to the discovered one.
  save(event: Event) {
    event.preventDefault();
    if (this.saving()) return;
    if (this.restricted() && !this.chosen().size) {
      this.nobodyChosen.set(true);
      return;
    }
    this.saved.emit({
      title: this.editTitle().trim(),
      viewers: this.restricted() ? [...this.chosen()] : [],
    });
  }
}
