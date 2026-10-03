import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { API, formEntries } from '../../../testing/http';
import { FakeSocket, fail, logIn, pageTesting, respond } from '../../../testing/component';
import { NotificationsService } from '../../notifications/notifications.service';
import { shrinkImage } from '../../shared/image-resize';
import { TourSocketService } from '../../services/tour-socket';
import { Compose } from './compose/compose';
import { Feed } from './feed';
import { Post, splitMentions } from './post/post';

const post = (id: string, creator: string, createdAt: string, over = {}) => ({
  _id: id,
  creator: { _id: creator, name: creator },
  text: `üzenet ${id}`,
  createdAt,
  updatedAt: createdAt,
  chatRoomId: 'room1',
  ...over,
});

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [pageTesting()] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Feed', () => {
  let fixture: ComponentFixture<Feed>;
  let feed: Feed;
  let socket: FakeSocket;

  function open(tourId: string | null = 't1') {
    logIn({ id: 'me', role: 'member' });
    socket = TestBed.inject(TourSocketService) as unknown as FakeSocket;
    fixture = TestBed.createComponent(Feed);
    feed = fixture.componentInstance;
    fixture.componentRef.setInput('chatRoomId', 'room1');
    fixture.componentRef.setInput('tourId', tourId);
    fixture.detectChanges();
    respond({
      'GET /tours/t1/chat/background': { data: { background: { version: 'v1' } } },
      'GET /tours/t1/rooms': {
        data: {
          houses: [],
          finalized: false,
          people: [
            { attendeeId: 'a1', userId: 'me', name: 'Teszt Elek', username: 'Elek' },
            { attendeeId: 'a2', userId: 'kid', name: 'Teszt Kata', username: 'Kató' },
            { attendeeId: 'a3', userId: null, name: 'Vendég', username: null },
          ],
        },
      },
      'GET /chat-rooms/general/people': {
        data: { people: [{ userId: 'u9', name: 'Kovács Béla', username: 'bela' }] },
      },
    });
    fixture.detectChanges();
  }

  it('joins the chat room and leaves it when closed', () => {
    open();
    expect(socket.joinChat).toHaveBeenCalledWith('room1');
    fixture.destroy();
    expect(socket.leaveChat).toHaveBeenCalledWith('room1');
    expect(socket.handlers.get('new-post')).toEqual([]);
  });

  it('knows who can be mentioned in a tour chat: the attendees with a username, except me', () => {
    open();
    expect(feed.mentionables()).toEqual([{ username: 'Kató', name: 'Teszt Kata' }]);
    expect([...feed.knownUsernames()]).toEqual(['elek', 'kato']);
    expect(feed.myUsername()).toBe('elek');
    expect(feed.backgroundImage()).toBe(`url("${API}/tours/t1/chat/background/image?v=v1")`);
  });

  it('takes the people of the general chat from its own list', () => {
    open(null);
    expect(feed.mentionables()).toEqual([{ username: 'bela', name: 'Kovács Béla' }]);
    expect(feed.myUsername()).toBeNull();
    expect(feed.backgroundImage()).toBeNull();
  });

  it('shows the posts it gets, with a break at each new day and at the first unread one', () => {
    open();
    socket.fire('initial-posts', {
      chatRoomId: 'room1',
      readAt: '2020-05-01T12:00:00',
      posts: [
        post('p1', 'kid', '2020-05-01T10:00:00'),
        post('p2', 'me', '2020-05-01T13:00:00'), // my own is never "unread"
        post('p3', 'kid', '2020-05-01T14:00:00', { deletedAt: 'x' }),
        post('p4', 'kid', '2020-05-02T09:00:00'),
        post('p5', 'kid', '2020-05-02T10:00:00'),
      ],
    });
    fixture.detectChanges();
    expect(feed.posts()).toHaveLength(5);
    expect(feed.firstUnreadId()).toBe('p4');
    expect([...feed.dayBreaks().entries()]).toEqual([
      ['p1', 'péntek, 2020. máj. 1.'],
      ['p4', 'szombat, 2020. máj. 2.'],
    ]);
    expect(fixture.nativeElement.textContent).toContain('Új üzenetek');
  });

  it('labels today and this week without a date', () => {
    open();
    const now = new Date();
    socket.fire('initial-posts', {
      chatRoomId: 'room1',
      posts: [post('p1', 'kid', now.toISOString())],
    });
    expect(feed.dayBreaks().get('p1')).toBe('ma');
    expect(feed.firstUnreadId()).toBeNull(); // no "read until" known
  });

  it("ignores another room's posts", () => {
    open();
    socket.fire('initial-posts', { chatRoomId: 'other', posts: [post('x', 'kid', '2020-05-01')] });
    socket.fire('new-post', post('y', 'kid', '2020-05-01', { chatRoomId: 'other' }));
    socket.fire('post-updated', post('z', 'kid', '2020-05-01', { chatRoomId: 'other' }));
    socket.fire('chat-error', 'valami hiba');
    expect(feed.posts()).toEqual([]);
  });

  it('adds new posts and replaces edited ones', () => {
    open();
    socket.fire('new-post', post('p1', 'kid', '2020-05-01T10:00:00'));
    socket.fire('new-post', post('p2', 'me', '2020-05-01T11:00:00'));
    socket.fire('post-updated', post('p1', 'kid', '2020-05-01T10:00:00', { text: 'javítva' }));
    fixture.detectChanges();
    expect(feed.posts().map((p) => p.text)).toEqual(['javítva', 'üzenet p2']);
  });

  it('sends text, edits, deletions and reactions through the socket', () => {
    open();
    feed.onCompose({ text: 'Sziasztok' });
    feed.onEdit('p1', 'javítva');
    feed.onDelete('p1');
    feed.onReact('p1', '👍');
    expect(socket.sent).toEqual([
      ['create-post', { chatRoomId: 'room1', text: 'Sziasztok' }],
      ['edit-post', { postId: 'p1', text: 'javítva' }],
      ['delete-post', { postId: 'p1' }],
      ['react-post', { postId: 'p1', emoji: '👍' }],
    ]);
  });

  it('uploads a photo with its caption', () => {
    open();
    const error = vi
      .spyOn(TestBed.inject(NotificationsService), 'addError')
      .mockImplementation(() => {});
    feed.onCompose({ text: 'Nézd!', image: new Blob(['x']) });
    expect(feed.sendingPhoto()).toBe(true);
    const req = TestBed.inject(HttpTestingController).expectOne(`${API}/chat-rooms/room1/images`);
    expect(formEntries(req.request.body)).toEqual({ image: 'foto.jpg', text: 'Nézd!' });
    req.flush({});
    expect(feed.sendingPhoto()).toBe(false);
    expect(socket.sent).toEqual([]);

    feed.onCompose({ text: '', image: new Blob(['x']) });
    respond({ 'POST /chat-rooms/room1/images': fail(400, 'Elérted a napi keretet.') });
    expect(error).toHaveBeenCalledWith('Elérted a napi keretet.');
    expect(feed.sendingPhoto()).toBe(false);
  });

  it('builds the photo links of a post', () => {
    open();
    expect(feed.chatThumb('p1')).toBe(`${API}/chat-rooms/room1/images/p1/thumb`);
    expect(feed.chatFull('p1')).toBe(`${API}/chat-rooms/room1/images/p1`);
  });

  it('switches to the next background', () => {
    open();
    const error = vi
      .spyOn(TestBed.inject(NotificationsService), 'addError')
      .mockImplementation(() => {});
    feed.nextBackground();
    feed.nextBackground(); // one switch at a time
    respond({ 'POST /tours/t1/chat/background/next': { data: { background: { version: 'v2' } } } });
    expect(feed.backgroundImage()).toContain('v=v2');
    expect(feed.switchingBackground()).toBe(false);

    feed.nextBackground();
    respond({ 'POST /tours/t1/chat/background/next': fail() });
    expect(error).toHaveBeenCalledWith('Nem sikerült hátteret váltani.');
  });
});

