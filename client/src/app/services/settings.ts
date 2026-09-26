import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

// The yearly membership fee, by the year each amount takes effect (see
// server/src/utils/clubSettings.js) - set on Klub → Beállítások.
export interface MembershipFee {
  fromYear: number;
  amount: number;
}

export interface MembershipFeesResponse {
  status: string;
  data: {
    fees: MembershipFee[];
    foundingYear: number;
    // Admin-only: years somebody already paid for (their fee can't
    // change), and who changed the fees when.
    paidYears?: number[];
    history?: { at: string; byName: string; change: string }[];
  };
}

// The fee for one year: the latest row that has started by then - same
// rule as the server's feeForYear.
export function feeForYear(fees: MembershipFee[], year: number): number | null {
  const row = [...fees].filter((f) => f.fromYear <= year).sort((a, b) => b.fromYear - a.fromYear)[0];
  return row ? row.amount : null;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/settings`;

  getMembershipFees() {
    return this.http.get<MembershipFeesResponse>(`${this.apiUrl}/membership-fees`);
  }

  // Admin-only - replaces the whole table.
  updateMembershipFees(fees: MembershipFee[]) {
    return this.http.put<{ status: string; data: { fees: MembershipFee[] } }>(`${this.apiUrl}/membership-fees`, {
      fees,
    });
  }
}
