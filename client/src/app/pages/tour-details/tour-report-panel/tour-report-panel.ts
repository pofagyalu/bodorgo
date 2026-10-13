import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ReportFacts, TourImage, TourReport, TourService } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';
import { errorMessage } from '../../../shared/errors';
import { ReportDayEditor } from '../report-day-editor/report-day-editor';

const SAVE_DELAY_MS = 1500;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Admin-only "Beszámoló": what happened on the tour, day by day - one
// small rich-text editor per day (report-day-editor, which also links
// words to attendees and hikes), the PDF's header lines, and one of the
// tour's album photos for its top. Saved as it's typed, for as
// many days as it takes; Kész makes it the one the tour's attendees
// download as a PDF (with the elnök and the wax seal at the end);
// Visszanyitás makes it editable again. The server does the rest (see
// tourReportController.js).
@Component({
  selector: 'app-tour-report-panel',
  imports: [FormsModule, MatIconModule, DatePipe, ReportDayEditor],
  templateUrl: './tour-report-panel.html',
  styleUrl: './tour-report-panel.scss',
})
export class TourReportPanel implements OnInit, OnDestroy {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);

  tourId = input.required<string>();
  // The tour's album - one of them can go on the PDF.
  images = input<TourImage[]>([]);
  closed = output<void>();
  // Kész or Visszanyitás - the tour page updates its download card.
  changed = output<void>();

  // One per day of the tour - each keeps its own text.
  private dayEditors = viewChildren(ReportDayEditor);

  loading = signal(true);
  report = signal<TourReport | null>(null);
  facts = signal<ReportFacts>({ place: '', dates: '', headcount: '' });
  photo = signal<string | null>(null);
  // Which days have any text - for Kész, and the day headings' dots.
  filledDays = computed(() => this.dayEditors().map((day) => day.filled()));

  saveState = signal<SaveState>('idle');
  savedAt = signal<Date | null>(null);
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving?: Promise<void>;

  confirming = signal(false);
  busy = signal(false);

  isFinal = computed(() => this.report()?.status === 'final');
  hasText = computed(() => this.filledDays().some(Boolean));
  // A beszámoló says what happened - Kész only once the tour is over.
  canFinish = computed(() => this.hasText() && !!this.report()?.canFinish);

  readonly factFields: { key: keyof ReportFacts; label: string }[] = [
    { key: 'place', label: 'Helyszín' },
    { key: 'dates', label: 'Időpont' },
    { key: 'headcount', label: 'Létszám' },
  ];

  // The page behind the dialog stays put while it's open (restored in
  // ngOnDestroy) - it scrolls in app.component's .page-body, not the window.
  private pageBody = document.querySelector<HTMLElement>('.page-body');
  private previousBodyOverflow = '';

  ngOnInit() {
    if (this.pageBody) {
      this.previousBodyOverflow = this.pageBody.style.overflow;
      this.pageBody.style.overflow = 'hidden';
    }
    this.tourService.getReport(this.tourId()).subscribe({
      next: (res) => {
        const report = res.data.report;
        if (!report) {
          this.loading.set(false);
          return;
        }
        this.report.set(report);
        this.facts.set({ ...report.facts });
        this.photo.set(report.photo);
        if (report.updatedAt) this.savedAt.set(new Date(report.updatedAt));
        this.loading.set(false);
      },
      error: (err) => {
        this.notifications.addError(errorMessage(err, 'A beszámoló betöltése nem sikerült.'));
        this.loading.set(false);
      },
    });
  }

  // --- The header lines and the photo ---

  setFact(key: keyof ReportFacts, value: string) {
    this.facts.update((f) => ({ ...f, [key]: value }));
    this.scheduleSave();
  }

  pickPhoto(filename: string | null) {
    if (this.isFinal()) return;
    this.photo.set(this.photo() === filename ? null : filename);
    this.scheduleSave();
  }

  thumbUrl(filename: string) {
    return this.tourService.tourImageThumbUrl(this.tourId(), filename);
  }

  // --- Saving ---

  // Saved about 1.5 s after the last change.
  scheduleSave() {
    if (this.isFinal()) return;
    this.saveState.set('pending');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), SAVE_DELAY_MS);
  }

  private async saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.saving) await this.saving;
    this.saveState.set('saving');
    this.saving = firstValueFrom(
      this.tourService.saveReport(this.tourId(), {
        days: this.dayEditors().map((day) => day.contents()),
        facts: this.facts(),
        photo: this.photo(),
      }),
    )
      .then((res) => {
        this.savedAt.set(new Date(res.data.updatedAt));
        this.saveState.set('saved');
      })
      .catch(() => this.saveState.set('error'))
      .finally(() => (this.saving = undefined));
    return this.saving;
  }

  private async flush() {
    if (this.saveState() === 'pending' || this.saveState() === 'error') await this.saveNow();
    else if (this.saving) await this.saving;
  }

  // --- Előnézet, Kész, Visszanyitás ---

  // The PDF as it is now (PISZKOZAT across it) - downloaded, the page stays.
  async preview() {
    await this.flush();
    window.location.href = this.tourService.reportPdfUrl(this.tourId(), !this.isFinal());
  }

  askFinish() {
    if (this.busy() || !this.canFinish()) return;
    this.confirming.set(true);
  }

  async finish() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.flush();
      const res = await firstValueFrom(this.tourService.finishReport(this.tourId()));
      this.report.set(res.data.report);
      this.confirming.set(false);
      this.saveState.set('idle');
      this.notifications.addSuccess('A beszámoló kész - a résztvevők letölthetik.');
      this.changed.emit();
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'Nem sikerült késznek jelölni.'));
    } finally {
      this.busy.set(false);
    }
  }

  async reopen() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const res = await firstValueFrom(this.tourService.reopenReport(this.tourId()));
      this.report.set(res.data.report);
      this.changed.emit();
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'Nem sikerült visszanyitni.'));
    } finally {
      this.busy.set(false);
    }
  }

  // A click on the dark area around the window closes it - but only one
  // that began there too: a text selection dragged out of the window and
  // let go outside it ends in a click on that area as well.
  pressedOutside = false;

  backdropClick(event: MouseEvent) {
    const outside = this.pressedOutside && event.target === event.currentTarget;
    this.pressedOutside = false;
    if (outside) void this.close();
  }

  async close() {
    if (this.busy()) return;
    await this.flush();
    this.closed.emit();
  }

  ngOnDestroy() {
    clearTimeout(this.saveTimer);
    if (this.pageBody) this.pageBody.style.overflow = this.previousBodyOverflow;
  }
}
