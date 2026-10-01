import { Component, input, model } from '@angular/core';

// An I/N (igen/nem) switch: green with I when on, red with N when off.
// With a `label` it reads as "[switch] label", and the label switches it
// too; without one, give it a title (a tooltip) where it's used.
@Component({
  selector: 'app-toggle-switch',
  templateUrl: './toggle-switch.html',
  styleUrl: './toggle-switch.scss',
})
export class ToggleSwitch {
  checked = model(false);
  label = input('');
}
