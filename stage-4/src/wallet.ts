import { forbidden, insufficientFunds, notFound, ApiError } from './errors';
import { availableFunds } from './holds';
import {
  findUserByHandle,
  nextId,
  store,
  type Payment,
  type PaymentRequest,
  type User,
  type Visibility,
} from './state';

export function userById(id: string): User {
  const user = store.state.users.get(id);
  if (!user) throw new Error(`dangling user reference ${id}`);
  return user;
}

/** The payment as a receipt; `amount` overrides the original amount (statements show the selected revision). */
export function paymentView(payment: Payment, amount: number = payment.amount) {
  const from = userById(payment.fromUserId);
  const to = userById(payment.toUserId);
  return {
    payment_id: payment.id,
    from_user_id: from.id,
    from_handle: from.handle,
    to_user_id: to.id,
    to_handle: to.handle,
    amount,
    currency: store.state.currency,
    note: payment.note,
    visibility: payment.visibility,
    request_id: payment.requestId,
    settlement_id: payment.settlementId,
    authorization_id: payment.authorizationId,
    refund_of: payment.refundOf,
    created_at: payment.createdAt,
  };
}

export function requestView(request: PaymentRequest) {
  const requester = userById(request.requesterId);
  const payer = userById(request.payerId);
  return {
    request_id: request.id,
    requester_id: requester.id,
    requester_handle: requester.handle,
    payer_id: payer.id,
    payer_handle: payer.handle,
    amount: request.amount,
    currency: store.state.currency,
    note: request.note,
    status: request.status,
    payment_id: request.paymentId,
    created_at: request.createdAt,
  };
}

/** The user behind a handle; the caller's own handle is rejected with `selfCode`. */
export function resolveOtherUser(caller: User, handle: string, selfCode: 'self_payment' | 'self_request'): User {
  if (handle === caller.handle) {
    throw new ApiError(422, selfCode, 'the other party must not be yourself');
  }
  return resolveUser(handle);
}

export function resolveUser(handle: string): User {
  const user = findUserByHandle(store.state, handle);
  if (!user) throw notFound(`no user has handle "${handle}"`);
  return user;
}

export function requireFunds(user: User, amount: number): void {
  if (availableFunds(store.state, user) < amount) throw insufficientFunds();
}

export interface PaymentDraft {
  from: User;
  to: User;
  amount: number;
  note: string;
  visibility: Visibility;
  requestId: string | null;
  settlementId: string | null;
  authorizationId?: string | null;
  refundOf?: string | null;
  createdAt: string;
}

/** Moves the money and records the payment. The caller has already checked the funds. */
export function recordPayment(draft: PaymentDraft): Payment {
  const state = store.state;
  draft.from.balance -= draft.amount;
  draft.to.balance += draft.amount;
  const payment: Payment = {
    id: nextId(state, 'payment'),
    fromUserId: draft.from.id,
    toUserId: draft.to.id,
    amount: draft.amount,
    note: draft.note,
    visibility: draft.visibility,
    requestId: draft.requestId,
    settlementId: draft.settlementId,
    authorizationId: draft.authorizationId ?? null,
    refundOf: draft.refundOf ?? null,
    createdAt: draft.createdAt,
    revisions: [
      { revision: 1, amount: draft.amount, effectiveAt: draft.createdAt, recordedAt: draft.createdAt, reason: '', batchId: null },
    ],
  };
  state.payments.set(payment.id, payment);
  return payment;
}

export function requireRequest(id: string): PaymentRequest {
  const request = store.state.requests.get(id);
  if (!request) throw notFound(`no request ${id}`);
  return request;
}

export function requireParty(user: User, partyId: string, role: 'payer' | 'requester'): void {
  if (user.id !== partyId) throw forbidden(`only the ${role} may do this`);
}
