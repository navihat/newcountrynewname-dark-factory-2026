import { now } from '../clock';
import { ApiError, forbidden, insufficientFunds, notFound, validation } from '../errors';
import { authed, json, parseJsonObject } from '../http';
import { availableFunds } from '../holds';
import { runIdempotent } from '../idempotency';
import { currentRevision, hasHistoricalOverdraft } from '../ledger';
import { store, type Payment, type PaymentRevision, type User } from '../state';
import { characterCount, nowRfc3339, parseInstant, type JsonObject } from '../util';
import { MAX_AMOUNT } from '../validation';
import { userById } from '../wallet';

const MAX_REASON_LENGTH = 200;

function revisionView(payment: Payment, revision: PaymentRevision) {
  return {
    payment_id: payment.id,
    revision: revision.revision,
    amount: revision.amount,
    effective_at: revision.effectiveAt,
    recorded_at: revision.recordedAt,
    reason: revision.reason,
  };
}

interface Correction {
  expectedRevision: number;
  amount: number;
  effectiveAt: string;
  reason: string;
}

function readCorrection(body: JsonObject): Correction {
  const { expected_revision: expected, amount, effective_at: effective, reason } = body;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
    throw validation('expected_revision must be a positive integer');
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
    throw validation(`amount must be an integer from 0 to ${MAX_AMOUNT}`);
  }
  const effectiveMs = parseInstant(effective);
  if (effectiveMs === null) throw validation('effective_at must be an RFC 3339 instant with an offset');
  if (effectiveMs > now()) throw validation('effective_at must not be later than now');
  if (typeof reason !== 'string' || reason.length === 0 || characterCount(reason) > MAX_REASON_LENGTH) {
    throw validation(`reason must be a string of 1 to ${MAX_REASON_LENGTH} characters`);
  }
  return { expectedRevision: expected, amount, effectiveAt: effective as string, reason };
}

export const correctPayment = authed((ctx, user, [id]) => {
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const payment = store.state.payments.get(id);
    if (!payment) throw notFound(`no payment ${id}`);
    if (payment.fromUserId !== user.id) throw forbidden('only the sender may correct a payment');
    const correction = readCorrection(body);
    if (payment.settlementId !== null || payment.authorizationId !== null) {
      throw new ApiError(422, 'linked_payment_immutable', 'settlement members and captures cannot be corrected');
    }
    const latest = currentRevision(payment);
    if (correction.expectedRevision !== latest.revision) {
      throw new ApiError(409, 'stale_revision', `the payment is at revision ${latest.revision}`);
    }
    return revisionView(payment, appendRevision(payment, latest, correction));
  });
});

/** Appends the revision and moves the difference, or leaves everything as it was and throws. */
function appendRevision(payment: Payment, latest: PaymentRevision, correction: Correction): PaymentRevision {
  const state = store.state;
  const sender = userById(payment.fromUserId);
  const receiver = userById(payment.toUserId);
  const difference = correction.amount - latest.amount;
  const debited: User = difference > 0 ? sender : receiver;
  if (availableFunds(state, debited) < Math.abs(difference)) throw insufficientFunds();

  const revision: PaymentRevision = {
    revision: latest.revision + 1,
    amount: correction.amount,
    effectiveAt: correction.effectiveAt,
    recordedAt: nowRfc3339(),
    reason: correction.reason,
  };
  payment.revisions.push(revision);
  if (hasHistoricalOverdraft(state, now(), [sender, receiver])) {
    payment.revisions.pop();
    throw new ApiError(409, 'historical_overdraft', 'the correction would overdraw a wallet at a past moment');
  }
  sender.balance -= difference;
  receiver.balance += difference;
  return revision;
}

export const listRevisions = authed((_ctx, user, [id]) => {
  const payment = store.state.payments.get(id);
  if (!payment || (payment.fromUserId !== user.id && payment.toUserId !== user.id)) {
    throw notFound(`no payment ${id}`);
  }
  return json(200, { revisions: payment.revisions.map((revision) => revisionView(payment, revision)) });
});
