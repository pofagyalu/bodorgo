import { ApplicationConfig, LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authHttpInterceptor } from './auth/auth-http-interceptor';

// Angular's LOCALE_ID defaults to 'en-US' when not provided - not the
// visitor's own browser locale, Angular's own hardcoded default - so
// without this, the built-in date/number/currency pipes would silently
// render in English regardless of who's visiting. Most of this app's own
// date formatting already works around that by hardcoding
// Intl.DateTimeFormat('hu-HU', ...) directly (see shared/format.ts and
// several components), but registering the locale here makes the plain
// `date` pipe correct too, for any current or future use of it.
registerLocaleData(localeHu);

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'hu-HU' },
    provideZonelessChangeDetection(),
    provideAnimations(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authHttpInterceptor])),
  ],
};
