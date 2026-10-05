import { now } from './clock';
import type { Authorization, State, User } from './state';
import { parseInstant } from './util';

const ms = (text: string): number => parseInstant(text) as number;

/** The amount an authorization still reserves: nothing once it is no longer open. */
export function remainingAmount(authorization: Authorization): number {
  return authorization.status === 'open' ? authorization.amount - authorization.capturedAmount : 0;
}

export function heldFunds(state: State, userId: string): number {
  let held = 0;
  for (const authorization of state.authorizations.values()) {
    if (authorization.fromUserId === userId) held += remainingAmount(authorization);
  }
  return held;
}

/** What a user can spend on new payments, authorizations and settlement debits. */
export function availableFunds(state: State, user: User): number {
  return user.balance - heldFunds(state, user.id);
}

/**
 * Expiry is evaluated lazily: any open authorization whose deadline has passed is closed here,
 * at its deadline, which releases its remainder. Called before every request, so no timer is needed.
 */
export function expireDue(state: State, nowMs: number = now()): void {
  for (const authorization of state.authorizations.values()) {
    if (authorization.status === 'open' && ms(authorization.expiresAt) <= nowMs) {
      authorization.status = 'expired';
      authorization.closedAt = authorization.expiresAt;
    }
  }
}

interface Capture {
  atMs: number;
  amount: number;
}

/** Captures of an authorization, with any captured amount that has no payment record. */
function capturesOf(state: State, authorization: Authorization): Capture[] {
  const captures: Capture[] = [];
  let recorded = 0;
  for (const paymentId of authorization.paymentIds) {
    const payment = state.payments.get(paymentId);
    if (!payment) continue;
    captures.push({ atMs: ms(payment.createdAt), amount: payment.revisions[0].amount });
    recorded += payment.revisions[0].amount;
  }
  if (authorization.capturedAmount > recorded) {
    captures.push({ atMs: ms(authorization.createdAt), amount: authorization.capturedAmount - recorded });
  }
  return captures;
}

/**
 * What one authorization reserved at instant `atMs`, as known at `knownMs`. A hold starts when it
 * is created; a capture reduces it when it happens; a final capture, void or expiry releases the
 * rest at that event's time. The deadline is known as soon as the creation is.
 */
function reservedAt(state: State, authorization: Authorization, atMs: number, knownMs: number): number {
  const created = ms(authorization.createdAt);
  if (created > atMs || created > knownMs) return 0;
  if (ms(authorization.expiresAt) <= atMs) return 0;
  const visibleUntil = Math.min(atMs, knownMs);
  if (authorization.closedAt !== null && ms(authorization.closedAt) <= visibleUntil) return 0;
  let reserved = authorization.amount;
  for (const capture of capturesOf(state, authorization)) if (capture.atMs <= visibleUntil) reserved -= capture.amount;
  return reserved;
}

/** Funds a user had on hold at `atMs`, as known at `knownMs`. */
export function heldAt(state: State, userId: string, atMs: number, knownMs: number): number {
  let held = 0;
  for (const authorization of state.authorizations.values()) {
    if (authorization.fromUserId === userId) held += reservedAt(state, authorization, atMs, knownMs);
  }
  return held;
}

/** Every instant at which one of the user's holds started, shrank or ended. */
export function holdEventTimes(state: State, userId: string): number[] {
  const times: number[] = [];
  for (const authorization of state.authorizations.values()) {
    if (authorization.fromUserId !== userId) continue;
    times.push(ms(authorization.createdAt), ms(authorization.expiresAt));
    if (authorization.closedAt !== null) times.push(ms(authorization.closedAt));
    for (const capture of capturesOf(state, authorization)) times.push(capture.atMs);
  }
  return times;
}
