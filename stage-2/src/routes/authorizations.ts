import { ApiError, forbidden, insufficientFunds, malformed, notFound, validation } from '../errors';
import { authed, json, parseJsonObject, parseOptionalJsonObject } from '../http';
import { availableFunds, remainingAmount } from '../holds';
import { runIdempotent } from '../idempotency';
import { nextId, store, type Authorization, type AuthorizationStatus } from '../state';
import { formatInstant, nowRfc3339, type JsonObject } from '../util';
import {
  page,
  readAmount,
  readEnum,
  readNote,
  readPaging,
  readRequiredString,
  readVisibility,
} from '../validation';
import { paymentView, recordPayment, resolveOtherUser, userById } from '../wallet';

const STATUSES = ['open', 'captured', 'voided', 'expired'] as const;
const DIRECTIONS = ['incoming', 'outgoing'] as const;

export function authorizationView(authorization: Authorization) {
  const from = userById(authorization.fromUserId);
  const to = userById(authorization.toUserId);
  const latest = authorization.paymentIds[authorization.paymentIds.length - 1] ?? null;
  return {
    authorization_id: authorization.id,
    from_user_id: from.id,
    from_handle: from.handle,
    to_user_id: to.id,
    to_handle: to.handle,
    amount: authorization.amount,
    captured_amount: authorization.capturedAmount,
    remaining_amount: remainingAmount(authorization),
    currency: store.state.currency,
    note: authorization.note,
    visibility: authorization.visibility,
    status: authorization.status,
    expires_at: authorization.expiresAt,
    payment_id: latest,
    payment_ids: [...authorization.paymentIds],
    created_at: authorization.createdAt,
  };
}

function requireAuthorization(id: string): Authorization {
  const authorization = store.state.authorizations.get(id);
  if (!authorization) throw notFound(`no authorization ${id}`);
  return authorization;
}

function notOpen() {
  return new ApiError(409, 'authorization_not_open', 'authorization is no longer open');
}

export const createAuthorization = authed((ctx, user) => {
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const state = store.state;
    const toHandle = readRequiredString(body, 'to_handle');
    const amount = readAmount(body);
    const note = readNote(body);
    const visibility = readVisibility(body);
    const recipient = resolveOtherUser(user, toHandle, 'self_payment');
    if (availableFunds(state, user) < amount) throw insufficientFunds();

    const createdMs = Date.now();
    const authorization: Authorization = {
      id: nextId(state, 'authorization'),
      fromUserId: user.id,
      toUserId: recipient.id,
      amount,
      capturedAmount: 0,
      note,
      visibility,
      status: 'open',
      expiresAt: formatInstant(createdMs + state.authorizationTtlSeconds * 1000),
      paymentIds: [],
      createdAt: formatInstant(createdMs),
    };
    state.authorizations.set(authorization.id, authorization);
    return authorizationView(authorization);
  });
});

interface CaptureRequest {
  amount: number | undefined;
  final: boolean;
}

function readCapture(body: JsonObject): CaptureRequest {
  const final = body.final;
  if (final !== undefined && typeof final !== 'boolean') throw malformed('final must be a boolean');
  const amount = body.amount;
  if (amount !== undefined && (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1)) {
    throw validation('amount must be an integer of at least 1');
  }
  return { amount, final: final ?? true };
}

export const captureAuthorization = authed((ctx, user, [id]) => {
  const body = parseOptionalJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const authorization = requireAuthorization(id);
    if (authorization.toUserId !== user.id) throw forbidden('only the receiver may capture');
    if (authorization.status === 'expired') {
      throw new ApiError(409, 'authorization_expired', 'authorization has expired');
    }
    if (authorization.status !== 'open') throw notOpen();
    const request = readCapture(body);
    const remaining = remainingAmount(authorization);
    const amount = request.amount ?? remaining;
    if (amount > remaining) {
      throw new ApiError(422, 'capture_exceeds_authorization', 'amount is above the uncaptured remainder');
    }

    const payment = recordPayment({
      from: userById(authorization.fromUserId),
      to: user,
      amount,
      note: authorization.note,
      visibility: authorization.visibility,
      requestId: null,
      settlementId: null,
      authorizationId: authorization.id,
      createdAt: nowRfc3339(),
    });
    authorization.capturedAmount += amount;
    authorization.paymentIds.push(payment.id);
    if (request.final || authorization.capturedAmount === authorization.amount) {
      authorization.status = 'captured';
    }
    return paymentView(payment);
  });
});

export const voidAuthorization = authed((_ctx, user, [id]) => {
  const authorization = requireAuthorization(id);
  if (authorization.fromUserId !== user.id) throw forbidden('only the payer may void');
  if (authorization.status === 'open') authorization.status = 'voided';
  else if (authorization.status !== 'voided') throw notOpen();
  return json(200, authorizationView(authorization));
});

export const listAuthorizations = authed((ctx, user) => {
  const paging = readPaging(ctx.query);
  const direction = readEnum(ctx.query, 'direction', DIRECTIONS);
  const status: AuthorizationStatus | undefined = readEnum(ctx.query, 'status', STATUSES);
  const matching = [...store.state.authorizations.values()]
    .filter((authorization) => {
      const outgoing = authorization.fromUserId === user.id;
      const incoming = authorization.toUserId === user.id;
      if (direction === 'outgoing' ? !outgoing : direction === 'incoming' ? !incoming : !outgoing && !incoming) {
        return false;
      }
      return status === undefined || authorization.status === status;
    })
    .reverse();
  const { items, hasMore } = page(matching, paging);
  return json(200, { authorizations: items.map(authorizationView), has_more: hasMore });
});