describe('splitMentions', () => {
  const known = new Set(['kato', 'bela.k', 'elek']);

  it('marks the names of known people, and which one is me', () => {
    expect(splitMentions('Szia @Kató és @elek!', known, 'elek')).toEqual([
      { text: 'Szia ' },
      { text: '@Kató', mention: true, me: false },
      { text: ' és ' },
      { text: '@elek', mention: true, me: true },
      { text: '!' },
    ]);
  });

  it('leaves unknown names and e-mail addresses as plain text', () => {
    expect(splitMentions('@ismeretlen írt a kato@x.hu címre', known, null)).toEqual([
      { text: '@ismeretlen írt a kato@x.hu címre' },
    ]);
  });

  it('does not swallow the punctuation after a name', () => {
    expect(splitMentions('Köszi @bela.k. Holnap @kato-', known, null)).toEqual([
      { text: 'Köszi ' },
      { text: '@bela.k', mention: true, me: false },
      { text: '. Holnap ' },
      { text: '@kato', mention: true, me: false },
      { text: '-' },
    ]);
  });

  it('handles a text that is only a mention, or has none', () => {
    expect(splitMentions('@kato', known, null)).toEqual([
      { text: '@kato', mention: true, me: false },
    ]);
    expect(splitMentions('sima szöveg', known, null)).toEqual([{ text: 'sima szöveg' }]);
    expect(splitMentions('', known, null)).toEqual([]);
  });
});

