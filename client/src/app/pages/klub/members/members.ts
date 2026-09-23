import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../auth/auth.service';
import { MembershipService, MemberUser } from '../../../services/membership';

// The club has tracked membership dues since this year - the year strip
// and the per-member table both span from here to the current year,
// rather than an arbitrary fixed window.
const CLUB_FOUNDING_YEAR = 2019;

@Component({
  selector: 'app-members',
  imports: [DatePipe],
  templateUrl: './members.html',
  styleUrl: './members.scss',
})
export class Members implements OnInit {
  private membershipService = inject(MembershipService);
  private auth = inject(AuthService);

  isAdmin = computed(() => this.auth.user()?.role === 'admin');
  myId = computed(() => this.auth.user()?.id ?? null);

  users = signal<MemberUser[]>([]);
  loading = signal(true);

  activeTab = signal<'club' | 'casual'>('club');
  clubSearch = signal('');
  casualSearch = signal('');
  selectedMemberId = signal<string | null>(null);

  // Descending, e.g. [2026, 2025, ..., 2019] - matches the demo's own
  // newest-first column order.
  membershipYears = computed(() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= CLUB_FOUNDING_YEAR; y--) years.push(y);
    return years;
  });

  clubMembers = computed(() =>
    this.users().filter((u) => u.role === 'admin' || u.role === 'member'),
  );
  casualUsers = computed(() => this.users().filter((u) => u.role === 'guest'));

  filteredClubMembers = computed(() => {
    const q = this.clubSearch().trim().toLocaleLowerCase('hu');
    return this.clubMembers().filter((u) => u.name.toLocaleLowerCase('hu').includes(q));
  });

  filteredCasualUsers = computed(() => {
    const q = this.casualSearch().trim().toLocaleLowerCase('hu');
    return this.casualUsers().filter((u) => u.name.toLocaleLowerCase('hu').includes(q));
  });

  me = computed(() => this.clubMembers().find((u) => u._id === this.myId()) ?? null);

  // Every viewer (admin or plain member) starts out seeing their own dues
  // at the bottom, same as the demo; only admin can then switch it via
  // "Részletek →" (see selectMember below) - a plain member can never see
  // anyone else's payment breakdown, only the paid/unpaid status column.
  selectedMember = computed(() => {
    const id = this.isAdmin() ? this.selectedMemberId() : this.myId();
    return this.clubMembers().find((u) => u._id === id) ?? null;
  });

  ngOnInit() {
    this.membershipService.getMembers().subscribe({
      next: (res) => {
        this.users.set(res.data.users);
        this.selectedMemberId.set(this.myId());
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load members', err);
        this.loading.set(false);
      },
    });
  }

  selectTab(tab: 'club' | 'casual') {
    this.activeTab.set(tab);
  }

  selectMember(id: string) {
    if (!this.isAdmin()) return;
    this.selectedMemberId.set(id);
  }

  // 'na': before this person's own memberSince (or, if that's not set yet,
  // treated as eligible for every tracked year). 'unpaid': no real
  // per-year payment records exist yet (that data model/import is
  // deliberately a later step), so every eligible year currently shows as
  // unpaid rather than paid - wiring in real data later only touches this
  // one spot.
  yearState(userId: string, year: number): 'paid' | 'unpaid' | 'na' {
    const user = this.clubMembers().find((u) => u._id === userId);
    if (user?.memberSince && year < user.memberSince) return 'na';
    return 'unpaid';
  }

  isActive(u: MemberUser): boolean {
    return !!u.lastLoginAt;
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  myStatusSummary(): string {
    const mine = this.me();
    if (!mine) return 'Tagsági állapot';
    const unpaidCount = this.membershipYears().filter(
      (y) => this.yearState(mine._id, y) === 'unpaid',
    ).length;
    return unpaidCount ? `${unpaidCount} év befizetése hiányzik` : 'Minden tagdíjad rendezve';
  }
}
