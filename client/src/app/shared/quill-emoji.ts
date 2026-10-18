import type Quill from 'quill';

// The editors' 😊 button (Voks, beszámoló, a tour's letter): a card of
// emojis floating above it - on a desktop as soon as the mouse is over it
// (while the cursor is in the text), else on a click - and a click on one
// puts it in at the cursor. In a toolbar's container it's `'emoji'`, in its handlers
// `emoji: emojiHandler`; registerEmojiIcon before `new Quill(...)`,
// wireEmojiButton after. Quill itself isn't imported here - the editors
// load it as they do (Voks only when its editor opens). Its look:
// src/quill-emoji.scss, in the editors' own stylesheet (shared/lazy-style).

// The ones a tour is written with: faces, hands, food and drink, camping,
// on the move, the weather, nature, music.
export const EMOJIS = [
  '😀 😂 😍 🥰 😎 🤔 😴 🥳',
  '👍 👏 🙏 💪 ❤️ 🔥 ⭐ 🎉',
  '🍺 🍷 🥂 🍕 🏕️ ⛺ 🥾 🚶',
  '🚴 🏊 🚗 🚌 🌞 🌧️ ⛈️ ❄️',
  '🌲 🏞️ 🎸 🎶 📷 🐶 😅 😢',
]
  .join(' ')
  .split(' ');

// The button's face: a smiley drawn like Quill's own icons (its stroke
// colours, so it lights up with them).
const ICON =
  '<svg viewBox="0 0 18 18"><circle class="ql-stroke" cx="9" cy="9" r="7"></circle>' +
  '<path class="ql-stroke" d="M6 10.5c.8 1.2 1.8 1.8 3 1.8s2.2-.6 3-1.8"></path>' +
  '<circle class="ql-fill" cx="6.6" cy="7" r="1"></circle>' +
  '<circle class="ql-fill" cx="11.4" cy="7" r="1"></circle></svg>';

// Before the editor is made: the button's icon among Quill's own.
export function registerEmojiIcon(QuillClass: typeof Quill) {
  (QuillClass.import('ui/icons') as Record<string, string>)['emoji'] = ICON;
}

// The button's work - in the toolbar's handlers, as `emoji: emojiHandler`
// (Quill only wires a button it knows when the editor is made). Quill
// calls it on the toolbar: `this.quill`, `this.container`. The panel is a
// card floating above the button (below it when there's no room above),
// on the page itself - no scrolling box around the editor cuts it off.
let openPanel: { close: () => void; quill: Quill; byHover: boolean; panel: HTMLElement } | null =
  null;

export function emojiHandler(this: { quill: Quill; container: HTMLElement }) {
  const { quill, container } = this;
  // Opened by the mouse already (a desktop): the click keeps it.
  if (openPanel?.quill === quill && openPanel.byHover) return;
  if (openPanel) {
    const same = openPanel.quill === quill;
    openPanel.close();
    if (same) return;
  }
  openEmojiPanel(quill, container, false);
}

function openEmojiPanel(quill: Quill, container: HTMLElement, byHover: boolean) {
  const button = container.querySelector<HTMLElement>('.ql-emoji');
  if (!button) return;
  // Where it goes: the cursor, or the end if the editor had none.
  const at = quill.getSelection(true)?.index ?? quill.getLength() - 1;

  const panel = document.createElement('div');
  panel.className = 'emoji-panel';
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Emoji beszúrása');
  const close = () => {
    panel.remove();
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    if (openPanel?.close === close) openPanel = null;
  };
  const outside = (e: Event) => {
    const target = e.target as Node;
    if (!panel.contains(target) && !button.contains(target)) close();
  };
  for (const emoji of EMOJIS) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'emoji-choice';
    choice.textContent = emoji;
    // The press doesn't take the cursor out of the text.
    choice.addEventListener('mousedown', (e) => e.preventDefault());
    choice.addEventListener('click', () => {
      quill.insertText(at, emoji, 'user');
      quill.setSelection(at + emoji.length, 0, 'user');
      close();
    });
    panel.appendChild(choice);
  }
  document.body.appendChild(panel);
  place(panel, button);
  // Shown in the next frame, so it fades and rises in (quill-emoji.scss).
  requestAnimationFrame(() => panel.classList.add('emoji-panel--open'));
  document.addEventListener('mousedown', outside, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  openPanel = { close, quill, byHover, panel };
}

// Above the button, centred on it, inside the window - on a phone in the
// middle of the screen; below it when the window's top is too close.
function place(panel: HTMLElement, button: HTMLElement) {
  const gap = 8;
  const b = button.getBoundingClientRect();
  const { width, height } = panel.getBoundingClientRect();
  const phone = window.matchMedia?.('(max-width: 768px)').matches;
  const left = phone
    ? (window.innerWidth - width) / 2
    : Math.min(Math.max(gap, b.left + b.width / 2 - width / 2), window.innerWidth - width - gap);
  const above = b.top - height - gap;
  panel.style.left = `${Math.max(gap, left)}px`;
  if (above >= gap) {
    panel.style.top = `${above}px`;
  } else {
    panel.style.top = `${b.bottom + gap}px`;
    panel.classList.add('emoji-panel--below');
  }
}

// Once the editor is made: the button's title - and on a desktop, the
// panel as soon as the mouse is over the button while the cursor is in the
// text (it goes in there); it stays while the mouse
// is on the button or the panel, and goes a moment after it left both. (A
// phone has no hover: a tap opens it.)
const LEAVE_MS = 300;

export function wireEmojiButton(quill: Quill) {
  const toolbar = quill.getModule('toolbar') as { container: HTMLElement };
  const button = toolbar.container.querySelector<HTMLElement>('.ql-emoji');
  if (!button) return;
  button.setAttribute('title', 'Emoji beszúrása');
  if (!window.matchMedia?.('(hover: hover)').matches) return;

  let leaving: ReturnType<typeof setTimeout> | undefined;
  const stay = () => clearTimeout(leaving);
  const leave = () => {
    stay();
    leaving = setTimeout(() => {
      if (openPanel?.quill === quill && openPanel.byHover) openPanel.close();
    }, LEAVE_MS);
  };
  button.addEventListener('mouseenter', () => {
    stay();
    // Only while the cursor is in the text: that's where it would go.
    if (openPanel?.quill === quill || !quill.hasFocus()) return;
    openPanel?.close();
    openEmojiPanel(quill, toolbar.container, true);
    openPanel?.panel.addEventListener('mouseenter', stay);
    openPanel?.panel.addEventListener('mouseleave', leave);
  });
  button.addEventListener('mouseleave', leave);
}
