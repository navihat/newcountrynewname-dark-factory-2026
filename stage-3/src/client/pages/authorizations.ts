import { api, describeError, isSuccess, isUncertain, NetworkError } from '../api.js';
import { createAuthorizationList, moneyOf, type Authorization, type Me } from '../data.js';
import { el, replaceChildren } from '../dom.js';
import { createActionForm, authorizeOptions } from '../forms.js';
import { formatTime, STATUS_LABEL } from '../format.js';
import { mountPage, retryButton, walletCard } from '../layout.js';
import { formatAmount, formatDecimal, parseAmount } from '../money.js';
import { noticeSlot } from '../notice.js';
import { Submission } from '../submission.js';

export function renderAuthorizations(): void {
  const page = mountPage({ title: 'Holds', path: '/authorizations', requiresSession: true });
  if (!page) return;
  const { main, wallet } = page;
  const list = createAuthorizationList();
  const notices = noticeSlot();
  const captures = new Map<string, Submission>();

  const refresh = async () => {
    await Promise.all([wallet.refresh(), list.refresh()]);
  };
  const fail = (text: string) => notices.show('error', 'authorization-error', text);

  async function capture(authorization: Authorization, me: Me, input: HTMLInputElement): Promise<void> {
    const id = authorization.authorization_id;
    const parsed = parseAmount(input.value, moneyOf(me));
    if (!parsed.ok) return fail(parsed.error);
    const submission = captures.get(id) ?? new Submission();
    captures.set(id, submission);
    const body = { amount: parsed.minor };
    const fingerprint = JSON.stringify(body);
    const plan = submission.plan(fingerprint);
    const unsure = 'We could not confirm whether the capture went through. Press Capture again to check: it will happen only once.';
    try {
      const result = await api('POST', `/authorizations/${encodeURIComponent(id)}/capture`, { body, key: plan.key });
      if (isSuccess(result)) {
        submission.succeeded(fingerprint);
        notices.show('success', 'authorization-success', 'Captured. The money is in your wallet.');
      } else if (isUncertain(result)) {
        submission.uncertain(fingerprint, plan.key);
        return fail(unsure);
      } else {
        submission.refused();
        fail(describeError(result));
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      submission.uncertain(fingerprint, plan.key);
      return fail(unsure);
    }
    await refresh();
  }

  async function release(id: string): Promise<void> {
    try {
      const result = await api('POST', `/authorizations/${encodeURIComponent(id)}/void`);
      if (isSuccess(result)) notices.show('success', 'authorization-success', 'Hold released.');
      else fail(describeError(result));
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      return fail('We could not reach the server. Please try again.');
    }
    await refresh();
  }

  const refreshButton = el('button', { type: 'button', class: 'button small', testid: 'authorizations-refresh', text: 'Refresh' });
  refreshButton.addEventListener('click', () => void refresh());

  const body = el('div', {});
  const listCard = el('section', { class: 'card', 'aria-label': 'Holds' }, el('div', { class: 'card-head' }, el('h2', { text: 'Holds' }), refreshButton), notices.element, body);
  const render = () => {
    const me = wallet.state.data;
    const items = list.state.data;
    listCard.setAttribute('aria-busy', String(list.state.refreshing));
    if (!items || !me) {
      replaceChildren(body, [
        list.state.status === 'error'
          ? el('div', { class: 'notice notice-error', role: 'alert' }, `We could not load your holds. ${list.state.error ?? ''}`, retryButton(list))
          : el('p', { class: 'loading', text: 'Loading holds…' }),
      ]);
      return;
    }
    replaceChildren(body, [
      list.state.status === 'error' ? el('div', { class: 'notice notice-error', role: 'alert' }, 'Could not refresh. Showing earlier results. ', retryButton(list)) : null,
      items.length === 0
        ? el('div', { class: 'empty', testid: 'empty-authorizations' }, el('p', { class: 'empty-title', text: 'No holds yet' }), el('p', { text: 'Money you reserve for someone, or that someone reserves for you, will appear here.' }))
        : null,
      el('ul', { class: 'items', testid: 'authorization-list' }, ...items.map((item) => authorizationItem(item, me, { capture, release }))),
    ]);
  };
  list.subscribe(render);
  wallet.subscribe(render);

  main.append(
    el('h1', { class: 'page-title', text: 'Holds' }),
    el(
      'div',
      { class: 'columns' },
      el('div', { class: 'stack' }, walletCard(wallet), createActionForm(authorizeOptions(), wallet, refresh)),
      el('div', { class: 'stack' }, listCard),
    ),
  );
  void list.refresh();
}

interface Actions {
  capture(authorization: Authorization, me: Me, input: HTMLInputElement): Promise<void>;
  release(id: string): Promise<void>;
}

function authorizationItem(authorization: Authorization, me: Me, actions: Actions): HTMLElement {
  const id = authorization.authorization_id;
  const money = moneyOf(me);
  const incoming = authorization.to_handle === me.handle;
  const outgoing = authorization.from_handle === me.handle;
  const open = authorization.status === 'open';
  const other = incoming ? authorization.from_handle : authorization.to_handle;

  const controls: HTMLElement[] = [];
  if (open && incoming) {
    const input = el('input', {
      type: 'text',
      testid: `authorization-capture-amount-${id}`,
      inputmode: 'decimal',
      autocomplete: 'off',
      value: formatDecimal(authorization.remaining_amount, money),
    });
    const capture = el('button', { type: 'button', class: 'button primary small', testid: `authorization-capture-${id}`, text: 'Capture' });
    capture.addEventListener('click', () => void actions.capture(authorization, me, input));
    controls.push(el('label', { class: 'inline-field' }, `Capture (${money.currency})`, input), capture);
  }
  if (open && outgoing) {
    const release = el('button', { type: 'button', class: 'button small', testid: `authorization-void-${id}`, text: 'Release hold' });
    release.addEventListener('click', () => void actions.release(id));
    controls.push(release);
  }

  return el(
    'li',
    { class: `item authorization status-${authorization.status}`, testid: `authorization-item-${id}`, 'data-status': authorization.status },
    el(
      'div',
      { class: 'item-main' },
      el('p', { class: 'parties', text: incoming ? `${other} reserved funds for you` : `You reserved funds for ${other}` }),
      el('p', { class: 'amount-line', testid: `authorization-amount-${id}`, text: formatAmount(authorization.amount, money) }),
      authorization.note ? el('p', { class: 'note', text: authorization.note }) : null,
      el(
        'p',
        { class: 'meta' },
        el('span', { class: `pill pill-${authorization.status}`, text: STATUS_LABEL[authorization.status] }),
        el('span', { class: `pill pill-${authorization.visibility}`, text: authorization.visibility === 'private' ? 'Private' : 'Public' }),
        open && authorization.captured_amount > 0
          ? el('span', { class: 'detail', text: `${formatAmount(authorization.remaining_amount, money)} still held` })
          : null,
      ),
      authorization.status === 'captured'
        ? el('p', { class: 'detail' }, 'Captured ', el('span', { testid: `authorization-captured-${id}`, text: formatAmount(authorization.captured_amount, money) }))
        : null,
      el('p', { class: 'detail' }, 'Expires ', el('time', { datetime: authorization.expires_at, title: formatTime(authorization.expires_at), testid: `authorization-expires-${id}`, text: authorization.expires_at })),
    ),
    controls.length > 0 ? el('div', { class: 'item-actions' }, ...controls) : null,
  );
}
