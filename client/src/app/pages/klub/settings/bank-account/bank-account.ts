import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { FreshLoginService } from '../../../../auth/fresh-login.service';
import { BarionWallet, BarionWalletKey, SettingsService } from '../../../../services/settings';

// One bank account on the Kiutalási számlaadatok card (Beállítások →
// Fizetések) - Tagdíjak or Előlegek: where its money is paid out to,
// whichever gateway it came through (editable; every change is e-mailed to
// all admins), and the Barion wallet e-mail its payments land at.
@Component({
  selector: 'app-bank-account',
  imports: [FormsModule, MatIconModule],
  templateUrl: './bank-account.html',
  styleUrl: '../barion-withdraw/barion-withdraw.scss',
})
export class BankAccount implements OnInit {
  private settingsService = inject(SettingsService);
  private freshLogin = inject(FreshLoginService);

  wallet = input.required<BarionWalletKey>();
  title = computed(() => (this.wallet() === 'membership' ? 'Tagdíjak' : 'Előlegek'));
  // A new account was saved - the Barion payout row checks again whether
  // it can pay out.
  saved = output<BarionWallet>();

  account = signal<BarionWallet | null>(null);
  editing = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  form = { payeeEmail: '', withdrawName: '', withdrawIban: '' };

  ngOnInit() {
    this.settingsService.getBarionSettings().subscribe({
      next: (res) => this.account.set(res.data[this.wallet()]),
      error: (err) => console.error('Failed to load Barion settings', err),
    });
  }

  async startEdit() {
    // Where a payout goes: only for someone who identified themselves in
    // the last minutes - asked before the form opens, so nothing typed is
    // lost on the way to the provider.
    if (!(await this.freshLogin.ensure('Kiutalási számla módosítása'))) return;
    const a = this.account();
    this.form = {
      payeeEmail: a?.payeeEmail ?? '',
      withdrawName: a?.withdrawName ?? '',
      withdrawIban: a?.withdrawIban ?? '',
    };
    this.formError.set(null);
    this.editing.set(true);
  }

  save() {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set(null);
    this.settingsService.updateBarionWallet(this.wallet(), this.form).subscribe({
      next: (res) => {
        this.account.set(res.data);
        this.saving.set(false);
        this.editing.set(false);
        this.saved.emit(res.data);
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.message ?? 'A mentés nem sikerült.');
      },
    });
  }
}
