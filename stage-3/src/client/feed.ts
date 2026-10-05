import type { Me, Payment } from './data.js';
import { moneyOf } from './data.js';
import { el, replaceChildren } from './dom.js';
import { formatTime } from './format.js';
import { formatAmount } from './money.js';
import type { Resource } from './resource.js';
import { retryButton } from './layout.js';

function relation(payment: Payment, me: Me): string {
  if (payment.from_handle === me.handle) return 'Sent';
  if (payment.to_handle === me.handle) return 'Received';
  return 'Public';
}

function activityItem(payment: Payment, me: Me): HTMLElement {
  const money = moneyOf(me);
  const id = payment.payment_id;
  const kind = relation(payment, me);
  const origin = payment.request_id ? 'Request paid' : payment.authorization_id ? 'Authorized payment' : null;
  return el(
    'li',
    { class: `item activity ${kind.toLowerCase()}`, testid: `activity-item-${id}`, 'data-visibility': payment.visibility },
    el(
      'div',
      { class: 'item-main' },
      el('p', { class: 'parties', testid: `activity-parties-${id}`, text: `${payment.from_handle} → ${payment.to_handle}` }),
      el('p', { class: 'note', testid: `activity-note-${id}`, text: payment.note }),
      el(
        'p',
        { class: 'meta' },
        el('span', { class: `pill pill-${kind.toLowerCase()}`, text: kind }),
        el('span', { class: `pill pill-${payment.visibility}`, text: payment.visibility === 'private' ? 'Private' : 'Public' }),
        origin ? el('span', { class: 'pill pill-origin', text: origin }) : null,
        el('time', { datetime: payment.created_at, text: formatTime(payment.created_at) }),
      ),
    ),
    el('p', { class: `amount ${kind.toLowerCase()}`, testid: `activity-amount-${id}`, text: formatAmount(payment.amount, money) }),
  );
}

/** The activity card; it needs the wallet for the currency, so it renders once both are loaded. */
export function feedCard(feed: Resource<Payment[]>, wallet: Resource<Me>): HTMLElement {
  const body = el('div', { class: 'feed-body' });
  const card = el('section', { class: 'card', 'aria-label': 'Activity' }, el('h2', { text: 'Activity' }), body);

  const render = () => {
    const me = wallet.state.data;
    const payments = feed.state.data;
    card.setAttribute('aria-busy', String(feed.state.refreshing));
    if (!payments || !me) {
      replaceChildren(body, [
        feed.state.status === 'error'
          ? el('div', { class: 'notice notice-error', role: 'alert' }, `We could not load your activity. ${feed.state.error ?? ''}`, retryButton(feed))
          : el('p', { class: 'loading', text: 'Loading activity…' }),
      ]);
      return;
    }
    replaceChildren(body, [
      feed.state.status === 'error'
        ? el('div', { class: 'notice notice-error', role: 'alert' }, 'Could not refresh. Showing earlier activity. ', retryButton(feed))
        : null,
      payments.length === 0
        ? el('div', { class: 'empty', testid: 'empty-activity' }, el('p', { class: 'empty-title', text: 'No activity yet' }), el('p', { text: 'Payments you send or receive, and public payments, will show up here.' }))
        : el('ul', { class: 'items', testid: 'activity-list' }, ...payments.map((payment) => activityItem(payment, me))),
    ]);
  };
  feed.subscribe(render);
  wallet.subscribe(render);
  return card;
}
