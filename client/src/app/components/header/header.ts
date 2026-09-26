import { Component, OnDestroy, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { PollService } from '../../services/poll';
import { AuthService } from '../../auth/auth.service';
import { UserService } from '../../services/user';

// Same 7 colors sampled from the bódorgó logo as shared/logo-colors.ts's
// shuffledLogoColors, but picked deterministically per person here rather
// than shuffled per page load - a name always maps to the same color, so
// someone's avatar doesn't change color every time they reload.
const AVATAR_COLOR_VARS = [
  '--logo-dark-green',
  '--logo-green',
  '--logo-orange',
  '--logo-brown',
  '--logo-red',
  '--logo-blue',
  '--logo-yellow',
];

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header implements OnDestroy {
  auth = inject(AuthService);

  isMobileMenuOpen = false;

  private userService = inject(UserService);

  // Szavazások badge: open polls on my tours still waiting for my vote.
  // Refreshed on every page change and every 2 minutes (and by PollService
  // itself after a vote or a new poll).
  private pollService = inject(PollService);
  pendingPolls = this.pollService.pendingCount;
  private refreshPolls = () => {
    if (this.auth.isLoggedIn()) this.pollService.refreshPending();
  };
  private pollTimer = setInterval(this.refreshPolls, 2 * 60 * 1000);
  private navSub = inject(Router)
    .events.pipe(filter((e) => e instanceof NavigationEnd))
    .subscribe(this.refreshPolls);
  private loginWatch = effect(() => {
    if (this.auth.isLoggedIn()) this.pollService.refreshPending();
    else this.pollService.pendingCount.set(0);
  });

  ngOnDestroy() {
    clearInterval(this.pollTimer);
    this.navSub.unsubscribe();
  }

  // Média is members only - guests don't get the menu item at all.
  isMember = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'member';
  });

  // The logged-in user's own photo in place of the colored initials, once
  // they have one. No hover preview here - it's their own face, and the
  // avatar is a link to their profile anyway.
  photoUrl = computed(() => {
    const u = this.auth.user();
    return u?.id && u.photoUpdatedAt ? this.userService.photoUrl(u.id, u.photoUpdatedAt) : null;
  });

  login() {
    this.auth.login();
  }

  logout() {
    this.auth.logout();
  }

  closeMobileMenu() {
    this.isMobileMenuOpen = false;
  }

  // "Nagy Zoltán" -> "NZ" (first letter of the first and last name parts) -
  // a lone single-word name just gives its own first letter, matching the
  // common initials-avatar convention used everywhere else these days.
  initials(name: string | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // A simple sum-of-character-codes hash into the fixed 7-color palette -
  // not cryptographic, just enough to spread names out and keep each
  // person's own avatar color stable across sessions.
  avatarColor(name: string | undefined): string {
    const value = name ?? '';
    const hash = [...value].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const index = value ? hash % AVATAR_COLOR_VARS.length : 0;
    return `var(${AVATAR_COLOR_VARS[index]})`;
  }
}
