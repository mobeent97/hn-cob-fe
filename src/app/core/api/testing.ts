import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

/** Test helpers for the API services: the envelope, an error envelope, and a TestBed with HttpTestingController. */
export const ok = <T>(data: T, status = 1000, message = 'Success') => ({ status, message, data });
export const fail = (status: number, message: string, data: unknown = null) => ({ status, message, data });

export function setupHttp() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return TestBed.inject(HttpTestingController);
}
