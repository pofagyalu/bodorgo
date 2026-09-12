import { HttpInterceptorFn } from '@angular/common/http';

export const authHttpInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
