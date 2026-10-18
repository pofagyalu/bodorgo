import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import Quill from 'quill';
import { emojiHandler, registerEmojiIcon, wireEmojiButton } from '../../../shared/quill-emoji';
import { ReportAttendee, ReportHike } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';
import { lazyStyle } from '../../../shared/lazy-style';

// A word linked to one of the tour's attendees: the editor's own `person`
// format, the attendee's user id on the text. Only the editor shows it (a
// dotted underline) - the PDF prints the text as typed; it says who the
// text is about (see tourReportController.js's cleanDelta). The same way
// `hike`: a piece of text linked to one of the tour's walked hikes (its
// GPX document's id) - which hike it happened on.
type LinkKind = 'person' | 'hike';
const LINK_KINDS: LinkKind[] = ['person', 'hike'];
const Parchment = Quill.import('parchment');
for (const kind of LINK_KINDS) {
  Quill.register(
    new Parchment.Attributor(kind, `data-${kind}`, { scope: Parchment.Scope.INLINE }),
    true,
  );
}
// Their toolbar buttons: a person with a plus, and two peaks.
(Quill.import('ui/icons') as Record<string, string>)['hike'] =
  '<svg viewBox="0 0 18 18"><path class="ql-fill" d="M1 15l5-9 3 5 2-3 6 7z"/></svg>';
(Quill.import('ui/icons') as Record<string, string>)['person'] =
  '<svg viewBox="0 0 18 18"><circle class="ql-fill" cx="7" cy="5.5" r="2.8"/>' +
  '<path class="ql-fill" d="M1.5 15c0-3 2.4-5 5.5-5 1 0 2 .2 2.8.7-1.1.9-1.8 2.3-1.8 4.3z"/>' +
  '<path class="ql-stroke" d="M11.5 12.5h4M13.5 10.5v4"/></svg>';

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const WORD_CHAR = /[\p{L}\p{N}-]/u;

// The text being linked: to what kind of thing, where it is, and what
// it's linked to now.
interface LinkPicker {
  kind: LinkKind;
  index: number;
  length: number;
  text: string;
  current: string | null;
}

// One day of the beszámoló (tour-report-panel has one per day of the
// tour): its small rich-text editor (Quill), and the linking of a word to
// an attendee or a piece of text to a hike - the two extra toolbar
// buttons, the panel to pick from, and the line under the editor saying
// what is linked to whom. It keeps its own text; the window asks for it
// when it saves (contents), and is told when the admin changed it (edited).
@Component({
  selector: 'app-report-day-editor',
  imports: [MatIconModule],
  templateUrl: './report-day-editor.html',
  styleUrl: './report-day-editor.scss',
})
export class ReportDayEditor {
  private notifications = inject(NotificationsService);

  // The day's saved text (a Quill delta) - read once, when the editor is
  // made.
  content = input<unknown>(null);
  placeholder = input('Mi történt ezen a napon?');
  // Who a word can be linked to, and the tour's walked hikes.
  attendees = input<ReportAttendee[]>([]);
  hikes = input<ReportHike[]>([]);
  // A finished beszámoló is read-only until it's reopened.
  locked = input(false);
  // The admin changed the text or a link.
  edited = output<void>();

  private editorEl = viewChild.required<ElementRef<HTMLDivElement>>('editor');
  private quill = signal<Quill | null>(null);

  // Whether the day has any text - for Kész, and the day heading's pill.
  filled = signal(false);
  // The linked words and who (which hike) they are: "Sanyi → Kovács Sándor".
  linked = signal<{ kind: LinkKind; text: string; name: string }[]>([]);
  picker = signal<LinkPicker | null>(null);
  // Everyone on the tour, those the picked text may mean first - or the
  // tour's walked hikes.
  pickerChoices = computed(() => {
    const p = this.picker();
    if (!p) return [];
    if (p.kind === 'hike') return this.hikes().map((h) => ({ ...h, likely: false }));
    const stem = plain(p.text).slice(0, 3);
    return this.attendees()
      .map((a) => ({
        ...a,
        likely:
          stem.length === 3 &&
          plain(a.name)
            .split(' ')
            .some((w) => w.startsWith(stem)),
      }))
      .sort((a, b) => Number(b.likely) - Number(a.likely));
  });

  constructor() {
    afterNextRender(() => this.createEditor());
    effect(() => this.quill()?.enable(!this.locked()));
  }

