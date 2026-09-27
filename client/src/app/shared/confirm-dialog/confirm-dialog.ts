import { Component, HostListener, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';

// The dialog for ConfirmService.ask() - the same look as the tour page's
// own delete confirmations (a small white card, Mégse in green, the
// action in red). Esc or a click beside it counts as Mégse.
@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  confirm = inject(ConfirmService);

  @HostListener('document:keydown.escape')
  cancel() {
    this.confirm.answer(false);
  }
}
