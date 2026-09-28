import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../auth/auth.service';
import {
  ClubDocumentService,
  ClubDocument,
  DOCUMENT_CATEGORIES,
} from '../../../services/club-document';
import { NotificationsService } from '../../../notifications/notifications.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';

@Component({
  selector: 'app-klub-documents',
  imports: [MatIconModule],
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
})
export class Documents implements OnInit {
  private documentService = inject(ClubDocumentService);
  private auth = inject(AuthService);
  private notifications = inject(NotificationsService);
  private confirm = inject(ConfirmService);

  readonly categories = DOCUMENT_CATEGORIES;
  readonly currentYear = new Date().getFullYear();

  isAdmin = computed(() => this.auth.user()?.role === 'admin');

  documents = signal<ClubDocument[]>([]);
  loading = signal(true);

  // One group per fixed category, in that order, skipping any category
  // that currently has nothing in it rather than showing an empty panel.
  groupedDocuments = computed(() => {
    const docs = this.documents();
    return this.categories
      .map((category) => ({
        category,
        documents: docs.filter((d) => d.category === category),
      }))
      .filter((g) => g.documents.length > 0);
  });

  showUpload = signal(false);
  uploading = signal(false);
  uploadError = signal<string | null>(null);

  formName = signal('');
  formCategory = signal<string>(DOCUMENT_CATEGORIES[0]);
  formYear = signal('');
  formFile = signal<File | null>(null);

  deletingId = signal<string | null>(null);

  ngOnInit() {
    this.loadDocuments();
  }

  private loadDocuments() {
    this.loading.set(true);
    this.documentService.getDocuments().subscribe({
      next: (res) => {
        this.documents.set(res.data.documents);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load club documents', err);
        this.loading.set(false);
      },
    });
  }

  fileUrl(filename: string, download = false): string {
    return this.documentService.fileUrl(filename, download);
  }

  previewUrl(doc: ClubDocument): string {
    return this.documentService.previewUrl(doc._id);
  }

  // A photographed/screenshotted paper document (see uploadMiddleware's
  // fileFilter) gets its own icon rather than the PDF one - same mat-icon
  // names as tour-details.html's own extra-doc-card for the same split.
  icon(doc: ClubDocument): string {
    return /\.(jpe?g|png)$/i.test(doc.filename) ? 'image' : 'picture_as_pdf';
  }

  openUpload() {
    this.formName.set('');
    this.formCategory.set(DOCUMENT_CATEGORIES[0]);
    this.formYear.set('');
    this.formFile.set(null);
    this.uploadError.set(null);
    this.showUpload.set(true);
  }

  closeUpload() {
    if (this.uploading()) return;
    this.showUpload.set(false);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.formFile.set(input.files?.[0] ?? null);
  }

  onSubmit(event: Event) {
    // Plain native (submit), not (ngSubmit) - see finance.ts's identical
    // fix: (ngSubmit) is an NgForm/FormsModule output and silently never
    // fires without it.
    event.preventDefault();
    this.submitUpload();
  }

  private submitUpload() {
    const name = this.formName().trim();
    const file = this.formFile();
    if (!name || !file) {
      this.uploadError.set('Adj meg egy nevet és válassz ki egy PDF, JPG vagy PNG fájlt.');
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);
    const year = this.formYear().trim() ? Number(this.formYear()) : null;

    this.documentService.upload(name, this.formCategory(), year, file).subscribe({
      next: (res) => {
        this.documents.update((docs) => [...docs, res.data.document]);
        this.uploading.set(false);
        this.showUpload.set(false);
      },
      error: (err) => {
        this.uploadError.set(err?.error?.message ?? 'Nem sikerült feltölteni a dokumentumot.');
        this.uploading.set(false);
      },
    });
  }

  async remove(doc: ClubDocument) {
    if (this.deletingId()) return;
    if (
      !(await this.confirm.ask({ message: `Biztosan törlöd ezt a dokumentumot: "${doc.name}"?` }))
    )
      return;

    this.deletingId.set(doc._id);
    this.documentService.delete(doc._id).subscribe({
      next: () => {
        this.documents.update((docs) => docs.filter((d) => d._id !== doc._id));
        this.deletingId.set(null);
      },
      error: (err) => {
        this.notifications.addError(err?.error?.message ?? 'Nem sikerült törölni a dokumentumot.');
        this.deletingId.set(null);
      },
    });
  }
}
