import { ComponentFixture, TestBed } from '@angular/core/testing';

import { httpTesting } from '../../../testing/http';
import { fail, respond } from '../../../testing/component';
import { MediaEdit, MediaEditDialog } from './media-edit-dialog';

const users = [
  { _id: 'a', name: 'Admin Anna', role: 'admin' },
  { _id: 'm1', name: 'Tag Tamás', role: 'member' },
  { _id: 'm2', name: 'Tag Tímea', role: 'member' },
  { _id: 'r', name: 'Régi Róbert', role: 'member', retired: true },
  { _id: 'g', name: 'Vendég Vera', role: 'guest' },
];

describe('MediaEditDialog', () => {
  let fixture: ComponentFixture<MediaEditDialog>;
  let dialog: MediaEditDialog;
  let saved: MediaEdit[];

  function open(
    viewers: string[] = [],
    members: object = { data: { users } },
    access: 'all' | 'chosen' | 'admins' | null = null,
  ) {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    fixture = TestBed.createComponent(MediaEditDialog);
    dialog = fixture.componentInstance;
    fixture.componentRef.setInput('heading', 'Videó szerkesztése');
    fixture.componentRef.setInput('title', 'Jelmezbál');
    fixture.componentRef.setInput('discoveredTitle', 'Farsang');
    fixture.componentRef.setInput('discoveredLabel', 'A fájl neve szerint');
    fixture.componentRef.setInput('viewers', viewers);
    fixture.componentRef.setInput('access', access);
    saved = [];
    dialog.saved.subscribe((edit) => saved.push(edit));
    fixture.detectChanges();
    respond({ 'GET /membership/users': members });
    fixture.detectChanges();
  }

  const save = () => dialog.save(new Event('submit'));

  it('starts open to every member, and saves the trimmed title with no viewers', () => {
    open();
    expect(dialog.restricted()).toBe(false);
    dialog.editTitle.set('  Új cím ');
    dialog.toggle('m1'); // chosen, but "every member" is what counts
    save();
    expect(saved).toEqual([{ title: 'Új cím', viewers: [] }]);
  });

  it('offers the active members only, and saves the chosen ones', () => {
    open();
    expect(dialog.members().map((m) => m._id)).toEqual(['m1', 'm2']);
    dialog.pick('chosen');
    save(); // nobody chosen: that would open it to everyone
    expect(saved).toEqual([]);
    expect(dialog.nobodyChosen()).toBe(true);

    dialog.toggle('m1');
    dialog.toggle('m2');
    dialog.toggle('m1');
    expect(dialog.nobodyChosen()).toBe(false);
    save();
    expect(saved).toEqual([{ title: 'Jelmezbál', viewers: ['m2'] }]);
  });

  it('keeps someone already chosen in the list, whatever they are now', () => {
    open(['g', 'm1']);
    expect(dialog.restricted()).toBe(true);
    expect(dialog.members().map((m) => m._id)).toEqual(['m1', 'm2', 'g']);
    expect(fixture.nativeElement.querySelectorAll('.members input:checked').length).toBe(2);
    dialog.toggle('g');
    save();
    expect(saved).toEqual([{ title: 'Jelmezbál', viewers: ['m1'] }]);
  });

  it('shows where the title comes from only when told (a photo has no such thing)', () => {
    open();
    expect(fixture.nativeElement.textContent).toContain('A fájl neve szerint: Farsang');
    fixture.componentRef.setInput('discoveredLabel', '');
    fixture.componentRef.setInput('titleLabel', 'Név');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Farsang');
    expect(fixture.nativeElement.querySelector('label').textContent).toBe('Név');
  });

  it('says so when the members cannot be loaded', () => {
    open(['m1'], fail());
    expect(dialog.membersError()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Nem sikerült betölteni a tagokat.');
  });

  it('is not closed while saving', () => {
    open();
    let cancelled = 0;
    dialog.cancelled.subscribe(() => cancelled++);
    fixture.componentRef.setInput('saving', true);
    dialog.cancel();
    save();
    expect([cancelled, saved.length]).toEqual([0, 0]);
    fixture.componentRef.setInput('saving', false);
    dialog.cancel();
    expect(cancelled).toBe(1);
  });

  it('has no AI switch for a photo, and says nothing of it', () => {
    open();
    expect(fixture.nativeElement.querySelector('app-toggle-switch')).toBeNull();
    save();
    expect(saved[0]).not.toHaveProperty('aiGenerated');
  });

  it("a video's AI switch starts as it was, and is saved", () => {
    TestBed.configureTestingModule({ providers: [httpTesting()] });
    fixture = TestBed.createComponent(MediaEditDialog);
    dialog = fixture.componentInstance;
    fixture.componentRef.setInput('heading', 'Videó szerkesztése');
    fixture.componentRef.setInput('title', 'Jelmezbál');
    fixture.componentRef.setInput('aiGenerated', true);
    saved = [];
    dialog.saved.subscribe((edit) => saved.push(edit));
    fixture.detectChanges();
    respond({ 'GET /membership/users': { data: { users } } });
    fixture.detectChanges();
    expect(dialog.editAi()).toBe(true);
    fixture.nativeElement.querySelector('app-toggle-switch button').click();
    save();
    expect(saved).toEqual([{ title: 'Jelmezbál', viewers: [], aiGenerated: false }]);
  });

  // The radios under "Ki láthatja?", as the page shows them.
  const choices = () =>
    [...fixture.nativeElement.querySelectorAll('.access > .choice')].map((l: Element) =>
      l.textContent!.replace(/\s+/g, ' ').trim(),
    );

  it('a photo has two choices - no "Csak az adminok", nothing about it saved', () => {
    open();
    expect(choices()).toEqual(['Minden klubtag', 'Csak a kiválasztott tagok']);
    save();
    expect(saved[0].access).toBeUndefined();
  });

  it('a new video starts as "Csak az adminok", and saves it with nobody chosen', () => {
    open([], { data: { users } }, 'admins');
    expect(choices()).toEqual(['Minden klubtag', 'Csak a kiválasztott tagok', 'Csak az adminok']);
    expect(dialog.choice()).toBe('admins');
    expect(fixture.nativeElement.querySelector('.members')).toBeNull();
    save();
    expect(saved).toEqual([{ title: 'Jelmezbál', access: 'admins', viewers: [] }]);
  });

  it('a video opened to every member, or to the chosen ones, says which', () => {
    open([], { data: { users } }, 'admins');
    dialog.pick('all');
    save();
    dialog.pick('chosen');
    dialog.toggle('m1');
    save();
    expect(saved).toEqual([
      { title: 'Jelmezbál', access: 'all', viewers: [] },
      { title: 'Jelmezbál', access: 'chosen', viewers: ['m1'] },
    ]);
  });
});
