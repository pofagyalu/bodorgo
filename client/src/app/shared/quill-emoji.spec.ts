import Quill from 'quill';

import { EMOJIS, emojiHandler, registerEmojiIcon, wireEmojiButton } from './quill-emoji';

// The editors' 😊 button (quill-emoji.ts): one click, the panel; a second,
// the emoji in at the cursor.
describe('the emoji button', () => {
  let host: HTMLElement;
  let quill: Quill;

  beforeEach(() => {
    host = document.createElement('div');
    const editor = document.createElement('div');
    host.appendChild(editor);
    document.body.appendChild(host);
    registerEmojiIcon(Quill);
    quill = new Quill(editor, {
      theme: 'snow',
      modules: { toolbar: { container: [['bold'], ['emoji']], handlers: { emoji: emojiHandler } } },
    });
    wireEmojiButton(quill);
    quill.setText('Szép nap volt\n');
  });

  afterEach(() => {
    host.remove();
    document.querySelectorAll('.emoji-panel').forEach((p) => p.remove());
  });

  const button = () => host.querySelector<HTMLButtonElement>('.ql-emoji')!;
  const panel = () => document.querySelector<HTMLElement>('.emoji-panel');

  it('opens forty emojis; the one picked goes in where the cursor was', () => {
    expect(EMOJIS).toHaveLength(40);
    expect(button().innerHTML).toContain('<svg');
    expect(button().title).toBe('Emoji beszúrása');

    quill.setSelection(4, 0); // after "Szép"
    button().click();
    const choices = panel()!.querySelectorAll<HTMLButtonElement>('.emoji-choice');
    expect(choices).toHaveLength(40);
    const beer = [...choices].find((c) => c.textContent === '🍺')!;
    beer.click();
    expect(quill.getText()).toBe('Szép🍺 nap volt\n');
    expect(quill.getSelection()?.index).toBe(4 + '🍺'.length);
    expect(panel()).toBeNull();
  });

  it('a second click on the button, or one beside the panel, closes it', () => {
    button().click();
    expect(panel()).not.toBeNull();
    button().click();
    expect(panel()).toBeNull();

    button().click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(panel()).toBeNull();
    expect(quill.getText()).toBe('Szép nap volt\n');
  });

  describe('on a desktop (a mouse to hover with)', () => {
    beforeEach(() => {
      host.remove();
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      host = document.createElement('div');
      const editor = document.createElement('div');
      host.appendChild(editor);
      document.body.appendChild(host);
      quill = new Quill(editor, {
        theme: 'snow',
        modules: { toolbar: { container: [['emoji']], handlers: { emoji: emojiHandler } } },
      });
      wireEmojiButton(quill);
      quill.setText('Szép nap volt\n');
    });
    afterEach(() => vi.unstubAllGlobals());

    const hover = (el: Element, on = true) =>
      el.dispatchEvent(new MouseEvent(on ? 'mouseenter' : 'mouseleave'));

    it('opens as the mouse comes over the button - while the cursor is in the text', () => {
      hover(button());
      expect(panel()).toBeNull(); // not in the text yet

      quill.setSelection(4, 0);
      hover(button());
      expect(panel()).not.toBeNull();
      // A click on the button then keeps it open.
      button().click();
      expect(panel()).not.toBeNull();
    });

    it('stays while the mouse moves onto it, goes a moment after it left both', async () => {
      quill.setSelection(4, 0);
      hover(button());
      hover(button(), false);
      hover(panel()!);
      await new Promise((r) => setTimeout(r, 350));
      expect(panel()).not.toBeNull();

      hover(panel()!, false);
      await new Promise((r) => setTimeout(r, 350));
      expect(panel()).toBeNull();
    });
  });
});
