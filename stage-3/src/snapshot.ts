import { now } from './clock';
import { validation } from './errors';
import {
  HANDLE_PATTERN,
  MINOR_UNITS,
  readAuthorization,
  readPayment,
  readRequest,
  requireHoldsCovered,
  type TimeRules,
} from './fixture';
import { isPasswordHash } from './passwords';
import * as read from './reader';
import { deriveOpeningBalances } from './ledger';
import { formatInstant } from './util';
import { emptyState, idempotencyKey, type IdempotencyRecord, type State, type User } from './state';
import { type JsonObject } from './util';

export const TRACK = 'pocketful';
export const FORMAT_VERSION = 1;

export function exportState(state: State): JsonObject {
  return {
    track: TRACK,
    format_version: FORMAT_VERSION,
    state: {
      currency: state.currency,
      minor_units: state.minorUnits,
      authorization_ttl_seconds: state.authorizationTtlSeconds,
      users: [...state.users.values()].map((u) => ({
        id: u.id,
        email: u.email,
        handle: u.handle,
        display_name: u.displayName,
        password_hash: u.passwordHash,
        balance: u.balance,
        opening_balance: u.openingBalance,
      })),
      tokens: [...state.tokens].map(([token, userId]) => ({ token, user_id: userId })),
      payments: [...state.payments.values()].map((p) => ({
        id: p.id,
        from_user_id: p.fromUserId,
        to_user_id: p.toUserId,
        amount: p.amount,
        note: p.note,
        visibility: p.visibility,
        request_id: p.requestId,
        settlement_id: p.settlementId,
        authorization_id: p.authorizationId,
        created_at: p.createdAt,
        revisions: p.revisions.map((r) => ({
          revision: r.revision,
          amount: r.amount,
          effective_at: r.effectiveAt,
          recorded_at: r.recordedAt,
          reason: r.reason,
        })),
      })),
      requests: [...state.requests.values()].map((r) => ({
        id: r.id,
        requester_id: r.requesterId,
        payer_id: r.payerId,
        amount: r.amount,
        note: r.note,
        status: r.status,
        payment_id: r.paymentId,
        created_at: r.createdAt,
      })),
      authorizations: [...state.authorizations.values()].map((a) => ({
        id: a.id,
        from_user_id: a.fromUserId,
        to_user_id: a.toUserId,
        amount: a.amount,
        captured_amount: a.capturedAmount,
        note: a.note,
        visibility: a.visibility,
        status: a.status,
        expires_at: a.expiresAt,
        closed_at: a.closedAt,
        payment_ids: a.paymentIds,
        created_at: a.createdAt,
      })),
      statements: [...state.statements].map(([token, s]) => ({
        token,
        user_id: s.userId,
        opening_balance: s.openingBalance,
        closing_balance: s.closingBalance,
        entries: s.entries,
      })),
      idempotency: [...state.idempotency.values()].map((i) => ({
        user_id: i.userId,
        key: i.key,
        method: i.method,
        path: i.path,
        fingerprint: i.fingerprint,
        status: i.status,
        response: i.response,
      })),
      settlement_operator_ids: [...state.operatorIds],
      counters: { ...state.counters },
    },
  };
}

