import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type TransactionType = 'income' | 'expense';
export type TransactionCurrency = 'HUF' | 'EUR';

export interface Transaction {
  _id: string;
  date: string;
  name: string;
  type: TransactionType;
  category: string;
  amount: number;
  currency: TransactionCurrency;
  createdBy: string;
  createdAt: string;
}

export interface NewTransaction {
  date: string;
  name: string;
  type: TransactionType;
  category: string;
  amount: number;
  currency: TransactionCurrency;
}

// Matches server/src/models/transactionModel.js's fixed lists exactly -
// kept here too since the client picks the category dropdown's options
// before the server ever validates them.
export const INCOME_CATEGORIES = ['Tagdíj', '1% SZJA felajánlás'];
export const EXPENSE_CATEGORIES = ['Szállásköltség', 'Banki költségek', 'Egyéb', 'Ajándék'];

interface TransactionsResponse {
  status: string;
  data: { transactions: Transaction[] };
}

interface TransactionResponse {
  status: string;
  data: { transaction: Transaction };
}

@Injectable({ providedIn: 'root' })
export class FinanceService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/finance`;

  getTransactions() {
    return this.http.get<TransactionsResponse>(`${this.apiUrl}/transactions`);
  }

  createTransaction(payload: NewTransaction) {
    return this.http.post<TransactionResponse>(`${this.apiUrl}/transactions`, payload);
  }
}