describe('Post', () => {
  let fixture: ComponentFixture<Post>;
  let item: Post;

  function open(inputs: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(Post);
    item = fixture.componentInstance;
    const all = {
      creatorInput: 'Teszt Kata',
      textInput: 'Szia @elek',
      timestampInput: '2020-05-01T10:05:00',
      knownUsernamesInput: new Set(['elek']),
      myUsernameInput: 'elek',
      currentUserIdInput: 'me',
      ...inputs,
    };
    for (const [key, value] of Object.entries(all)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  it('shows who wrote what and when', () => {
    open();
    expect(item.creator()).toBe('Teszt Kata');
    expect(item.textParts()).toEqual([
      { text: 'Szia ' },
      { text: '@elek', mention: true, me: true },
    ]);
    expect(item.timeLabel()).toBe('10:05');
    expect(item.dayLabel()).toBe('2020. máj. 1.');
    expect(item.fullTimestamp()).toContain('2020. május 1.');
    expect(item.nameColor).toBe('#1e88e5');
    expect(fixture.nativeElement.textContent).toContain('Teszt Kata');
  });

  it('labels a post of today as "ma", and my own in my colour', () => {
    open({ timestampInput: new Date(), isOwn: true });
    expect(item.dayLabel()).toBe('ma');
    expect(item.nameColor).toBe('#fb8c00');
  });

  it('groups the reactions and knows mine', () => {
    open({
      reactionsInput: [
        { user: { _id: 'me', name: 'Elek' }, emoji: '👍' },
        { user: { _id: 'kid', name: 'Kata' }, emoji: '👍' },
        { user: { _id: 'b', name: 'Béla' }, emoji: '😂' },
      ],
    });
    expect(item.myReaction()).toBe('👍');
    expect(item.reactionGroups()).toEqual([
      { emoji: '👍', count: 2, names: 'Elek, Kata', mine: true },
      { emoji: '😂', count: 1, names: 'Béla', mine: false },
    ]);
    fixture.componentRef.setInput('reactionsInput', null);
    expect(item.reactionGroups()).toEqual([]);
  });

  it('reacts from the picker, which closes on a click elsewhere', () => {
    open();
    const reacted: string[] = [];
    item.reacted.subscribe((e) => reacted.push(e));
    item.pickerOpen.set(true);
    item.closePickerOutside({ target: fixture.nativeElement } as unknown as Event);
    expect(item.pickerOpen()).toBe(true);
    item.closePickerOutside({ target: document.body } as unknown as Event);
    expect(item.pickerOpen()).toBe(false);

    item.pickerOpen.set(true);
    item.react('😮');
    expect(item.pickerOpen()).toBe(false);
    item.sheetOpen.set(true);
    item.sheetReact('😢');
    expect(item.sheetOpen()).toBe(false);
    expect(reacted).toEqual(['😮', '😢']);
  });

  it('edits the text: Enter saves, Escape cancels, an unchanged text is not sent', () => {
    open({ isOwn: true });
    const saved: string[] = [];
    item.editSaved.subscribe((t) => saved.push(t));
    const key = (k: string, shiftKey = false) =>
      ({ key: k, shiftKey, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

    item.startEdit();
    fixture.detectChanges();
    expect(item.draft()).toBe('Szia @elek');
    item.onEditKeydown(key('Enter', true)); // a new line, not a save
    expect(item.editing()).toBe(true);
    item.onEditKeydown(key('Enter'));
    expect(item.editing()).toBe(false);
    expect(saved).toEqual([]);

    item.startEdit();
    item.draft.set('   ');
    item.saveEdit(); // an empty text is not saved
    expect(item.editing()).toBe(true);
    item.draft.set(' Szia mindenki ');
    item.saveEdit();
    expect(saved).toEqual(['Szia mindenki']);

    item.startEdit();
    item.onEditKeydown(key('Escape'));
    expect(item.editing()).toBe(false);
  });

  it('deletes only after a second, confirming click', () => {
    open({ isOwn: true });
    const deleted = vi.fn();
    item.deleteConfirmed.subscribe(deleted);
    item.askDelete();
    expect(item.confirmingDelete()).toBe(true);
    item.confirmDelete();
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(item.confirmingDelete()).toBe(false);

    item.sheetOpen.set(true);
    item.sheetConfirmDelete();
    expect(deleted).toHaveBeenCalledTimes(2);
    expect(item.sheetOpen()).toBe(false);
  });

  it('opens the action sheet on a long press, unless the finger moves away', () => {
    vi.useFakeTimers();
    open({ isOwn: true });
    const touch = (x = 0, y = 0) =>
      ({ pointerType: 'touch', clientX: x, clientY: y }) as PointerEvent;
    const menu = { preventDefault: vi.fn() } as unknown as Event;

    item.onPointerDown({ pointerType: 'mouse' } as PointerEvent);
    vi.advanceTimersByTime(600);
    expect(item.sheetOpen()).toBe(false);

    item.onPointerDown(touch());
    item.onContextMenu(menu); // the browser's own menu stays away during the press
    expect(menu.preventDefault).toHaveBeenCalledTimes(1);
    item.onPointerMove(touch(3, 3));
    item.onPointerMove(touch(40, 0)); // scrolling, not pressing
    vi.advanceTimersByTime(600);
    expect(item.sheetOpen()).toBe(false);
    item.onPointerMove(touch(80, 0)); // nothing is being pressed any more

    item.onPointerDown(touch());
    vi.advanceTimersByTime(500);
    expect(item.sheetOpen()).toBe(true);
    item.sheetEdit();
    expect(item.sheetOpen()).toBe(false);
    expect(item.editing()).toBe(true);

    item.onPointerDown(touch()); // not while editing
    vi.advanceTimersByTime(600);
    expect(item.sheetOpen()).toBe(false);
    item.cancelPress();
    vi.useRealTimers();
  });

  it('copies the text to the clipboard', async () => {
    open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    item.sheetOpen.set(true);
    await item.copyText();
    expect(writeText).toHaveBeenCalledWith('Szia @elek');
    expect(item.sheetOpen()).toBe(false);

    writeText.mockRejectedValue(new Error('denied'));
    item.sheetOpen.set(true);
    await item.copyText(); // closes the sheet all the same
    expect(item.sheetOpen()).toBe(false);
  });

  it('shows a photo, sized to fit the bubble, unless it expired or the post is gone', () => {
    open({ image: { width: 1000, height: 500 }, imageThumbUrl: '/t', imageFullUrl: '/f' });
    expect(item.hasPhoto).toBe(true);
    expect(item.photoWidth).toBe(260);
    fixture.componentRef.setInput('image', { width: 300, height: 600 });
    expect(item.photoWidth).toBe(160); // a tall photo is narrowed
    fixture.componentRef.setInput('image', { width: 100, height: 0 });
    expect(item.photoWidth).toBe(100);

    fixture.componentRef.setInput('image', { width: 100, height: 100, expired: true });
    expect(item.hasPhoto).toBe(false);
    fixture.componentRef.setInput('image', { width: 100, height: 100 });
    fixture.componentRef.setInput('deleted', true);
    expect(item.hasPhoto).toBe(false);
  });
});

describe('Compose', () => {
  let fixture: ComponentFixture<Compose>;
  let compose: Compose;
  let sent: { text: string; image?: Blob }[];
  let box: HTMLTextAreaElement;

  const PEOPLE = [
    { username: 'kato', name: 'Teszt Kata' },
    { username: 'bela', name: 'Kovács Béla' },
    { username: 'arpi', name: 'Kiss Árpád' },
  ];
  const key = (k: string, shiftKey = false) =>
    ({ key: k, shiftKey, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

  /** Types into the box with the caret at the end. */
  function type(text: string) {
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    compose.onTextChange(text);
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(Compose);
    compose = fixture.componentInstance;
    fixture.componentRef.setInput('mentionables', PEOPLE);
    sent = [];
    compose.send.subscribe((m) => sent.push(m));
    fixture.detectChanges();
    box = fixture.nativeElement.querySelector('textarea');
  });

  it('sends the trimmed text on Enter and empties the box', () => {
    type('  Sziasztok  ');
    compose.onKeydown(key('Enter'));
    expect(sent).toEqual([{ text: 'Sziasztok', image: undefined }]);
    expect(compose.text()).toBe('');
  });

  it('does not send an empty message, a Shift+Enter, or while a photo is going up', () => {
    type('   ');
    compose.submit();
    type('sor');
    compose.onKeydown(key('Enter', true));
    fixture.componentRef.setInput('sending', true);
    compose.submit();
    expect(sent).toEqual([]);
  });

  it('suggests people by username or by any part of their name, ignoring accents', () => {
    type('Szia @k');
    expect(compose.suggestions().map((m) => m.username)).toEqual(['kato', 'bela', 'arpi']);
    type('Szia @arp');
    expect(compose.suggestions().map((m) => m.username)).toEqual(['arpi']);
    type('Szia @');
    expect(compose.suggestions()).toHaveLength(3);
    type('cim@k'); // an e-mail address is not a mention
    expect(compose.suggestions()).toEqual([]);
  });

  it('picks a suggestion with the arrows and Enter', async () => {
    type('Szia @k');
    compose.onKeydown(key('ArrowDown'));
    expect(compose.highlighted()).toBe(1);
    compose.onKeydown(key('ArrowUp'));
    compose.onKeydown(key('ArrowUp')); // wraps around
    expect(compose.highlighted()).toBe(2);
    compose.onKeydown(key('Enter'));
    await Promise.resolve();
    expect(compose.text()).toBe('Szia @arpi ');
    expect(compose.suggestions()).toEqual([]);
    expect(sent).toEqual([]); // Enter picked the name, it did not send
  });

  it('closes the suggestions on Escape and replaces only the half-typed name', () => {
    type('Szia @ka');
    compose.onKeydown(key('Escape'));
    expect(compose.suggestions()).toEqual([]);

    type('@ka');
    compose.onKeydown(key('Tab'));
    expect(compose.text()).toBe('@kato ');
    compose.pick(PEOPLE[0]); // nothing is being typed now
    expect(compose.text()).toBe('@kato ');
  });

  it('asks for a poll', () => {
    const asked = vi.fn();
    compose.pollRequested.subscribe(asked);
    compose.pollRequested.emit();
    expect(asked).toHaveBeenCalled();
  });

  describe('photo', () => {
    const pick = (file?: File) =>
      compose.pickPhoto({ target: { files: file ? [file] : [], value: 'x' } } as unknown as Event);

    /** A browser that can decode and re-encode the picked picture. */
    function decodable(width: number, height: number) {
      const drawImage = vi.fn();
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width, height, close: vi.fn() })),
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage,
      } as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        done,
      ) {
        done(new Blob([`${this.width}x${this.height}`], { type: 'image/jpeg' }));
      });
      return drawImage;
    }

    it('shrinks the picked photo and sends it with the text', async () => {
      decodable(3200, 1600);
      await pick(new File(['x'], 'kep.jpg', { type: 'image/jpeg' }));
      expect(compose.photo()).not.toBeNull();
      expect(await compose.photo()!.blob.text()).toBe('1600x800');

      type('Nézd!');
      compose.submit();
      expect(sent[0].text).toBe('Nézd!');
      expect(sent[0].image).toBeInstanceOf(Blob);
      expect(compose.photo()).toBeNull();
    });

    it('sends a photo without any text, and can drop it before sending', async () => {
      decodable(800, 600);
      await pick(new File(['x'], 'kep.jpg'));
      expect(await compose.photo()!.blob.text()).toBe('800x600'); // small enough as it is
      compose.removePhoto();
      expect(compose.photo()).toBeNull();

      await pick(new File(['x'], 'kep.jpg'));
      compose.submit();
      expect(sent).toHaveLength(1);
      expect(sent[0].text).toBe('');
    });

    it('says so when the file is not a picture', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')));
      await pick(new File(['x'], 'jegyzet.txt'));
      expect(compose.photoError()).toBe('Ez a fájl nem olvasható képként.');
      expect(compose.photo()).toBeNull();
      await pick(); // the dialog was cancelled
      expect(compose.photoError()).toBe('Ez a fájl nem olvasható képként.');
    });

    it('fails clearly when the browser cannot draw or encode the picture', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })),
      );
      await expect(shrinkImage(new File(['x'], 'a.jpg'))).rejects.toThrow('nem dolgozható fel');

      decodable(10, 10);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(null));
      await expect(shrinkImage(new File(['x'], 'a.jpg'))).rejects.toThrow('nem dolgozható fel');
    });
  });
});
