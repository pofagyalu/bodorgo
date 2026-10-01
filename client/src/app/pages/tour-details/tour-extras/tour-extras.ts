import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ExtraDocument, Tour, TourImage, TourService } from '../../../services/tour';
import { AuthService } from '../../../auth/auth.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { TourMailPanel } from '../tour-mail-panel/tour-mail-panel';
import { TourReportPanel } from '../tour-report-panel/tour-report-panel';

// A tour's Extrák (tour-details): the always-present Programfüzet cards
// (download, e-mail to myself), the finished beszámoló for the tour's
// attendees, the admin's "Levél a résztvevőknek" and "Beszámoló írása"
// (their dialogs live here too), and up to 5 admin-uploaded documents
// (map, places to visit...) - uploaded and deleted here, then handed back
// to the tour page (documentsChanged), which owns the tour.
@Component({
  selector: 'app-tour-extras',
  imports: [FormsModule, MatIconModule, TourMailPanel, TourReportPanel],
  templateUrl: './tour-extras.html',
  styleUrl: './tour-extras.scss',
})
export class TourExtras {
  private tourService = inject(TourService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);
  private auth = inject(AuthService);

  tour = input.required<Tour>();
  // The tour's album - the beszámoló can take one of its photos.
  images = input<TourImage[]>([]);
  documentsChanged = output<ExtraDocument[]>();

  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  constructor() {
    // Once the tour and the login are both known - the beszámoló is only
    // ever for a logged-in viewer.
    effect(() => {
      const id = this.tour()._id;
      if (!this.auth.isLoggedIn() || this.reportRequestedFor === id) return;
      this.reportRequestedFor = id;
      this.loadReportInfo();
    });
  }

  // --- Programfüzet ---

  pdfUrl(): string {
    return this.tourService.pdfUrl(this.tour()._id);
  }

  // To the logged-in user's own address.
  emailingPdf = signal(false);

  sendPdfByEmail() {
    if (this.emailingPdf()) return;
    this.emailingPdf.set(true);
    this.tourService.emailPdf(this.tour()._id).subscribe({
      next: (res) => {
        this.emailingPdf.set(false);
        this.notifications.addSuccess(`Programfüzet elküldve: ${res.data.sentTo}`);
      },
      error: (err) => {
        this.emailingPdf.set(false);
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a küldés során.');
      },
    });
  }

  // --- Beszámoló (see tour-report-panel, server tourReportController.js) ---

  // Whether this viewer can download the finished beszámoló (an attendee,
  // or an admin).
  reportDownload = signal<{ publishedAt: string } | null>(null);
  private reportRequestedFor: string | null = null;
  // Admin-only: the writing dialog.
  showReportPanel = signal(false);

  loadReportInfo() {
    this.tourService.getReport(this.tour()._id).subscribe({
      next: (res) =>
        this.reportDownload.set(
          res.data.canDownload && res.data.publishedAt
            ? { publishedAt: res.data.publishedAt }
            : null,
        ),
      error: () => this.reportDownload.set(null),
    });
  }

  reportPdfUrl(): string {
    return this.tourService.reportPdfUrl(this.tour()._id);
  }

  // Admin-only: the "Levél a résztvevőknek" dialog (see tour-mail-panel).
  showMailPanel = signal(false);

  // --- Uploaded documents (admin: up to 5) ---

  addingDocument = signal(false);
  uploadingDocument = signal(false);
  deletingDocument = signal(false);
  newDocumentTitle = '';
  private selectedDocumentFile: File | null = null;

  documentUrl(documentId: string): string {
    return this.tourService.documentUrl(documentId);
  }

  startAddDocument() {
    this.newDocumentTitle = '';
    this.selectedDocumentFile = null;
    this.addingDocument.set(true);
  }

  cancelAddDocument() {
    this.addingDocument.set(false);
  }

  onDocumentFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedDocumentFile = input.files?.[0] ?? null;
  }

  saveNewDocument() {
    const title = this.newDocumentTitle.trim();
    if (!title) {
      this.notifications.addError('A dokumentumnak kell legyen címe.');
      return;
    }
    if (!this.selectedDocumentFile) {
      this.notifications.addError('Válassz ki egy PDF, JPG vagy PNG fájlt.');
      return;
    }

    this.uploadingDocument.set(true);
    this.tourService.uploadDocument(this.tour()._id, title, this.selectedDocumentFile).subscribe({
      next: (res) => {
        this.uploadingDocument.set(false);
        this.addingDocument.set(false);
        const d = res.data.document;
        this.documentsChanged.emit([
          ...(this.tour().extraDocuments ?? []),
          { _id: d._id, title: d.name, filename: d.filename, mimeType: d.mimeType },
        ]);
        this.notifications.addSuccess('Dokumentum feltöltve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a feltöltés során.');
        this.uploadingDocument.set(false);
      },
    });
  }

  // Confirmed in the app's shared dialog (shared/confirm-dialog).
  async askDeleteDocument(doc: ExtraDocument, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.deletingDocument()) return;
    const ok = await this.confirm.ask({
      message: `Biztos, hogy törölni akarod a "${doc.title}" dokumentumot?`,
    });
    if (!ok) return;

    this.deletingDocument.set(true);
    this.tourService.deleteDocument(doc._id).subscribe({
      next: () => {
        this.documentsChanged.emit(
          (this.tour().extraDocuments ?? []).filter((d) => d._id !== doc._id),
        );
        this.deletingDocument.set(false);
        this.notifications.addSuccess('Dokumentum törölve');
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Hiba történt a törlés során.');
        this.deletingDocument.set(false);
      },
    });
  }
}
