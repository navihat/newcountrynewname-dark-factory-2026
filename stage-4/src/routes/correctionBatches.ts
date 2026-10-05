import { now } from '../clock';
import { ApiError, forbidden, insufficientFunds, notFound, validation } from '../errors';
import { authed, parseJsonObject } from '../http';
import { availableFunds } from '../holds';
import { runIdempotent } from '../idempotency';
import { currentRevision, hasHistoricalOverdraft, refundedAmount } from '../ledger';
import { nextId, store, type Payment, type PaymentRevision, type User } from '../state';
import { isObject, nowRfc3339, parseInstant, type JsonObject } from '../util';
import { userById } from '../wallet';
import { readCorrection, refundExceedsPayment, revisionView, type Correction } from './corrections';

const MAX_ITEMS = 32;

interface Item {
  payment: Payment;
  correction: Correction;
  difference: number;
}

function readBatch(body: JsonObject): JsonObject[] {
  const items = body.corrections;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS || !items.every(isObject)) {
    throw validation(`corrections must be an array of 1 to ${MAX_ITEMS} objects`);
  }
  const ids = items.map((item) => item.payment_id).filter((id): id is string => typeof id === 'string');
  if (new Set(ids).size !== ids.length) throw validation('corrections must name each payment only once');
  return items;
}

/** One item's own errors, in the order a single correction would report them. */
function readItem(raw: JsonObject): Item {
  const id = raw.payment_id;
  if (typeof id !== 'string') throw validation('payment_id must be a string');
  const correction = readCorrection(raw);
  const payment = store.state.payments.get(id);
  if (!payment) throw notFound(`no payment ${id}`);
  if (payment.authorizationId !== null || payment.refundOf !== null) {
    throw new ApiError(422, 'linked_payment_immutable', 'captures and refunds cannot be corrected');
  }
  const latest = currentRevision(payment);
  if (correction.expectedRevision !== latest.revision) {
    throw new ApiError(409, 'stale_revision', `payment ${id} is at revision ${latest.revision}`);
  }
  if (correction.amount < refundedAmount(store.state, id)) throw refundExceedsPayment();
  return { payment, correction, difference: correction.amount - latest.amount };
}

/** Every member of each touched settlement must be present, and share one effective instant. */
function requireWholeSettlements(items: Item[]): void {
  const touched = new Set(items.map((item) => item.payment.settlementId).filter((id): id is string => id !== null));
  const included = new Set(items.map((item) => item.payment.id));
  for (const payment of store.state.payments.values()) {
    if (payment.settlementId !== null && touched.has(payment.settlementId) && !included.has(payment.id)) {
      throw new ApiError(422, 'incomplete_settlement', `settlement ${payment.settlementId} must be corrected as a whole`);
    }
  }
  const instants = new Map<string, number>();
  for (const { payment, correction } of items) {
    if (payment.settlementId === null) continue;
    const effective = parseInstant(correction.effectiveAt) as number;
    const first = instants.get(payment.settlementId);
    if (first === undefined) instants.set(payment.settlementId, effective);
    else if (first !== effective) throw validation('members of one settlement need identical effective instants');
  }
}

/** The combined effect of all proposed revisions must leave every wallet with available funds. */
function requireAffordable(items: Item[]): void {
  const net = new Map<User, number>();
  for (const { payment, difference } of items) {
    const sender = userById(payment.fromUserId);
    const receiver = userById(payment.toUserId);
    net.set(sender, (net.get(sender) ?? 0) - difference);
    net.set(receiver, (net.get(receiver) ?? 0) + difference);
  }
  for (const [user, change] of net) if (availableFunds(store.state, user) + change < 0) throw insufficientFunds();
}

export const createCorrectionBatch = authed((ctx, user) => {
  if (!store.state.operatorIds.has(user.id)) throw forbidden('only settlement operators may do this');
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const state = store.state;
    const items = readBatch(body).map(readItem);
    requireWholeSettlements(items);
    requireAffordable(items);

    const batchId = nextId(state, 'correctionBatch');
    const recordedAt = nowRfc3339();
    const added: { payment: Payment; revision: PaymentRevision }[] = items.map(({ payment, correction }) => ({
      payment,
      revision: {
        revision: currentRevision(payment).revision + 1,
        amount: correction.amount,
        effectiveAt: correction.effectiveAt,
        recordedAt,
        reason: correction.reason,
        batchId,
      },
    }));
    for (const { payment, revision } of added) payment.revisions.push(revision);
    const parties = new Set<User>(items.flatMap(({ payment }) => [userById(payment.fromUserId), userById(payment.toUserId)]));
    if (hasHistoricalOverdraft(state, now(), [...parties])) {
      for (const { payment } of added) payment.revisions.pop();
      throw new ApiError(409, 'historical_overdraft', 'the corrections would overdraw a wallet at a past moment');
    }
    for (const { payment, difference } of items) {
      userById(payment.fromUserId).balance -= difference;
      userById(payment.toUserId).balance += difference;
    }
    return {
      correction_batch_id: batchId,
      recorded_at: recordedAt,
      revisions: added.map(({ payment, revision }) => revisionView(payment, revision)),
    };
  });
});
