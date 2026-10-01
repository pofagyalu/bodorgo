import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  afterEveryRender,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MusicPlayer } from '../../shared/music-player/music-player';
import { filter } from 'rxjs';
import { PollService } from '../../services/poll';
import { AuthService } from '../../auth/auth.service';
import { UserService } from '../../services/user';
import { canSeeMoka } from '../../auth/moka.guard';

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
  imports: [RouterLink, RouterLinkActive, MusicPlayer],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header implements OnDestroy {
  auth = inject(AuthService);

  isMobileMenuOpen = false;

  private userService = inject(UserService);

  // Voks badge: open polls on my tours still waiting for my vote.
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

  // The soap bubble behind the logo and the menu: it sits on the selected
  // item (the logo on the home page), floats over to whichever one the
  // mouse is on (stretching to its width) and
  // back when the mouse leaves the menu. Placed after every render too, so
  // it follows a page change (routerLinkActive) and a menu item changing
  // width (the Voks badge, the font loading in).
  private header = viewChild<ElementRef<HTMLElement>>('header');
  private bubble = viewChild<ElementRef<HTMLElement>>('bubble');
  private hovered: HTMLElement | null = null;
  private bubbleTarget: HTMLElement | null = null;
  private bubbleBox = '';
  private bubbleSync = afterEveryRender(() => this.placeBubble());
  private fontsLoaded = document.fonts?.ready.then(() => this.placeBubble());

  hoverItem(item: EventTarget | null) {
    this.hovered = item as HTMLElement | null;
    this.placeBubble();
  }

  @HostListener('window:resize')
  placeBubble() {
    const bubble = this.bubble()?.nativeElement;
    const header = this.header()?.nativeElement;
    if (!bubble || !header) return;

    const target =
      this.hovered ??
      header.querySelector<HTMLElement>('.menu .menu-item.active, .logo-link.active');
    if (!target) {
      // Nothing selected (e.g. Profilom) and no hover: the bubble pops.
      bubble.classList.remove('shown');
      this.bubbleTarget = null;
      return;
    }
    // Where it is inside the header (the bubble's positioned parent).
    const h = header.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const box = [r.left - h.left, r.top - h.top, r.width, r.height].map(Math.round);
    if (target === this.bubbleTarget && box.join() === this.bubbleBox) return;

    // Appearing from nowhere: it forms in place instead of flying in from
    // wherever it last was.
    const appearing = !this.bubbleTarget || !bubble.classList.contains('shown');
    const moved = !appearing && target !== this.bubbleTarget;
    bubble.classList.toggle('instant', appearing);
    bubble.style.transform = `translate(${box[0]}px, ${box[1]}px)`;
    bubble.style.width = `${box[2]}px`;
    bubble.style.height = `${box[3]}px`;
    if (appearing) {
      void bubble.offsetWidth; // apply the jump before the transitions come back
      bubble.classList.remove('instant');
    }
    bubble.classList.add('shown');
    this.bubbleTarget = target;
    this.bubbleBox = box.join();

    // A soap bubble's wobble on the way: drawn out sideways as it sets off,
    // then squeezed the other way, settling back to round.
    if (moved && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bubble.firstElementChild?.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(1.1, 0.84)', offset: 0.28 },
          { transform: 'scale(0.95, 1.1)', offset: 0.55 },
          { transform: 'scale(1.02, 0.97)', offset: 0.78 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 750, easing: 'ease-out' },
      );
    }
  }

  ngOnDestroy() {
    clearInterval(this.pollTimer);
    this.navSub.unsubscribe();
  }

  // Média is members only - guests don't get the menu item at all.
  isMember = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'admin' || role === 'member';
  });

  seesMoka = computed(() => canSeeMoka(this.auth.user()));

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
