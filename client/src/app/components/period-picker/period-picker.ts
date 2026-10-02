import { Component, computed, HostListener, input, model, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export interface PeriodOption {
  value: string;
  label: string;
  // How many there are of it (e.g. a category's videos) - shown beside
  // the label, on the button and in the panel.
  count?: number;
}

// A choice of one of several (periods/years, categories): a compact button
// saying the chosen one, which opens a small panel with every choice at
// once - the wide ones (`wideValues`, e.g. "Összes") across the top, the
// rest four to a row, in the order given. One tap picks and closes; a click
// elsewhere or Esc closes without choosing. The same look as the Táborok
// page's year picker (pages/tours), which is built into its filter bar.
//
// `list`: for long labels (Média's categories) - one choice per row, its
// count at the row's end; the button cuts a long label with "…".
//
// Colors and the panel's side come from CSS variables on the host:
// --period-picker-accent, --period-picker-left / --period-picker-right.
@Component({
  selector: 'app-period-picker',
  imports: [MatIconModule],
  templateUrl: './period-picker.html',
  styleUrl: './period-picker.scss',
  host: { '[class.list]': 'list()' },
})
export class PeriodPicker {
  // What it chooses, for the tooltip and screen readers (e.g. "Időszak").
  label = input.required<string>();
  options = input.required<PeriodOption[]>();
  value = model.required<string>();
  // Options shown across the panel's whole width, on top.
  wideValues = input<string[]>(['all']);
  list = input(false);

  open = signal(false);

  current = computed(() => this.options().find((o) => o.value === this.value()));
  wideOptions = computed(() => this.options().filter((o) => this.wideValues().includes(o.value)));
  gridOptions = computed(() => this.options().filter((o) => !this.wideValues().includes(o.value)));

  toggle(event: Event) {
    // Not the document's click below, which would close it right away.
    event.stopPropagation();
    this.open.update((open) => !open);
  }

  pick(value: string) {
    this.open.set(false);
    this.value.set(value);
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  close() {
    this.open.set(false);
  }
}
