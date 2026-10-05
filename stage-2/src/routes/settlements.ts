import { ApiError, forbidden, insufficientFunds, validation } from '../errors';
import { authed, parseJsonObject } from '../http';
import { runIdempotent } from '../idempotency';
import { availableFunds } from '../holds';
import { nextId, store, type User, type Visibility } from '../state';
import { isObject, nowRfc3339, type JsonObject } from '../util';
import { readAmount, readNote, readVisibility } from '../validation';
import { paymentView, recordPayment, resolveUser } from '../wallet';

const MAX_TRANSFERS = 32;

interface Transfer {
  from: User;
  to: User;
  amount: number;
  note: string;
  visibility: Visibility;
}

function readBatch(body: JsonObject): unknown[] {
  const transfers = body.transfers;
  if (!Array.isArray(transfers) || transfers.length < 1 || transfers.length > MAX_TRANSFERS) {
    throw validation(`transfers must be an array of 1 to ${MAX_TRANSFERS} objects`);
  }
  if (!transfers.every(isObject)) throw validation('every transfer must be an object');
  return transfers;
}

/** Inside a batch, a missing or non-string handle is a malformed batch shape (422). */
function readEntryHandle(entry: JsonObject, field: string): string {
  const value = entry[field];
  if (typeof value !== 'string') throw validation(`${field} must be a string`);
  return value;
}

function readTransfer(entry: JsonObject): Transfer {
  const fromHandle = readEntryHandle(entry, 'from_handle');
  const toHandle = readEntryHandle(entry, 'to_handle');
  const amount = readAmount(entry);
  const note = readNote(entry);
  const visibility = readVisibility(entry);
  if (fromHandle === toHandle) throw new ApiError(422, 'self_payment', 'a transfer needs two different wallets');
  return { from: resolveUser(fromHandle), to: resolveUser(toHandle), amount, note, visibility };
}

/** A settlement is affordable when no wallet ends below zero after all of its transfers. */
function requireNetAffordable(transfers: Transfer[]): void {
  const net = new Map<User, number>();
  for (const { from, to, amount } of transfers) {
    net.set(from, (net.get(from) ?? 0) - amount);
    net.set(to, (net.get(to) ?? 0) + amount);
  }
  for (const [user, delta] of net) if (availableFunds(store.state, user) + delta < 0) throw insufficientFunds();
}

export const createSettlement = authed((ctx, user) => {
  if (!store.state.operatorIds.has(user.id)) throw forbidden('only settlement operators may do this');
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const transfers = readBatch(body).map((entry) => readTransfer(entry as JsonObject));
    requireNetAffordable(transfers);

    const settlementId = nextId(store.state, 'settlement');
    const committedAt = nowRfc3339();
    const payments = transfers.map((transfer) =>
      paymentView(recordPayment({ ...transfer, requestId: null, settlementId, createdAt: committedAt })),
    );
    return { settlement_id: settlementId, committed_at: committedAt, payments };
  });
});