/** Builds a complete new state from an export; throws 422 before anything is replaced. */
export function importState(raw: JsonObject): State {
  if (raw.track !== TRACK) throw validation(`track must be "${TRACK}"`);
  if (raw.format_version !== FORMAT_VERSION) throw validation(`format_version must be ${FORMAT_VERSION}`);
  const source = read.object(raw.state, 'state');

  const state = emptyState();
  const rules: TimeRules = { defaultAt: formatInstant(now()), rejectFuture: false };
  state.currency = read.string(source.currency, 'currency');
  state.minorUnits = read.integer(source.minor_units, 'minor_units');
  if (!MINOR_UNITS.includes(state.minorUnits)) throw validation('minor_units must be 0, 2 or 3');

  if (source.authorization_ttl_seconds !== undefined) {
    state.authorizationTtlSeconds = read.integer(source.authorization_ttl_seconds, 'authorization_ttl_seconds', 1);
  }

  const emails = new Set<string>();
  const handles = new Set<string>();
  for (const entry of read.array(source.users, 'users')) {
    const user = readUser(entry);
    if (state.users.has(user.id) || handles.has(user.handle) || emails.has(user.email.toLowerCase())) {
      throw validation('users must have unique ids, handles and emails');
    }
    state.users.set(user.id, user);
    handles.add(user.handle);
    emails.add(user.email.toLowerCase());
  }
  for (const entry of read.array(source.tokens, 'tokens')) {
    const token = read.object(entry, 'token entry');
    const userId = read.string(token.user_id, 'token user_id');
    if (!state.users.has(userId)) throw validation(`token refers to unknown user ${userId}`);
    state.tokens.set(read.string(token.token, 'token'), userId);
  }
  for (const entry of read.array(source.payments, 'payments')) {
    const payment = readPayment(entry, state, rules);
    state.payments.set(payment.id, payment);
  }
  deriveOpeningBalances(state);
  for (const entry of read.array(source.requests, 'requests')) {
    const request = readRequest(entry, state);
    state.requests.set(request.id, request);
  }
  for (const entry of read.array(source.authorizations ?? [], 'authorizations')) {
    const authorization = readAuthorization(entry, state, rules);
    state.authorizations.set(authorization.id, authorization);
  }
  requireHoldsCovered(state);
  for (const entry of read.array(source.idempotency, 'idempotency')) {
    const record = readIdempotency(entry, state);
    state.idempotency.set(idempotencyKey(record.userId, record.method, record.path, record.key), record);
  }
  for (const operator of read.array(source.settlement_operator_ids, 'settlement_operator_ids')) {
    state.operatorIds.add(read.string(operator, 'settlement operator id'));
  }
  for (const entry of read.array(source.statements ?? [], 'statements')) {
    const raw = read.object(entry, 'statement snapshot');
    const userId = read.string(raw.user_id, 'statement user_id');
    if (!state.users.has(userId)) throw validation(`statement snapshot refers to unknown user ${userId}`);
    state.statements.set(read.string(raw.token, 'statement token'), {
      userId,
      openingBalance: read.integer(raw.opening_balance, 'statement opening_balance', -Number.MAX_SAFE_INTEGER),
      closingBalance: read.integer(raw.closing_balance, 'statement closing_balance', -Number.MAX_SAFE_INTEGER),
      entries: read.array(raw.entries, 'statement entries'),
    });
  }
  const counters = read.object(source.counters, 'counters');
  for (const kind of Object.keys(state.counters) as (keyof State['counters'])[]) {
    state.counters[kind] = read.integer(counters[kind] ?? 0, `counter ${kind}`);
  }
  return state;
}

function readUser(entry: unknown): User {
  const raw = read.object(entry, 'user');
  const handle = read.string(raw.handle, 'user handle');
  if (!HANDLE_PATTERN.test(handle)) throw validation(`invalid handle ${handle}`);
  const passwordHash = read.string(raw.password_hash, 'user password_hash');
  if (!isPasswordHash(passwordHash)) throw validation('user password_hash is not a known hash');
  return {
    id: read.id(raw.id, 'user id'),
    email: read.string(raw.email, 'user email'),
    handle,
    displayName: read.string(raw.display_name, 'user display_name'),
    passwordHash,
    balance: read.integer(raw.balance, 'user balance'),
    openingBalance: read.optional(raw.opening_balance, (v) => read.integer(v, 'user opening_balance', -Number.MAX_SAFE_INTEGER), Number.NaN),
  };
}

function readIdempotency(entry: unknown, state: State): IdempotencyRecord {
  const raw = read.object(entry, 'idempotency record');
  const userId = read.string(raw.user_id, 'idempotency user_id');
  if (!state.users.has(userId)) throw validation(`idempotency record refers to unknown user ${userId}`);
  return {
    userId,
    key: read.string(raw.key, 'idempotency key'),
    method: read.string(raw.method, 'idempotency method'),
    path: read.string(raw.path, 'idempotency path'),
    fingerprint: read.string(raw.fingerprint, 'idempotency fingerprint'),
    status: read.integer(raw.status, 'idempotency status', 200),
    response: read.string(raw.response, 'idempotency response'),
  };
}
