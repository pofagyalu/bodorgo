import { ComponentFixture, TestBed } from '@angular/core/testing';

import { logIn, pageTesting, respond } from '../../../testing/component';
import { ChatService } from '../../services/chat';
import { PollService } from '../../services/poll';
import { Header } from './header';

describe('Header', () => {
  let component: Header;
  let fixture: ComponentFixture<Header>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Header],
      providers: [pageTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(Header);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  const badgeOf = (nav: string, link: string) =>
    el.querySelector(`${nav} a[href="${link}"] .menu-badge`)?.textContent?.trim() ?? null;

  const overview = (unread: number) => ({
    data: {
      general: { chatRoomId: 'g', lastPost: null, unread, memberCount: 9 },
      tours: [],
    },
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('marks where something new waits: the Kotyogó, the Voks and the phone menu button', () => {
    logIn({ role: 'member' });
    fixture.detectChanges();
    respond({
      'GET /polls/pending': { data: { count: 1 } },
      'GET /chat-rooms/overview': overview(3),
    });
    fixture.detectChanges();

    for (const nav of ['.menu', '.mobile-nav']) {
      expect(badgeOf(nav, '/chat')).toBe('3');
      expect(badgeOf(nav, '/szavazasok')).toBe('1');
    }
    expect(el.querySelector('.hamburger-badge')!.textContent!.trim()).toBe('4');
  });

  it('shows no mark once everything has been seen', () => {
    logIn({ role: 'member' });
    fixture.detectChanges();
    respond({
      'GET /polls/pending': { data: { count: 0 } },
      'GET /chat-rooms/overview': overview(0),
    });
    fixture.detectChanges();
    expect(el.querySelector('.menu-badge')).toBeNull();
    expect(el.querySelector('.hamburger-badge')).toBeNull();

    // New messages arrive: the services say so, the marks follow.
    TestBed.inject(ChatService).unreadCount.set(2);
    TestBed.inject(PollService).pendingCount.set(0);
    fixture.detectChanges();
    expect(badgeOf('.mobile-nav', '/chat')).toBe('2');
    expect(el.querySelector('.hamburger-badge')!.textContent!.trim()).toBe('2');
  });
});
