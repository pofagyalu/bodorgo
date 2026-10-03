import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export const API = environment.apiBaseUrl;

/** The providers every spec that reaches HttpClient needs. */
export const httpTesting = () => [provideHttpClient(), provideHttpClientTesting()];

/** One row of a service's "which request does this method send" table. */
export type RequestCase = [
  name: string,
  call: () => Observable<unknown>,
  method: string,
  url: string,
  body?: unknown,
];

/**
 * Checks, row by row, that calling a service method sends exactly the
 * expected request (method, URL with its query, and the JSON body if given).
 */
export function itSendsRequests(cases: RequestCase[]) {
  it.each(cases)('%s', (_name, call, method, url, body) => {
    const http = TestBed.inject(HttpTestingController);
    let answered = false;
    call().subscribe(() => (answered = true));
    const req = http.expectOne((r) => r.urlWithParams === url);
    expect(req.request.method).toBe(method);
    if (body !== undefined) expect(req.request.body).toEqual(body);
    req.flush({ data: {} });
    expect(answered).toBe(true);
    http.verify();
  });
}

/** What a FormData body holds, files shown by their name. */
export function formEntries(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  (body as FormData).forEach((value, key) => {
    out[key] = typeof value === 'string' ? value : value.name;
  });
  return out;
}
