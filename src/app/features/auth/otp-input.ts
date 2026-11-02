import { ChangeDetectionStrategy, Component, ElementRef, input, model, output, viewChildren } from '@angular/core';

/**
 * Six one-digit boxes. Typing advances, Backspace on an empty box steps back, arrows move,
 * and pasting (or the phone's one-time-code autofill) spreads the digits across the boxes.
 */
@Component({
  selector: 'app-otp-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="otp" role="group" [attr.aria-label]="label()">
      @for (d of digits(); track $index; let i = $index) {
        <input
          #box
          class="input box num"
          [class.invalid]="invalid()"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          [attr.autocomplete]="i === 0 ? 'one-time-code' : 'off'"
          [attr.aria-label]="'Digit ' + (i + 1) + ' of 6'"
          [value]="d"
          (input)="onInput(i, $event)"
          (keydown)="onKey(i, $event)"
          (paste)="onPaste(i, $event)"
          (focus)="$any($event.target).select()"
        />
      }
    </div>
  `,
  styles: `
    .otp {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 8px;
    }
    .box {
      height: 48px;
      padding: 0;
      text-align: center;
      font-size: 20px;
      font-weight: 600;
    }
  `,
})
export class OtpInput {
  readonly digits = model<string[]>(['', '', '', '', '', '']);
  readonly invalid = input(false);
  readonly label = input('Verification code');
  readonly complete = output<string>();
  readonly edited = output<void>();
  private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');

  focus(i = 0) {
    this.boxes()[Math.max(0, Math.min(5, i))]?.nativeElement.focus();
  }

  private fill(from: number, text: string) {
    const chars = text.replace(/\D/g, '').slice(0, 6 - from).split('');
    if (!chars.length) return from;
    const next = [...this.digits()];
    chars.forEach((c, k) => (next[from + k] = c));
    this.digits.set(next);
    this.edited.emit();
    const last = from + chars.length;
    if (next.every(Boolean)) {
      this.focus(5);
      this.complete.emit(next.join(''));
    } else this.focus(last);
    return last;
  }

  protected onInput(i: number, e: Event) {
    const el = e.target as HTMLInputElement;
    const raw = el.value;
    if (!/\d/.test(raw)) {
      // Letters are dropped; an emptied box stays empty.
      el.value = this.digits()[i];
      if (!raw) this.setAt(i, '');
      return;
    }
    // A box that already held a digit receives the new one; autofill drops all six into box 0.
    const typed = raw.length > 1 && raw.startsWith(this.digits()[i]) ? raw.slice(this.digits()[i].length) : raw;
    this.fill(i, typed);
    el.value = this.digits()[i];
  }

  protected onKey(i: number, e: KeyboardEvent) {
    if (e.key === 'Backspace') {
      if (this.digits()[i]) {
        this.setAt(i, '');
      } else if (i > 0) {
        this.setAt(i - 1, '');
        this.focus(i - 1);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      this.focus(i - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      this.focus(i + 1);
      e.preventDefault();
    }
  }

  protected onPaste(i: number, e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    e.preventDefault();
    // A full 6-digit code always lands from the first box, wherever the caret was.
    const digits = text.replace(/\D/g, '');
    this.fill(digits.length >= 6 ? 0 : i, digits);
  }

  private setAt(i: number, v: string) {
    const next = [...this.digits()];
    next[i] = v;
    this.digits.set(next);
    this.edited.emit();
  }
}
