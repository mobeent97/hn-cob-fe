import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenStorageService } from '../services/token-storage.service';

export const authGuard: CanActivateFn = () => {
  const tokens = inject(TokenStorageService);
  return tokens.isLoggedIn() ? true : inject(Router).createUrlTree(['/auth']);
};
