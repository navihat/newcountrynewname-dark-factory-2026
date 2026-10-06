import { api, describeError, isSuccess, isUncertain, NetworkError } from '../api.js';
import { createRequestList, moneyOf, type Me, type PaymentRequest } from '../data.js';
import { el, replaceChildren, visibilitySelect } from '../dom.js';
import { formatTime, STATUS_LABEL } from '../format.js';
import { mountPage, retryButton, walletCard } from '../layout.js';
import { formatAmount } from '../money.js';
import { noticeSlot } from '../notice.js';
import type { Resource } from '../resource.js';
import { Submission } from '../submission.js';

type Direction = 'incoming' | 'outgoing';

export function renderRequests(): void {
  const page = mountPage({ title: 'Requests', path: '/requests', requiresSession: true });
  if (!page) return;
  const { main, wallet } = page;
  const incoming = createRequestList('incoming');
  const outgoing = createRequestList('outgoing');
  const notices = noticeSlot();
  const pays = new Map<string, Submission>();

  const refresh = async () => {
    await Promise.all([wallet.refresh(), incoming.refresh(), outgoing.refresh()]);
  };
  const fail = (text: string) => notices.show('error', 'request-error', text);

  async function pay(id: string, visibility: string): Promise<void> {
    const submission = pays.get(id) ?? new Submission();
    pays.set(id, submission);
    const body = { visibility };
    const fingerprint = JSON.stringify(body);
    const plan = submission.plan(fingerprint);
    try {
      const result = await api('POST', `/requests/${encodeURIComponent(id)}/pay`, { body, key: plan.key });
      if (isSuccess(result)) {
        submission.succeeded(fingerprint);
        notices.show('success', 'request-success', 'Request paid.');
      } else if (isUncertain(result)) {
        submission.uncertain(fingerprint, plan.key);
        fail('We could not confirm whether the payment went through. Press Pay again to check: it will be sent only once.');
        return;
      } else {
        submission.refused();
        fail(describeError(result));
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      submission.uncertain(fingerprint, plan.key);
      fail('We could not confirm whether the payment went through. Press Pay again to check: it will be sent only once.');
      return;
    }
    await refresh();
  }

  async function close(id: string, action: 'decline' | 'cancel'): Promise<void> {
    try {
      const result = await api('POST', `/requests/${encodeURIComponent(id)}/${action}`);
      if (isSuccess(result)) notices.show('success', 'request-success', action === 'decline' ? 'Request declined.' : 'Request cancelled.');
      else fail(describeError(result));
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      fail('We could not reach the server. Please try again.');
      return;
    }
    await refresh();
  }

  const actions = { pay, close };
  const empty = el('div', { class: 'card empty', testid: 'empty-requests' }, el('p', { class: 'empty-title', text: 'No requests yet' }), el('p', { text: 'Requests you send or receive will appear here.' }));
  const emptyHolder = el('div', {});
  const update = () => {
    const bothEmpty =
      incoming.state.status === 'ready' && outgoing.state.status === 'ready' &&
      incoming.state.data?.length === 0 && outgoing.state.data?.length === 0;
    replaceChildren(emptyHolder, [bothEmpty ? empty : null]);
  };
  incoming.subscribe(update);
  outgoing.subscribe(update);

  main.append(
    el('h1', { class: 'page-title', text: 'Requests' }),
    notices.element,
    emptyHolder,
    el(
      'div',
      { class: 'columns' },
      el('div', { class: 'stack' }, walletCard(wallet)),
      el('div', { class: 'stack' }, requestSection('incoming', 'Asked of you', incoming, wallet, actions), requestSection('outgoing', 'You asked', outgoing, wallet, actions)),
    ),
  );
  void Promise.all([incoming.refresh(), outgoing.refresh()]);
}

interface Actions {
  pay(id: string, visibility: string): Promise<void>;
  close(id: string, action: 'decline' | 'cancel'): Promise<void>;
}

function requestSection(
  direction: Direction,
  title: string,
  list: Resource<PaymentRequest[]>,
  wallet: Resource<Me>,
  actions: Actions,
): HTMLElement {
  const container = el('ul', { class: 'items', testid: direction === 'incoming' ? 'incoming-list' : 'outgoing-list' });
  const status = el('div', {});
  const card = el('section', { class: 'card', 'aria-label': title }, el('h2', { text: title }), status, container);

  const render = () => {
    const me = wallet.state.data;
    const requests = list.state.data;
    card.setAttribute('aria-busy', String(list.state.refreshing));
    if (!requests || !me) {
      replaceChildren(status, [
        list.state.status === 'error'
          ? el('div', { class: 'notice notice-error', role: 'alert' }, `We could not load these requests. ${list.state.error ?? ''}`, retryButton(list))
          : el('p', { class: 'loading', text: 'Loading requests…' }),
      ]);
      replaceChildren(container, []);
      return;
    }
    replaceChildren(status, [
      list.state.status === 'error' ? el('div', { class: 'notice notice-error', role: 'alert' }, 'Could not refresh. Showing earlier results. ', retryButton(list)) : null,
      requests.length === 0 ? el('p', { class: 'quiet-empty', text: direction === 'incoming' ? 'Nobody has asked you for money.' : 'You have not asked anyone for money.' }) : null,
    ]);
    replaceChildren(container, requests.map((request) => requestItem(request, direction, me, actions)));
  };
  list.subscribe(render);
  wallet.subscribe(render);
  return card;
}

function requestItem(request: PaymentRequest, direction: Direction, me: Me, actions: Actions): HTMLElement {
  const id = request.request_id;
  const pending = request.status === 'pending';
  const other = direction === 'incoming' ? request.requester_handle : request.payer_handle;
  const visibility = visibilitySelect(`request-visibility-${id}`);
  visibility.setAttribute('aria-label', 'Visibility of your payment');
  const buttons: HTMLElement[] = [];

  if (pending && direction === 'incoming') {
    const pay = el('button', { type: 'button', class: 'button primary small', testid: `request-pay-${id}`, text: 'Pay' });
    pay.addEventListener('click', () => void actions.pay(id, visibility.value));
    const decline = el('button', { type: 'button', class: 'button small', testid: `request-decline-${id}`, text: 'Decline' });
    decline.addEventListener('click', () => void actions.close(id, 'decline'));
    buttons.push(pay, decline);
  }
  if (pending && direction === 'outgoing') {
    const cancel = el('button', { type: 'button', class: 'button small', testid: `request-cancel-${id}`, text: 'Cancel request' });
    cancel.addEventListener('click', () => void actions.close(id, 'cancel'));
    buttons.push(cancel);
  }

  return el(
    'li',
    { class: `item request status-${request.status}`, testid: `request-item-${id}`, 'data-status': request.status },
    el(
      'div',
      { class: 'item-main' },
      el('p', { class: 'parties', text: direction === 'incoming' ? `${other} asks you for` : `You asked ${other} for` }),
      el('p', { class: 'amount-line', testid: `request-amount-${id}`, text: formatAmount(request.amount, moneyOf(me)) }),
      request.note ? el('p', { class: 'note', text: request.note }) : null,
      el('p', { class: 'meta' }, el('span', { class: `pill pill-${request.status}`, text: STATUS_LABEL[request.status] }), el('time', { datetime: request.created_at, text: formatTime(request.created_at) })),
    ),
    buttons.length > 0
      ? el('div', { class: 'item-actions' }, direction === 'incoming' && pending ? el('label', { class: 'inline-field' }, 'Visibility', visibility) : null, ...buttons)
      : null,
  );
}
