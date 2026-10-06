import { ApiError } from '../errors';
import { authed, json, parseJsonObject, parseOptionalJsonObject } from '../http';
import { runIdempotent } from '../idempotency';
import { nextId, store, type PaymentRequest, type RequestStatus } from '../state';
import { nowRfc3339 } from '../util';
import {
  page,
  readAmount,
  readEnum,
  readNote,
  readPaging,
  readRequiredString,
  readVisibility,
} from '../validation';
import {
  paymentView,
  recordPayment,
  requestView,
  requireFunds,
  requireParty,
  requireRequest,
  resolveOtherUser,
  userById,
} from '../wallet';

const STATUSES = ['pending', 'paid', 'declined', 'cancelled'] as const;
const DIRECTIONS = ['incoming', 'outgoing'] as const;

export function openRequest(requesterId: string, payerId: string, amount: number, note: string, createdAt: string) {
  const request: PaymentRequest = {
    id: nextId(store.state, 'request'),
    requesterId,
    payerId,
    amount,
    note,
    status: 'pending',
    paymentId: null,
    createdAt,
  };
  store.state.requests.set(request.id, request);
  return request;
}

export const createRequest = authed((ctx, user) => {
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const payerHandle = readRequiredString(body, 'payer_handle');
    const amount = readAmount(body);
    const note = readNote(body);
    const payer = resolveOtherUser(user, payerHandle, 'self_request');
    return requestView(openRequest(user.id, payer.id, amount, note, nowRfc3339()));
  });
});

export const payRequest = authed((ctx, user, [id]) => {
  const body = parseOptionalJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const request = requireRequest(id);
    requireParty(user, request.payerId, 'payer');
    const visibility = readVisibility(body);
    if (request.status !== 'pending') throw notPending();
    requireFunds(user, request.amount);
    const payment = recordPayment({
      from: user,
      to: userById(request.requesterId),
      amount: request.amount,
      note: request.note,
      visibility,
      requestId: request.id,
      settlementId: null,
      createdAt: nowRfc3339(),
    });
    request.status = 'paid';
    request.paymentId = payment.id;
    return paymentView(payment);
  });
});

export const declineRequest = authed((_ctx, user, [id]) => {
  const request = requireRequest(id);
  requireParty(user, request.payerId, 'payer');
  return json(200, requestView(close(request, 'declined')));
});

export const cancelRequest = authed((_ctx, user, [id]) => {
  const request = requireRequest(id);
  requireParty(user, request.requesterId, 'requester');
  return json(200, requestView(close(request, 'cancelled')));
});

/** Moves a pending request to `status`; repeating the same close is a no-op. */
function close(request: PaymentRequest, status: 'declined' | 'cancelled'): PaymentRequest {
  if (request.status === status) return request;
  if (request.status !== 'pending') throw notPending();
  request.status = status;
  return request;
}

function notPending() {
  return new ApiError(409, 'request_not_pending', 'request is no longer pending');
}

export const listRequests = authed((ctx, user) => {
  const paging = readPaging(ctx.query);
  const direction = readEnum(ctx.query, 'direction', DIRECTIONS);
  const status: RequestStatus | undefined = readEnum(ctx.query, 'status', STATUSES);
  const matching = [...store.state.requests.values()]
    .filter((request) => {
      const incoming = request.payerId === user.id;
      const outgoing = request.requesterId === user.id;
      if (direction === 'incoming' ? !incoming : direction === 'outgoing' ? !outgoing : !incoming && !outgoing) {
        return false;
      }
      return status === undefined || request.status === status;
    })
    .reverse();
  const { items, hasMore } = page(matching, paging);
  return json(200, { requests: items.map(requestView), has_more: hasMore });
});
