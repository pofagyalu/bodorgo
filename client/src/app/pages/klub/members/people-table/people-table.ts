import { Component, TemplateRef, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MemberUser } from '../../../../services/membership';
import { Avatar } from '../../../../components/avatar/avatar';
import { TourMedal } from '../../../../shared/tour-medal/tour-medal';

// The one activity status shown per user - derived, never stored, from the
// only two real facts: whether an admin archived them (retired, always
// wins - a later login doesn't undo it) and whether they've ever logged
// in. Someone with no email has no account of their own at all (can't be
// invited through Authentik), so "never logged in" isn't something they
// could ever change.
export type UserStatus = 'active' | 'inactive' | 'noAccount' | 'retired';

export function userStatus(u: MemberUser): UserStatus {
  if (u.retired) return 'retired';
  if (u.lastLoginAt) return 'active';
  return u.email ? 'inactive' : 'noAccount';
}

// Also the ascending sort order of the Státusz column.
const STATUS_ORDER: UserStatus[] = ['active', 'inactive', 'noAccount', 'retired'];

export type SortKey = 'name' | 'toursAttended' | 'age' | 'status';
export type SortState = { key: SortKey; dir: 'asc' | 'desc' };

// Ties on the numbers fall back to the name, and a missing age (no
// birthday recorded) always sorts to the bottom, whichever direction.
export function sortUsers(users: MemberUser[], { key, dir }: SortState): MemberUser[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: MemberUser, b: MemberUser) => a.name.localeCompare(b.name, 'hu');
  return [...users].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b);
    if (key === 'status') {
      const diff = STATUS_ORDER.indexOf(userStatus(a)) - STATUS_ORDER.indexOf(userStatus(b));
      return sign * diff || byName(a, b);
    }
    if (key === 'age') {
      if (a.age == null || b.age == null) {
        return a.age == null && b.age == null ? byName(a, b) : a.age == null ? 1 : -1;
      }
      return sign * (a.age - b.age) || byName(a, b);
    }
    return sign * (a.toursAttended - b.toursAttended) || byName(a, b);
  });
}

// A column a page adds after the standard ones (e.g. Klubtagok's yearly
// payment and Előzmény) - its cell is the page's own template, given the
// person as `let-p`.
export interface ExtraColumn {
  header: string;
  width?: string;
  cell: TemplateRef<{ $implicit: MemberUser }>;
}

// The Felhasználók page's tables (Klubtagok, A többiek, Mindenki) - one
// component: Név (avatar, name, email, the admin star), Táborok and Kor,
// Státusz (admins only - the page decides), a page's own extra columns and
// an optional detail row under each person, and the admin actions. Every
// header except the extras sorts the table; each table keeps its own order.
@Component({
  selector: 'app-people-table',
  imports: [NgTemplateOutlet, RouterLink, MatIconModule, Avatar, TourMedal],
  templateUrl: './people-table.html',
  styleUrl: './people-table.scss',
})
export class PeopleTable {
  people = input.required<MemberUser[]>();
  // Which Felhasználók list this is (?lista=) - the edit page returns there.
  list = input<string | null>(null);
  showStatus = input(false);
  showActions = input(false);
  extraColumns = input<ExtraColumn[]>([]);
  // Under each person's row, e.g. Klubtagok's payment history (the page's
  // template decides whether it's open).
  detailRow = input<TemplateRef<{ $implicit: MemberUser }> | null>(null);
  // A page's own buttons at the start of Műveletek (e.g. Klubtagok's
  // cash dues), given the person as `let-p`.
  rowActions = input<TemplateRef<{ $implicit: MemberUser }> | null>(null);
  // Which rows open on a click: all (true), none, or those the function
  // allows (e.g. a member only their own).
  rowClickable = input<boolean | ((p: MemberUser) => boolean)>(false);
  highlightId = input<string | null>(null); // "me" - a tinted row
  busyId = input<string | null>(null); // a suspend/restore in progress
  emptyText = input('Nincs ilyen nevű felhasználó.');
  // Wide tables (with extra columns) scroll sideways on a phone rather
  // than squeezing.
  wide = input(false);
  // Every column the same width (e.g. Mindenki's three) instead of Név as
  // narrow as its content and the numbers at a fixed width.
  equalColumns = input(false);

  rowClick = output<MemberUser>();
  archive = output<MemberUser>();
  restore = output<MemberUser>();

  private sort = signal<SortState>({ key: 'name', dir: 'asc' });

  sortColumns = computed(() => {
    const cols: { key: SortKey; label: string }[] = [
      { key: 'name', label: 'Név' },
      { key: 'toursAttended', label: 'Táborok' },
      { key: 'age', label: 'Kor' },
    ];
    if (this.showStatus()) cols.push({ key: 'status', label: 'Státusz' });
    return cols;
  });

  columnCount = computed(
    () => this.sortColumns().length + this.extraColumns().length + (this.showActions() ? 1 : 0),
  );

  sorted = computed(() => sortUsers(this.people(), this.sort()));

  // Same column again flips the direction; a new column starts A→Z for the
  // name and Aktív-first for Státusz, but most-first for Táborok/Kor - the
  // more useful end of a number column.
  sortBy(key: SortKey) {
    this.sort.update((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'status' ? 'asc' : 'desc' },
    );
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sort();
    if (s.key !== key) return 'none';
    return s.dir === 'asc' ? 'ascending' : 'descending';
  }

  arrow(key: SortKey): string {
    const s = this.sort();
    return s.key === key && s.dir === 'desc' ? '▼' : '▲';
  }

  isSortedBy(key: SortKey): boolean {
    return this.sort().key === key;
  }

  status(p: MemberUser): UserStatus {
    return userStatus(p);
  }

  statusLabel(p: MemberUser): string {
    switch (userStatus(p)) {
      case 'active':
        return '✓ Aktív';
      case 'inactive':
        return '○ Inaktív';
      case 'noAccount':
        return '— Nincs fiókja';
      case 'retired':
        return 'Felfüggesztett';
    }
  }

  canClick(p: MemberUser): boolean {
    const c = this.rowClickable();
    return typeof c === 'function' ? c(p) : c;
  }

  onRowClick(p: MemberUser) {
    if (this.canClick(p)) this.rowClick.emit(p);
  }
}
