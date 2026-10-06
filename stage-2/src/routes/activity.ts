import { authed, json } from '../http';
import { store } from '../state';
import { page, readPaging } from '../validation';
import { paymentView } from '../wallet';

export const activity = authed((ctx, user) => {
  const paging = readPaging(ctx.query);
  const visible = [...store.state.payments.values()]
    .filter((p) => p.visibility === 'public' || p.fromUserId === user.id || p.toUserId === user.id)
    .reverse();
  const { items, hasMore } = page(visible, paging);
  return json(200, { payments: items.map(paymentView), has_more: hasMore });
});
