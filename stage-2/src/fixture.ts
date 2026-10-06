import { validation } from './errors';
import { hashPassword } from './passwords';
import * as read from './reader';
import { remainingAmount } from './holds';
import {
  emptyState,
  type Authorization,
  type Payment,
  type PaymentRequest,
  type State,
  type User,
} from './state';
import { nowRfc3339, type JsonObject } from './util';

export const HANDLE_PATTERN = /^[a-z0-9_]{1,20}$/;
export const MINOR_UNITS = [0, 2, 3];
const VISIBILITIES = ['public', 'private'] as const;
const STATUSES = ['pending', 'paid', 'declined', 'cancelled'] as const;
const AUTHORIZATION_STATUSES = ['open', 'captured', 'voided', 'expired'] as const;

export function stateFromFixture(raw: JsonObject): State {
  const state = emptyState();
  state.currency = read.optional(raw.currency, (v) => read.string(v, 'currency'), 'EUR');
  if (state.currency === '') throw validation('currency must not be empty');
  state.minorUnits = read.optional(raw.minor_units, (v) => read.integer(v, 'minor_units'), 2);
  if (!MINOR_UNITS.includes(state.minorUnits)) throw validation('minor_units must be 0, 2 or 3');

  if (raw.authorization_ttl_seconds !== undefined) {
    state.authorizationTtlSeconds = read.integer(raw.authorization_ttl_seconds, 'authorization_ttl_seconds', 1);
  }

  const emails = new Set<string>();
  const handles = new Set<string>();
  for (const entry of read.array(raw.users ?? [], 'users')) {
    const user = readUser(entry);
    if (state.users.has(user.id)) throw validation(`duplicate user id ${user.id}`);
    if (handles.has(user.handle)) throw validation(`duplicate handle ${user.handle}`);
    if (emails.has(user.email.toLowerCase())) throw validation(`duplicate email ${user.email}`);
    state.users.set(user.id, user);
    handles.add(user.handle);
    emails.add(user.email.toLowerCase());
  }

  for (const entry of read.array(raw.payments ?? [], 'payments')) {
    const payment = readPayment(entry, state);
    state.payments.set(payment.id, payment);
  }
  for (const entry of read.array(raw.requests ?? [], 'requests')) {
    const request = readRequest(entry, state);
    state.requests.set(request.id, request);
  }
  for (const entry of read.array(raw.authorizations ?? [], 'authorizations')) {
    const authorization = readAuthorization(entry, state);
    state.authorizations.set(authorization.id, authorization);
  }
  requireHoldsCovered(state);
  for (const operator of read.array(raw.settlement_operator_ids ?? [], 'settlement_operator_ids')) {
    state.operatorIds.add(read.string(operator, 'settlement operator id'));
  }
  return state;
}

function readUser(entry: unknown): User {
  const raw = read.object(entry, 'user');
  const handle = read.string(raw.handle, 'user handle');
  if (!HANDLE_PATTERN.test(handle)) throw validation(`invalid handle ${handle}`);
  return {
    id: read.id(raw.id, 'user id'),
    email: read.string(raw.email, 'user email'),
    handle,
    displayName: read.string(raw.display_name, 'user display_name'),
    passwordHash: hashPassword(read.string(raw.password, 'user password')),
    balance: read.integer(raw.balance ?? 0, 'user balance'),
  };
}

function knownUser(state: State, value: unknown, what: string): string {
  const userId = read.string(value, what);
  if (!state.users.has(userId)) throw validation(`${what} refers to unknown user ${userId}`);
  return userId;
}

