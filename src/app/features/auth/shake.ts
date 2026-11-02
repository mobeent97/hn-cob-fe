/** Replays the error-state shake (transitions.dev 12): remove, force a reflow, re-add. */
export function replayShake(el: HTMLElement) {
  el.classList.remove('is-shaking');
  void el.offsetWidth;
  el.classList.add('is-shaking');
  el.addEventListener('animationend', () => el.classList.remove('is-shaking'), { once: true });
}
