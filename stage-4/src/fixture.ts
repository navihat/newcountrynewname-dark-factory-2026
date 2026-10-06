import { validation } from './errors';
import { hashPassword } from './passwords';
import * as read from './reader';
import { now, observe } from './clock';
import { remainingAmount } from './holds';
import { deriveOpeningBalances } from './ledger';
import {
  emptyState,
  type Authorization,
  type Payment,
  type PaymentRevision,
  type PaymentRequest,
  type State,
  type User,
} from './state';
import { nowRfc3339, parseInstant, type JsonObject } from './util';

export const HANDLE_PATTERN = /^[a-z0-9_]{1,20}$/;
export const MINOR_UNITS = [0, 2, 3];
const VISIBILITIES = ['public', 'private'] as const;
const STATUSES = ['pending', 'paid', 'declined', 'cancelled'] as const;
const AUTHORIZATION_STATUSES = ['open', 'captured', 'voided', 'expired'] as const;

/** How to read times that a fixture or an export may leave out or get wrong. */
export interface TimeRules {
  /** Used when a payment or authorization has no `created_at`. */
  defaultAt: string;
  /** A fixture may not describe payments from the future; an export may be taken as is. */
  rejectFuture: boolean;
}

export function stateFromFixture(raw: JsonObject): State {
  const state = emptyState();
  const rules: TimeRules = { defaultAt: nowRfc3339(), rejectFuture: true };
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
    const payment = readPayment(entry, state, rules);
    state.payments.set(payment.id, payment);
  }
  deriveOpeningBalances(state);
  for (const entry of read.array(raw.requests ?? [], 'requests')) {
    const request = readRequest(entry, state);
    state.requests.set(request.id, request);
  }
  for (const entry of read.array(raw.authorizations ?? [], 'authorizations')) {
    const authorization = readAuthorization(entry, state, rules);
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
    openingBalance: Number.NaN,
  };
}

export function readInstant(value: unknown, what: string): { text: string; ms: number } {
  const text = read.string(value, what);
  const epoch = parseInstant(text);
  if (epoch === null) throw validation(`${what} must be an RFC 3339 instant with an offset`);
  return { text, ms: epoch };
}

function readCreatedAt(value: unknown, what: string, rules: TimeRules): string {
  if (value === undefined || value === null) return rules.defaultAt;
  const created = readInstant(value, what);
  if (rules.rejectFuture && created.ms > now()) throw validation(`${what} must not be in the future`);
  observe(created.ms);
  return created.text;
}

function readRevisions(value: unknown, createdAt: string, amount: number): PaymentRevision[] {
  if (value === undefined || value === null) {
    return [{ revision: 1, amount, effectiveAt: createdAt, recordedAt: createdAt, reason: '', batchId: null }];
  }
  const revisions = read.array(value, 'payment revisions').map((entry, index): PaymentRevision => {
    const raw = read.object(entry, 'payment revision');
    if (read.integer(raw.revision, 'revision number', 1) !== index + 1) throw validation('revisions must be numbered from 1');
    return {
      revision: index + 1,
      amount: read.integer(raw.amount, 'revision amount'),
      effectiveAt: readInstant(raw.effective_at, 'revision effective_at').text,
      recordedAt: readInstant(raw.recorded_at, 'revision recorded_at').text,
      reason: read.string(raw.reason ?? '', 'revision reason'),
      batchId: read.optional(raw.correction_batch_id, (v) => read.string(v, 'revision correction_batch_id'), null),
    };
  });
  if (revisions.length === 0) throw validation('a payment needs at least one revision');
  return revisions;
}

function knownUser(state: State, value: unknown, what: string): string {
  const userId = read.string(value, what);
  if (!state.users.has(userId)) throw validation(`${what} refers to unknown user ${userId}`);
  return userId;
}

export function readPayment(entry: unknown, state: State, rules: TimeRules): Payment {
  const raw = read.object(entry, 'payment');
  const amount = read.integer(raw.amount, 'payment amount');
  const createdAt = readCreatedAt(raw.created_at, 'payment created_at', rules);
  return {
    id: read.id(raw.id, 'payment id'),
    fromUserId: knownUser(state, raw.from_user_id, 'payment from_user_id'),
    toUserId: knownUser(state, raw.to_user_id, 'payment to_user_id'),
    amount,
    note: read.optional(raw.note, (v) => read.string(v, 'payment note'), ''),
    visibility: read.optional(raw.visibility, (v) => read.oneOf(v, VISIBILITIES, 'payment visibility'), 'public'),
    requestId: read.optional(raw.request_id, (v) => read.string(v, 'payment request_id'), null),
    authorizationId: read.optional(raw.authorization_id, (v) => read.string(v, 'payment authorization_id'), null),
    refundOf: read.optional(raw.refund_of, (v) => read.string(v, 'payment refund_of'), null),
    settlementId: read.optional(raw.settlement_id, (v) => read.string(v, 'payment settlement_id'), null),
    createdAt,
    revisions: readRevisions(raw.revisions, createdAt, amount),
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

export function readAuthorization(entry: unknown, state: State, rules: TimeRules): Authorization {
  const raw = read.object(entry, 'authorization');
  const status = read.oneOf(raw.status ?? 'open', AUTHORIZATION_STATUSES, 'authorization status');
  const amount = read.integer(raw.amount, 'authorization amount');
  const capturedAmount = read.optional(
    raw.captured_amount,
    (v) => read.integer(v, 'authorization captured_amount'),
    status === 'captured' ? amount : 0,
  );
  if (capturedAmount > amount) throw validation('authorization captured_amount exceeds amount');
  const expiresAt = readInstant(raw.expires_at, 'authorization expires_at').text;
  const createdAt = readCreatedAt(raw.created_at, 'authorization created_at', { ...rules, rejectFuture: false });
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
    closedAt: read.optional(
      raw.closed_at,
      (v) => readInstant(v, 'authorization closed_at').text,
      derivedClosedAt(state, status, expiresAt, createdAt, paymentIds),
    ),
    paymentIds,
    createdAt,
  };
}

/** When a closed hold ended, for sources that did not record it: the best known instant. */
function derivedClosedAt(state: State, status: string, expiresAt: string, createdAt: string, paymentIds: string[]): string | null {
  if (status === 'open') return null;
  if (status === 'expired') return expiresAt;
  const lastCapture = status === 'captured' ? state.payments.get(paymentIds[paymentIds.length - 1] ?? '') : undefined;
  return lastCapture ? lastCapture.createdAt : createdAt;
}

/** Unexpired open holds may never exceed the wallet that backs them. */
export function requireHoldsCovered(state: State, nowMs: number = now()): void {
  const held = new Map<string, number>();
  for (const authorization of state.authorizations.values()) {
    if (authorization.status !== 'open' || (parseInstant(authorization.expiresAt) as number) <= nowMs) continue;
    held.set(authorization.fromUserId, (held.get(authorization.fromUserId) ?? 0) + remainingAmount(authorization));
  }
  for (const [userId, amount] of held) {
    if (amount > (state.users.get(userId)?.balance ?? 0)) {
      throw validation(`open authorizations of ${userId} exceed its balance`);
    }
  }
}