export function readPayment(entry: unknown, state: State): Payment {
  const raw = read.object(entry, 'payment');
  return {
    id: read.id(raw.id, 'payment id'),
    fromUserId: knownUser(state, raw.from_user_id, 'payment from_user_id'),
    toUserId: knownUser(state, raw.to_user_id, 'payment to_user_id'),
    amount: read.integer(raw.amount, 'payment amount'),
    note: read.optional(raw.note, (v) => read.string(v, 'payment note'), ''),
    visibility: read.optional(raw.visibility, (v) => read.oneOf(v, VISIBILITIES, 'payment visibility'), 'public'),
    requestId: read.optional(raw.request_id, (v) => read.string(v, 'payment request_id'), null),
    authorizationId: read.optional(raw.authorization_id, (v) => read.string(v, 'payment authorization_id'), null),
    settlementId: read.optional(raw.settlement_id, (v) => read.string(v, 'payment settlement_id'), null),
    createdAt: read.optional(raw.created_at, (v) => read.string(v, 'payment created_at'), nowRfc3339()),
  };
}

export function readRequest(entry: unknown, state: State): PaymentRequest {
  const raw = read.object(entry, 'request');
  return {
    id: read.id(raw.id, 'request id'),
    requesterId: knownUser(state, raw.requester_id, 'request requester_id'),
    payerId: knownUser(state, raw.payer_id, 'request payer_id'),
    amount: read.integer(raw.amount, 'request amount'),
    note: read.optional(raw.note, (v) => read.string(v, 'request note'), ''),
    status: read.optional(raw.status, (v) => read.oneOf(v, STATUSES, 'request status'), 'pending'),
    paymentId: read.optional(raw.payment_id, (v) => read.string(v, 'request payment_id'), null),
    createdAt: read.optional(raw.created_at, (v) => read.string(v, 'request created_at'), nowRfc3339()),
  };
}

export function readAuthorization(entry: unknown, state: State): Authorization {
  const raw = read.object(entry, 'authorization');
  const status = read.oneOf(raw.status ?? 'open', AUTHORIZATION_STATUSES, 'authorization status');
  const amount = read.integer(raw.amount, 'authorization amount');
  const capturedAmount = read.optional(
    raw.captured_amount,
    (v) => read.integer(v, 'authorization captured_amount'),
    status === 'captured' ? amount : 0,
  );
  if (capturedAmount > amount) throw validation('authorization captured_amount exceeds amount');
  const expiresAt = read.string(raw.expires_at, 'authorization expires_at');
  if (Number.isNaN(Date.parse(expiresAt))) throw validation('authorization expires_at must be an RFC 3339 time');
  const paymentIds = read.optional(
    raw.payment_ids,
    (v) => read.array(v, 'authorization payment_ids').map((p) => read.string(p, 'authorization payment id')),
    raw.payment_id ? [read.string(raw.payment_id, 'authorization payment_id')] : [],
  );
  return {
    id: read.id(raw.id, 'authorization id'),
    fromUserId: knownUser(state, raw.from_user_id, 'authorization from_user_id'),
    toUserId: knownUser(state, raw.to_user_id, 'authorization to_user_id'),
    amount,
    capturedAmount,
    note: read.optional(raw.note, (v) => read.string(v, 'authorization note'), ''),
    visibility: read.optional(raw.visibility, (v) => read.oneOf(v, VISIBILITIES, 'authorization visibility'), 'public'),
    status,
    expiresAt,
    paymentIds,
    createdAt: read.optional(raw.created_at, (v) => read.string(v, 'authorization created_at'), nowRfc3339()),
  };
}

/** Unexpired open holds may never exceed the wallet that backs them. */
export function requireHoldsCovered(state: State, nowMs: number = Date.now()): void {
  const held = new Map<string, number>();
  for (const authorization of state.authorizations.values()) {
    if (authorization.status !== 'open' || Date.parse(authorization.expiresAt) <= nowMs) continue;
    held.set(authorization.fromUserId, (held.get(authorization.fromUserId) ?? 0) + remainingAmount(authorization));
  }
  for (const [userId, amount] of held) {
    if (amount > (state.users.get(userId)?.balance ?? 0)) {
      throw validation(`open authorizations of ${userId} exceed its balance`);
    }
  }
}
