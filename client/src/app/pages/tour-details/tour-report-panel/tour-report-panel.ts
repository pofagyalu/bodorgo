import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  afterNextRender,
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
import Quill from 'quill';
import { firstValueFrom } from 'rxjs';
import { ReportFacts, TourImage, TourReport, TourService } from '../../../services/tour';
import { NotificationsService } from '../../../notifications/notifications.service';
import { errorMessage } from '../../../shared/errors';

const SAVE_DELAY_MS = 1500;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Admin-only "Beszámoló": what happened on the tour, day by day - one
// small rich-text editor (Quill) per day, the PDF's header lines, and one
// of the tour's album photos for its top. Saved as it's typed, for as
// many days as it takes; Kész makes it the one the tour's attendees
// download as a PDF (with the elnök and the wax seal at the end);
// Visszanyitás makes it editable again. The server does the rest (see
// tourReportController.js).
@Component({
  selector: 'app-tour-report-panel',
  imports: [FormsModule, MatIconModule, DatePipe],
  templateUrl: './tour-report-panel.html',
  styleUrl: './tour-report-panel.scss',
})
export class TourReportPanel implements OnInit, OnDestroy {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  private injector = inject(Injector);

  tourId = input.required<string>();
  // The tour's album - one of them can go on the PDF.
  images = input<TourImage[]>([]);
  closed = output<void>();
  // Kész or Visszanyitás - the tour page updates its download card.
  changed = output<void>();

  private dayEls = viewChildren<ElementRef<HTMLDivElement>>('dayEditor');
  private quills: Quill[] = [];

  loading = signal(true);
  report = signal<TourReport | null>(null);
  facts = signal<ReportFacts>({ place: '', dates: '', headcount: '' });
  photo = signal<string | null>(null);
  // Which days have any text - for Kész, and the day headings' dots.
  filledDays = signal<boolean[]>([]);

  saveState = signal<SaveState>('idle');
  savedAt = signal<Date | null>(null);
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving?: Promise<void>;

  confirming = signal(false);
  busy = signal(false);

  isFinal = computed(() => this.report()?.status === 'final');
  hasText = computed(() => this.filledDays().some(Boolean));

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
        // The day editors exist once this has rendered.
        afterNextRender(() => this.createEditors(report), { injector: this.injector });
      },
      error: (err) => {
        this.notifications.addError(errorMessage(err, 'A beszámoló betöltése nem sikerült.'));
        this.loading.set(false);
      },
    });
  }

  private createEditors(report: TourReport) {
    this.quills = this.dayEls().map((el, i) => {
      const quill = new Quill(el.nativeElement, {
        theme: 'snow',
        placeholder:
          i === 0
            ? 'Mi történt ezen a napon? (pl. megérkezés, esti gitározás…) - felsorolás, alpontok a gombokkal vagy Tab-bal'
            : 'Mi történt ezen a napon?',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline'],
            [{ list: 'bullet' }, { list: 'ordered' }],
            [{ indent: '-1' }, { indent: '+1' }],
            ['clean'],
          ],
        },
      });
      const content = report.days[i];
      if (content) quill.setContents(content as never, 'silent');
      quill.on('text-change', (_delta, _old, source) => {
        this.updateFilled();
        if (source === 'user') this.scheduleSave();
      });
      return quill;
    });
    this.updateFilled();
    this.applyLock();
  }

  private updateFilled() {
    this.filledDays.set(this.quills.map((q) => q.getText().trim().length > 0));
  }

  // A finished beszámoló is read-only until it's reopened.
  private applyLock() {
    for (const q of this.quills) q.enable(!this.isFinal());
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
  private scheduleSave() {
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
        days: this.quills.map((q) => (q.getText().trim() ? q.getContents() : null)),
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
    if (this.busy() || !this.hasText()) return;
    this.confirming.set(true);
  }

  async finish() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.flush();
      const res = await firstValueFrom(this.tourService.finishReport(this.tourId()));
      this.report.set(res.data.report);
      this.applyLock();
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
      this.applyLock();
      this.changed.emit();
    } catch (err) {
      this.notifications.addError(errorMessage(err, 'Nem sikerült visszanyitni.'));
    } finally {
      this.busy.set(false);
    }
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
