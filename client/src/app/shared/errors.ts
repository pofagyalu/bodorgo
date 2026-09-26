import { HttpErrorResponse } from '@angular/common/http';

// The message to show for a failed request or action: the server's own
// ({ message } in the error body), else the error's, else the fallback.
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: unknown } | null;
    if (typeof body?.message === 'string' && body.message) return body.message;
    return fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
