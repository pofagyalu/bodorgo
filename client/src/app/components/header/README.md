# The soap bubble in the main menu

The main menu (Táborok, Média, Chat, Klub, Voks) has a bubble behind
the selected item. When the mouse moves onto another item, the bubble floats
over to it, stretches to that item's width, and wobbles like a soap bubble.
When the mouse leaves the menu, the bubble floats back to the selected item.

This note explains how it works, one idea at a time. The code is in three
files next to this one:

- `header.html`: the bubble element and the mouse events;
- `header.ts`: `placeBubble()`, which decides where the bubble goes;
- `header.scss`: `.menu-bubble` and `.menu-bubble-skin`, which set how it
  moves and how it looks.

---

## 1. One bubble for the whole menu, not one per item

The old version gave the `.active` item its own highlight box (border,
shadow, background). A box like that can only appear and disappear. It
can't travel, because each item had its own.

The new version has a **single extra element** in the menu, placed before
the items:

```html
<nav class="menu" #menu (mouseleave)="hoverItem(null)">
  <span class="menu-bubble" #bubble aria-hidden="true">
    <span class="menu-bubble-skin"></span>
  </span>
  <a
    routerLink="/taborok"
    routerLinkActive="active"
    (mouseenter)="hoverItem($event.currentTarget)"
    class="menu-item green"
    >Táborok</a
  >
  ...
</nav>
```

- `.menu` is `position: relative`, and the bubble is `position: absolute`.
  That takes the bubble out of the flex row, so it doesn't push the items
  around. It can then be placed anywhere inside the menu.
- The items get `z-index: 1`, so their text sits **above** the bubble.
- `pointer-events: none` on the bubble lets the mouse "see through" it to
  the items.
- `aria-hidden="true"`: the bubble is pure decoration, and screen readers
  skip it.

**The trick:** instead of showing and hiding a box on each item, one box
is moved and resized to wherever it should be.

## 2. Measuring the target item

`placeBubble()` first decides which item the bubble belongs to:

```ts
const target = this.hovered ?? menu.querySelector<HTMLElement>('.menu-item.active');
```

It uses the hovered item if there is one. Otherwise it uses the selected
one: `routerLinkActive` puts the `active` class on it.

Then it measures that item:

```ts
const box = [target.offsetLeft, target.offsetTop, target.offsetWidth, target.offsetHeight];
```

`offsetLeft` and `offsetTop` are measured from the nearest positioned
ancestor, which is `.menu`. That is exactly the space the bubble is
positioned in, so the numbers can be used directly:

```ts
bubble.style.transform = `translate(${box[0]}px, ${box[1]}px)`;
bubble.style.width = `${box[2]}px`;
bubble.style.height = `${box[3]}px`;
```

Why `transform: translate(...)` rather than `left`/`top`? A transform is
cheap for the browser to animate: it just moves pixels that are already
drawn, without re-laying out the page. That keeps the movement smooth.

## 3. The movement: CSS transitions do the animating

The TypeScript only says where the bubble should be. It never animates
anything frame by frame. CSS transitions animate from the old values to
the new ones:

```scss
.menu-bubble {
  transition:
    transform 0.55s cubic-bezier(0.34, 1.4, 0.55, 1),
    width 0.65s cubic-bezier(0.34, 1.5, 0.55, 1),
    height 0.65s cubic-bezier(0.34, 1.5, 0.55, 1),
    opacity 0.3s ease;
}
```

Two details make it feel like a floating bubble rather than a sliding box.

### a) An easing curve that overshoots

A `cubic-bezier(x1, y1, x2, y2)` describes how the animation speeds up and
slows down. Normally the y values stay between 0 and 1. Here
**`y1 = 1.4` goes above 1**, so the animation goes past its target
position, then settles back. That little overshoot-and-return is the
"springy" feel.

You can play with the curve visually at <https://cubic-bezier.com>. Try
`0.34, 1.4, 0.55, 1`, then drag the handles higher for more bounce.

### b) Size and position take different amounts of time

The move takes 0.55s and the resize takes 0.65s. Because the resize lags
behind the move, the bubble looks **stretched** while it travels, a bit
like something soft being pulled. The size curve also overshoots slightly
more (1.5 vs 1.4).

## 4. The wobble: the Web Animations API

When the bubble lands on a new item, it squishes like jelly. It gets wider
and flatter, then narrower and taller, then round again. That wobble is a
separate animation, started from TypeScript with `element.animate(...)`:

```ts
bubble.firstElementChild?.animate(
  [
    { transform: 'scale(1, 1)' },
    { transform: 'scale(1.1, 0.84)', offset: 0.28 }, // wide and flat
    { transform: 'scale(0.95, 1.1)', offset: 0.55 }, // narrow and tall
    { transform: 'scale(1.02, 0.97)', offset: 0.78 }, // a smaller echo
    { transform: 'scale(1, 1)' }, // round again
  ],
  { duration: 750, easing: 'ease-out' },
);
```

- `element.animate()` is like a CSS `@keyframes` animation, but it can be
  started from code at the exact moment you need it. Each call starts a
  fresh wobble.
