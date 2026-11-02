import { signal } from '@angular/core';

const seen = new Set<string>();

/**
 * Simulated network latency for the design phase: true for `ms` the first time a screen opens
 * in a session, then false. Lets every screen show its real loading state (flat grey bars at the
 * final size). Replace with the HTTP request's pending state when the API exists.
 */
export function simulateLoad(key: string, ms = 450) {
  const loading = signal(!seen.has(key));
  if (loading()) {
    seen.add(key);
    setTimeout(() => loading.set(false), ms);
  }
  return loading;
}
