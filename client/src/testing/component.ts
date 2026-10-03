import { TestBed } from '@angular/core/testing';
import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AuthService, CurrentUser } from '../app/auth/auth.service';
import { TourSocketService } from '../app/services/tour-socket';
import { API, httpTesting } from './http';

/** A failed answer for respond(): `fail(403, 'Nincs jogod.')`. */
export class Failure {
  constructor(
    readonly status: number,
    readonly message?: string,
  ) {}
}
export const fail = (status = 500, message?: string) => new Failure(status, message);

type Reply = object | null | Failure | ((req: TestRequest) => object | null | Failure);

/**
 * Answers the pending requests from a table keyed by "METHOD /path" (the
 * path without the API host and without the query), again and again until
 * nothing in the table is waiting - so follow-up requests get theirs too.
 * Requests that aren't in the table stay open.
 */
export function respond(routes: Record<string, Reply>) {
  const http = TestBed.inject(HttpTestingController);
  for (let round = 0; round < 10; round++) {
    const pending = http.match((req) => `${req.method} ${pathOf(req.url)}` in routes);
    if (!pending.length) return;
    for (const req of pending) {
      const reply = routes[`${req.request.method} ${pathOf(req.request.url)}`];
      const answer = typeof reply === 'function' ? reply(req) : reply;
      if (answer instanceof Failure) {
        req.flush(answer.message ? { message: answer.message } : null, {
          status: answer.status,
          statusText: 'Error',
        });
      } else {
        req.flush(answer);
      }
    }
  }
}

const pathOf = (url: string) => url.replace(API, '').split('?')[0];

/** The requests still waiting, as "METHOD /path" - handy in an assertion. */
export function waiting(): string[] {
  const http = TestBed.inject(HttpTestingController);
  const open = http.match(() => true);
  return open.map((req) => `${req.request.method} ${pathOf(req.request.url)}`);
}

/** Logs a user in for the test (through the same request the app uses). */
export function logIn(user: Partial<CurrentUser> & { role: string }) {
  TestBed.inject(AuthService).checkAuth().subscribe();
  TestBed.inject(HttpTestingController)
    .expectOne(`${API}/auth/me`)
    .flush({ loggedIn: true, id: 'me', name: 'Teszt Elek', ...user });
}

/** A socket that connects nowhere; `fire` plays an incoming event. */
export class FakeSocket {
  handlers = new Map<string, ((payload: unknown) => void)[]>();
  sent: [string, unknown][] = [];
  joinTour = vi.fn();
  leaveTour = vi.fn();
  joinChat = vi.fn();
  leaveChat = vi.fn();

  on(event: string, handler: (payload: unknown) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return () =>
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((h) => h !== handler),
      );
  }

  emit(event: string, payload: unknown) {
    this.sent.push([event, payload]);
  }

  fire(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

/** What a page component needs around it in a test. */
export const pageTesting = () => [
  httpTesting(),
  provideRouter([]),
  provideNoopAnimations(),
  { provide: TourSocketService, useClass: FakeSocket },
];

/** Lets promises (confirm dialogs, async steps) run on. */
export async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
