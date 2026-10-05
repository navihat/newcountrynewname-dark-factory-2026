import { authed, parseJsonObject } from '../http';
import { runIdempotent } from '../idempotency';
import { nowRfc3339 } from '../util';
import { readAmount, readNote, readRequiredString, readVisibility } from '../validation';
import { paymentView, recordPayment, requireFunds, resolveOtherUser } from '../wallet';

export const createPayment = authed((ctx, user) => {
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const toHandle = readRequiredString(body, 'to_handle');
    const amount = readAmount(body);
    const note = readNote(body);
    const visibility = readVisibility(body);
    const recipient = resolveOtherUser(user, toHandle, 'self_payment');
    requireFunds(user, amount);
    const payment = recordPayment({
      from: user,
      to: recipient,
      amount,
      note,
      visibility,
      requestId: null,
      settlementId: null,
      createdAt: nowRfc3339(),
    });
    return paymentView(payment);
  });
});
