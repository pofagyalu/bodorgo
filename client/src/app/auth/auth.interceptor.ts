import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

export const AuthInterceptor: HttpInterceptorFn = (req, next) => {
  const isApiRequest = req.url.startsWith(environment.apiUrl);
  const isAuthCallback = req.url.includes('/auth/callback');

  if (isApiRequest && !isAuthCallback) {
    req = req.clone({
      withCredentials: true,
    });
  }
  return next(req);
};