- `offset` is the point in time (0 to 1) at which that keyframe is reached.
- Each squish is smaller than the one before (1.1 → 0.95 → 1.02 → 1).
  That is how real springy things lose energy.

**Why the extra inner element (`.menu-bubble-skin`)?** The outer
`.menu-bubble` already uses `transform` for its position. If the wobble
also set `transform` on that same element, the two would overwrite each
other and the bubble would jump. So the work is split between two
elements:

- the **outer** element moves and resizes (`translate`, `width`,
  `height`);
- the **inner** "skin" is what you actually see, and it wobbles
  (`scale`).

This split is a common trick: **one element per kind of motion.**

## 5. Appearing without flying in

On the home page no item is selected, so the bubble is hidden (opacity 0).
When you then hover over an item, the bubble should **form in place**. It
shouldn't fly in from wherever it was last time.

To do that, the bubble has to jump to its new place with transitions
turned off, then have them turned back on:

```ts
bubble.classList.toggle('instant', appearing); // .instant: only opacity has a transition
bubble.style.transform = ...;                  // jump to the new place...
if (appearing) {
  void bubble.offsetWidth;                     // ...make the browser apply that NOW
  bubble.classList.remove('instant');          // transitions back on
}
bubble.classList.add('shown');                 // fade in
```

`void bubble.offsetWidth` is the interesting line. Browsers batch style
changes and apply them all later, at once. Without this line, "turn
transitions off, move, turn them back on" would be applied together, as if
transitions had never been off, and the bubble would fly in anyway.
Reading a layout value such as `offsetWidth` forces the browser to apply
the pending changes immediately (a "forced reflow"). This is a well-known
trick for "change this without animating".

## 6. Keeping it in the right place

Several things can change where the bubble should be:

| What happens                                              | What handles it                                 |
| --------------------------------------------------------- | ----------------------------------------------- |
| mouse enters an item                                      | `(mouseenter)="hoverItem(...)"`                 |
| mouse leaves the menu                                     | `(mouseleave)="hoverItem(null)"` on the `<nav>` |
| you click an item → page changes → `active` moves         | `afterEveryRender(...)`                         |
| the Voks badge appears or disappears → item width changes | `afterEveryRender(...)`                         |
| the Marhey font finishes loading → all widths change      | `document.fonts.ready.then(...)`                |
| the window is resized                                     | `@HostListener('window:resize')`                |

`afterEveryRender` is an Angular function: the callback runs after Angular
has updated the page. That is the moment `routerLinkActive` has already
moved the `active` class, so measuring then gives the correct answer.

Because `placeBubble()` runs this often, it returns immediately when
nothing has changed:

```ts
if (target === this.bubbleTarget && box.join() === this.bubbleBox) return;
```

This also stops the wobble from replaying on every render.

## 7. The soap look

`.menu-bubble-skin` is the old highlight box (white border, soft shadow,
rounded corners). Two background layers are added on top to give it a
soap-film shimmer:

```scss
background:
  radial-gradient(120% 100% at 28% 12%, rgba(255, 255, 255, 0.9), ... transparent 75%),
  // a highlight top-left
  linear-gradient(115deg, pink, light blue, mint, pale yellow, pink); // the rainbow film
background-size:
  100% 100%,
  300% 100%;
animation: soap-swirl 7s ease-in-out infinite alternate;
```

- A CSS `background` can hold **several layers**, separated by commas. The
  first one is drawn on top.
- The radial gradient is the shiny spot where light hits a real bubble.
- The rainbow layer is **3× wider** than the bubble (`300%`). The
  `soap-swirl` animation slowly slides it from one end to the other and
  back (`alternate`), so the colours seem to drift across the surface, the
  way they do on a real soap bubble.
- All colours are very transparent (alpha ≈ 0.2), so the effect stays
  subtle.
- `inset 0 0 8px ...` in `box-shadow` adds a faint bluish inner glow at
  the rim.

## 8. Being kind: "reduce motion"

Some people get dizzy or distracted by motion on screen, and turn on
"reduce motion" in their operating system. CSS and JavaScript can both
check for it:

```scss
@media (prefers-reduced-motion: reduce) {
  .menu-bubble,
  .menu-bubble.instant {
    transition: opacity 0.2s ease;
  }
  .menu-bubble-skin {
    animation: none;
  }
}
```

```ts
if (moved && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  /* wobble */
}
```

For those people, the bubble simply fades between items.

---

## Things to try

- **Bouncier:** raise the `1.4` and `1.5` in the `cubic-bezier`s (try 1.8).
- **Floatier, slower:** increase `0.55s` and `0.65s`.
- **More stretch:** make the gap between the two durations bigger
  (e.g. 0.45s vs 0.75s).
- **Wilder wobble:** push the `scale(...)` values further from 1, or make
  `duration` longer.
- **Stronger shimmer:** raise the alpha (the `0.2`) in the rainbow layer.

Change one number at a time, save, and watch what happens. That's the
best way to get a feel for animation.
