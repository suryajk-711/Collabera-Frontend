import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Attaches Basic Auth to all API calls.
 * POC only — production would use OAuth2 tokens from an AuthService.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const credentials = btoa('officer1:password');
  const authReq = req.clone({
    setHeaders: { Authorization: `Basic ${credentials}` }
  });
  return next(authReq);
};