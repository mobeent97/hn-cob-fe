import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

/** Console logger that stays quiet in staging/production except for warnings and errors. */
@Injectable({ providedIn: 'root' })
export class LoggerService {
  debug(...args: unknown[]): void {
    if (!environment.production) console.debug('[DEBUG]', ...args);
  }

  info(...args: unknown[]): void {
    if (!environment.production) console.info('[INFO]', ...args);
  }

  warn(...args: unknown[]): void {
    console.warn('[WARNING]', ...args);
  }

  error(...args: unknown[]): void {
    console.error('[ERROR]', ...args);
  }
}
