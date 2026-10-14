import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FreshLoginService } from '../../../../auth/fresh-login.service';
import { PeriodOption, PeriodPicker } from '../../../../components/period-picker/period-picker';
import { LogFileInfo, SettingsService } from '../../../../services/settings';
import { ToggleSwitch } from '../../../../shared/toggle-switch/toggle-switch';

const STEP = 500; // lines loaded at a time
const MAX_LINES = 5000; // the server's limit; the rest only by download

// One log entry: its first line ("[2026-10-14 06:31:19] error: ..."), and
// the lines after it that belong to it (a stack trace).
export interface LogEntry {
  text: string;
  error: boolean;
}

// The lines, grouped into entries, newest first - a line that doesn't
// start with a [date] goes on the entry before it.
export function toEntries(lines: string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const last = entries.at(-1);
    if (last && !/^\[\d{4}-\d{2}-\d{2} /.test(line)) {
      last.text += `\n${line}`;
    } else {
      entries.push({ text: line, error: /^\[[^\]]*\] error:/.test(line) });
    }
  }
  return entries.reverse();
}

// "2026-10-14" -> "okt. 14."
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' }).format(
    new Date(y, m - 1, d),
  );
}

// Klub → Napló → Naplófájlok (the role manager's alone): the server's own
// log files - a day's app log (everything) or error log (errors only),
// newest entry first, and the file to download. Asks to re-identify first:
// they hold e-mail and IP addresses (server logFilesController.js).
@Component({
  selector: 'app-log-files',
  imports: [MatIconModule, PeriodPicker, ToggleSwitch],
  templateUrl: './log-files.html',
  styleUrl: './log-files.scss',
})
export class LogFiles implements OnInit {
  private settingsService = inject(SettingsService);
  private freshLogin = inject(FreshLoginService);

  files = signal<LogFileInfo[] | null>(null);
  needsLogin = signal(false);
  failed = signal(false);
  loading = signal(false);

  day = signal('');
  errorsOnly = signal(false);

  // Every day there is a file of, newest first.
  dayOptions = computed<PeriodOption[]>(() => {
    const dates = [...new Set((this.files() ?? []).map((f) => f.date))];
    return dates.map((date) => ({ value: date, label: dayLabel(date) }));
  });

  // The chosen day's file of the chosen kind (the first of a day split in
  // more than one).
  file = computed(() => {
    const kind = this.errorsOnly() ? 'error' : 'app';
    return (this.files() ?? []).find((f) => f.date === this.day() && f.kind === kind) ?? null;
  });

  lines = signal<string[]>([]);
  totalLines = signal(0);
  entries = computed(() => toEntries(this.lines()));
  canLoadMore = computed(
    () => this.lines().length < this.totalLines() && this.lines().length < MAX_LINES,
  );
  // "Az utolsó 500 sor (összesen 1200), a legújabb felül."
  countNote = computed(() => {
    const shown = this.lines().length;
    const total = this.totalLines();
    const which = shown < total ? `Az utolsó ${shown} sor (összesen ${total})` : `${total} sor`;
    return `${which}, a legújabb felül.`;
  });
  downloadUrl = computed(() => {
    const file = this.file();
    return file ? this.settingsService.logFileDownloadUrl(file.name) : null;
  });

  ngOnInit() {
    void this.start();
  }

  async start() {
    this.needsLogin.set(false);
    if (!(await this.freshLogin.ensure('Naplófájlok megnézése'))) {
      this.needsLogin.set(true);
      return;
    }
    this.failed.set(false);
    this.settingsService.getLogFiles().subscribe({
      next: (res) => {
        this.files.set(res.data.files);
        this.day.set(res.data.files[0]?.date ?? '');
        this.loadLines(STEP);
      },
      error: (err) => this.onError(err),
    });
  }

  pickDay(date: string) {
    this.day.set(date);
    this.loadLines(STEP);
  }

  setErrorsOnly(on: boolean) {
    this.errorsOnly.set(on);
    this.loadLines(STEP);
  }

  more() {
    this.loadLines(Math.min(MAX_LINES, this.lines().length + STEP));
  }

  private loadLines(count: number) {
    const file = this.file();
    this.lines.set(count > STEP ? this.lines() : []);
    this.totalLines.set(count > STEP ? this.totalLines() : 0);
    if (!file) return;
    this.loading.set(true);
    this.settingsService.getLogFile(file.name, count).subscribe({
      next: (res) => {
        // A late answer for a file no longer chosen is dropped.
        if (this.file()?.name !== res.data.name) return;
        this.lines.set(res.data.lines);
        this.totalLines.set(res.data.totalLines);
        this.loading.set(false);
      },
      error: (err) => this.onError(err),
    });
  }

  private onError(err: { error?: { code?: string } }) {
    this.loading.set(false);
    // The 10 minutes ran out meanwhile: asked again with the button.
    if (err?.error?.code === 'fresh-login-required') this.needsLogin.set(true);
    else this.failed.set(true);
  }
}
