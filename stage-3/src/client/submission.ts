import { newKey } from './api.js';

export interface Plan {
  /** The same content was already sent successfully and the form has not been edited since. */
  duplicate: boolean;
  key: string;
}

/**
 * Remembers what a form last did, so an unchanged form is never sent twice and a response that
 * was lost is retried with the same idempotency key and body.
 */
export class Submission {
  private settled: string | null = null;
  private pending: { fingerprint: string; key: string } | null = null;

  plan(fingerprint: string): Plan {
    if (this.settled === fingerprint) return { duplicate: true, key: '' };
    if (this.pending && this.pending.fingerprint === fingerprint) return { duplicate: false, key: this.pending.key };
    return { duplicate: false, key: newKey() };
  }

  succeeded(fingerprint: string): void {
    this.settled = fingerprint;
    this.pending = null;
  }

  /** The server refused the request: nothing happened, so a retry is a fresh attempt. */
  refused(): void {
    this.pending = null;
  }

  /** The outcome is unknown: keep the key so a retry replays instead of paying twice. */
  uncertain(fingerprint: string, key: string): void {
    this.pending = { fingerprint, key };
  }

  /**
   * The user edited the form. Submitting it again is a new action unless the edit left the
   * content exactly as it was sent (`current` is the form's fingerprint now, if it is valid).
   */
  edited(current: string | null): void {
    if (this.settled !== current) this.settled = null;
  }

  /** Forget a successful send, for forms where repeating an identical action is legitimate. */
  forgetSettled(): void {
    this.settled = null;
  }
}
