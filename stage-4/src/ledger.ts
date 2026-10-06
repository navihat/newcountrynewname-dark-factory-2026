import { heldAt, holdEventTimes } from './holds';
import type { Payment, PaymentRevision, State, User } from './state';
import { parseInstant } from './util';

/** One payment as it moves a single wallet, under the revision selected for a view. */
export interface Movement {
  payment: Payment;
  revision: PaymentRevision;
  delta: number;
  effectiveMs: number;
}

const ms = (text: string): number => parseInstant(text) as number;

export function currentRevision(payment: Payment): PaymentRevision {
  return payment.revisions[payment.revisions.length - 1];
}

/** The latest revision recorded at or before `knownMs`; undefined when none was recorded yet. */
export function selectRevision(payment: Payment, knownMs: number): PaymentRevision | undefined {
  for (let index = payment.revisions.length - 1; index >= 0; index--) {
    if (ms(payment.revisions[index].recordedAt) <= knownMs) return payment.revisions[index];
  }
  return undefined;
}

/** A user's movements, ordered by effective time and then payment id. */
export function movementsFor(state: State, userId: string, knownMs: number = Infinity): Movement[] {
  const movements: Movement[] = [];
  for (const payment of state.payments.values()) {
    const sign = payment.fromUserId === userId ? -1 : payment.toUserId === userId ? 1 : 0;
    if (sign === 0) continue;
    const revision = selectRevision(payment, knownMs);
    if (revision) movements.push({ payment, revision, delta: sign * revision.amount, effectiveMs: ms(revision.effectiveAt) });
  }
  return movements.sort(
    (a, b) => a.effectiveMs - b.effectiveMs || (a.payment.id < b.payment.id ? -1 : a.payment.id > b.payment.id ? 1 : 0),
  );
}

/** The wallet total after every movement effective at or before `asOfMs`. */
export function totalAt(user: User, movements: Movement[], asOfMs: number): number {
  let total = user.openingBalance;
  for (const movement of movements) if (movement.effectiveMs <= asOfMs) total += movement.delta;
  return total;
}

/** Opening balances for states that do not carry them: ending balance minus what payments did. */
export function deriveOpeningBalances(state: State): void {
  for (const user of state.users.values()) {
    const net = movementsFor(state, user.id).reduce((sum, movement) => sum + movement.delta, 0);
    user.openingBalance = user.balance - net;
  }
}

/**
 * Whether, under the latest revisions, either party's total or available funds are negative at
 * any past effective-time or hold-event boundary. All activity at one instant counts together.
 */
export function hasHistoricalOverdraft(state: State, nowMs: number, parties: User[]): boolean {
  for (const user of parties) {
    const movements = movementsFor(state, user.id);
    const boundaries = new Set<number>(movements.map((movement) => movement.effectiveMs));
    for (const time of holdEventTimes(state, user.id)) boundaries.add(time);
    let total = user.openingBalance;
    let cursor = 0;
    for (const boundary of [...boundaries].filter((time) => time <= nowMs).sort((a, b) => a - b)) {
      while (cursor < movements.length && movements[cursor].effectiveMs <= boundary) total += movements[cursor++].delta;
      if (total < 0 || total - heldAt(state, user.id, boundary, Infinity) < 0) return true;
    }
  }
  return false;
}

/** Total already refunded against a payment. */
export function refundedAmount(state: State, paymentId: string): number {
  let refunded = 0;
  for (const payment of state.payments.values()) {
    if (payment.refundOf === paymentId) refunded += currentRevision(payment).amount;
  }
  return refunded;
}
