import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface ClubDocument {
  _id: string;
  name: string;
  filename: string;
  category: string;
  year?: number;
  uploadedBy: string;
  createdAt: string;
}

// Matches server/src/models/clubDocumentModel.js's DOCUMENT_CATEGORIES
// exactly - kept here too since the client picks the upload form's
// category dropdown before the server ever validates it.
export const DOCUMENT_CATEGORIES = ['Alapdokumentumok', 'Éves hivatalos dokumentumok', 'Egyéb'];

interface DocumentsResponse {
  status: string;
  data: { documents: ClubDocument[] };
}

interface DocumentResponse {
  status: string;
  data: { document: ClubDocument };
}

@Injectable({ providedIn: 'root' })
export class ClubDocumentService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/documents`;

  getDocuments() {
    return this.http.get<DocumentsResponse>(this.apiUrl);
  }

  upload(name: string, category: string, year: number | null, file: File) {
    const form = new FormData();
    form.append('name', name);
    form.append('category', category);
    if (year != null) form.append('year', String(year));
    form.append('file', file);
    return this.http.post<DocumentResponse>(this.apiUrl, form);
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // Viewing/downloading is a plain cross-origin GET, not an HttpClient
  // call - the browser navigates directly (session cookie rides along
  // automatically), same convention as the original homepage document
  // links and payment.ts's receiptUrl.
  fileUrl(filename: string, download = false): string {
    return `${this.apiUrl}/${filename}${download ? '?download=1' : ''}`;
  }
}