  private createEditor() {
    // The editors' stylesheet comes with them (shared/lazy-style) - asked
    // for already when the tour page showed an admin the button
    // (tour-extras).
    void lazyStyle('quill');
    const el = this.editorEl().nativeElement;
    registerEmojiIcon(Quill);
    const quill = new Quill(el, {
      theme: 'snow',
      placeholder: this.placeholder(),
      modules: {
        toolbar: {
          container: [
            ['bold', 'italic', 'underline'],
            [{ list: 'bullet' }, { list: 'ordered' }],
            [{ indent: '-1' }, { indent: '+1' }],
            // The hike button only on a tour that has a walked hike.
            this.hikes().length ? ['person', 'hike'] : ['person'],
            ['emoji'],
            ['clean'],
          ],
          handlers: {
            person: () => this.openPicker('person'),
            hike: () => this.openPicker('hike'),
            emoji: emojiHandler,
          },
        },
      },
    });
    const wrap = el.parentElement;
    wrap?.querySelector('.ql-person')?.setAttribute('title', 'Név összekötése egy résztvevővel');
    wrap
      ?.querySelector('.ql-hike')
      ?.setAttribute('title', 'Szöveg összekötése egy megtett túrával');
    // Quill's "Tx": the selected text loses its formats - the links too.
    wrap
      ?.querySelector('.ql-clean')
      ?.setAttribute('title', 'Formázás törlése a kijelölt szövegről (az összekötést is)');
    wireEmojiButton(quill);
    const content = this.content();
    if (content) quill.setContents(content as never, 'silent');
    quill.on('text-change', (delta, _old, source) => {
      if (source === 'user') this.keepLinkTight(quill, delta.ops);
      this.picker.set(null);
      this.update(quill);
      if (source === 'user') this.edited.emit();
    });
    this.update(quill);
    this.quill.set(quill);
  }

  // The day's text as the server takes it - null when there is none.
  contents(): unknown {
    const quill = this.quill();
    return quill?.getText().trim() ? quill.getContents() : null;
  }

  private update(quill: Quill) {
    this.filled.set(quill.getText().trim().length > 0);
    const names = new Map([...this.attendees(), ...this.hikes()].map((x) => [x.id, x.name]));
    this.linked.set(
      quill.getContents().ops.flatMap((op) =>
        LINK_KINDS.filter((kind) => typeof op.insert === 'string' && op.attributes?.[kind]).map(
          (kind) => ({
            kind,
            text: (op.insert as string).trim(),
            name: names.get(op.attributes![kind] as string) ?? '?',
          }),
        ),
      ),
    );
  }

  // What's typed right after a linked word would join the link (the
  // browser carries a format on) - "Sanyi" linked, then " leesett" typed:
  // only the name stays linked.
  private keepLinkTight(
    quill: Quill,
    ops: { retain?: unknown; insert?: unknown; attributes?: Record<string, unknown> }[],
  ) {
    let at = 0;
    for (const op of ops) {
      if (typeof op.retain === 'number') at += op.retain;
      else if (typeof op.insert === 'string') {
        const length = op.insert.length;
        for (const kind of LINK_KINDS) {
          const linkedTo = op.attributes?.[kind];
          if (
            linkedTo &&
            at > 0 &&
            quill.getFormat(at - 1, 1)[kind] === linkedTo &&
            quill.getFormat(at + length, 1)[kind] !== linkedTo
          ) {
            quill.formatText(at, length, kind, false, 'silent');
          }
        }
        at += length;
      } else if (op.insert) at += 1;
    }
  }

  // A toolbar button: the selected text - or, with nothing selected, the
  // word the cursor is in.
  private openPicker(kind: LinkKind) {
    const quill = this.quill();
    if (!quill || this.locked()) return;
    if (this.picker()?.kind === kind) {
      this.picker.set(null);
      return;
    }
    let { index, length } = quill.getSelection(true);
    if (!length) {
      const all = quill.getText();
      let end = index;
      while (index > 0 && WORD_CHAR.test(all[index - 1])) index--;
      while (end < all.length && WORD_CHAR.test(all[end])) end++;
      length = end - index;
    }
    const text = quill.getText(index, length);
    if (!text.trim() || text.includes('\n')) {
      this.notifications.addError(
        kind === 'hike'
          ? 'Jelöld ki a szövegben, ami a túrán történt, aztán nyomd meg újra.'
          : 'Jelöld ki a nevet a szövegben, aztán nyomd meg újra.',
      );
      return;
    }
    const current = quill.getFormat(index, length)[kind];
    this.picker.set({
      kind,
      index,
      length,
      text,
      current: typeof current === 'string' ? current : null,
    });
  }

  // null: the link taken off.
  linkTo(choice: { id: string } | null) {
    const p = this.picker();
    const quill = this.quill();
    if (!p || !quill || this.locked()) return;
    quill.formatText(p.index, p.length, p.kind, choice?.id ?? false, 'user');
    this.picker.set(null);
  }
}
