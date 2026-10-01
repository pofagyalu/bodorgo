import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { OnSitePayment } from '../../../../services/tour';
import { PayMethodIcon, PayMethodKey } from '../../../../shared/pay-method-icon/pay-method-icon';

const METHODS: { key: PayMethodKey; label: string }[] = [
  { key: 'cash', label: 'Készpénz' },
  { key: 'card', label: 'Bankkártya' },
  { key: 'szep', label: 'SZÉP kártya' },
];

interface Position {
  left: number;
  top: number | null;
  bottom: number | null;
  below: boolean;
}

const BUBBLE_WIDTH_REM = 17;
const GAP_PX = 8;

// The attendee list's Fizetendő header (attendee-list): the label, and -
// when the tour has Fizetési módok (set on the tour edit form) - a small
// raised symbol after it, like the % after Előleg. Pointing at that (or
// tapping, on a phone) pops a bubble above it:
// how the rest can be paid at the house - cash, card, SZÉP kártya. The bubble is
// position: fixed at the header, so the table's scrolling box can't clip it.
@Component({
  selector: 'app-pay-methods',
  imports: [MatIconModule, PayMethodIcon],
  templateUrl: './pay-methods.html',
  styleUrl: './pay-methods.scss',
})
export class PayMethods implements OnDestroy {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  label = input('Fizetendő');
  payment = input<OnSitePayment | null | undefined>(null);

  // The ticked methods, in their order.
  methods = computed(() => {
    const p = this.payment();
    return p ? METHODS.filter((m) => p[m.key]) : [];
  });
  hasInfo = computed(() => this.methods().length > 0);

  open = signal(false);
  // Where it sits (px, fixed): above the header (by its bottom edge), or
  // below it when there's no room above.
  pos = signal<Position>({ left: 0, top: null, bottom: null, below: false });
  private closeTimer?: ReturnType<typeof setTimeout>;

  private place(): Position {
    const rect = this.host.nativeElement.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const width = Math.min(BUBBLE_WIDTH_REM * rem, window.innerWidth - 2 * GAP_PX);
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, GAP_PX),
      window.innerWidth - width - GAP_PX,
    );
    const below = rect.top < 12 * rem;
    return below
      ? { left, top: rect.bottom + GAP_PX, bottom: null, below }
      : { left, top: null, bottom: window.innerHeight - rect.top + GAP_PX, below };
  }

  // Mouse: opens on entering, closes a moment after leaving (so the
  // pointer can cross over to the bubble).
  onEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !this.hasInfo()) return;
    clearTimeout(this.closeTimer);
    this.show();
  }

  onLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    this.closeTimer = setTimeout(() => this.open.set(false), 120);
  }

  // Touch (and keyboard): a tap toggles it.
  toggle() {
    if (!this.hasInfo()) return;
    if (this.open()) this.open.set(false);
    else this.show();
  }

  private show() {
    this.pos.set(this.place());
    this.open.set(true);
  }

  // A tap anywhere else closes it; so does any scroll or resize, which
  // would leave it floating away from the header.
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointer(event: PointerEvent) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('window:resize')
  close() {
    this.open.set(false);
  }

  // The page scrolls in its own box (.page-body), not the window - so any
  // scroll, anywhere (capture).
  private onAnyScroll = () => this.close();

  constructor() {
    document.addEventListener('scroll', this.onAnyScroll, { capture: true, passive: true });
  }

  ngOnDestroy() {
    clearTimeout(this.closeTimer);
    document.removeEventListener('scroll', this.onAnyScroll, true);
  }
}
