import { ApiError, forbidden, notFound } from '../errors';
import { authed, parseJsonObject } from '../http';
import { runIdempotent } from '../idempotency';
import { currentRevision, refundedAmount } from '../ledger';
import { store } from '../state';
import { nowRfc3339 } from '../util';
import { readAmount } from '../validation';
import { paymentView, recordPayment, requireFunds, userById } from '../wallet';
import { refundExceedsPayment } from './corrections';

export const refundPayment = authed((ctx, user, [id]) => {
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const state = store.state;
    const target = state.payments.get(id);
    if (!target) throw notFound(`no payment ${id}`);
    if (target.toUserId !== user.id) throw forbidden('only the receiver may refund a payment');
    const amount = readAmount(body);
    if (target.refundOf !== null) throw new ApiError(422, 'invalid_refund_target', 'a refund cannot be refunded');
    if (refundedAmount(state, target.id) + amount > currentRevision(target).amount) throw refundExceedsPayment();
    requireFunds(user, amount);

    const refund = recordPayment({
      from: user,
      to: userById(target.fromUserId),
      amount,
      note: target.note,
      visibility: target.visibility,
      requestId: null,
      settlementId: null,
      authorizationId: null,
      refundOf: target.id,
      createdAt: nowRfc3339(),
    });
    return paymentView(refund);
  });
});
