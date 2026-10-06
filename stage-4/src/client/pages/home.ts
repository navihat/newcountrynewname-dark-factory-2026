import { createFeed } from '../data.js';
import { el } from '../dom.js';
import { feedCard } from '../feed.js';
import { authorizeOptions, createActionForm } from '../forms.js';
import { mountPage, walletCard } from '../layout.js';

export function renderHome(): void {
  const page = mountPage({ title: 'Wallet', path: '/', requiresSession: true });
  if (!page) return;
  const { main, wallet } = page;
  const feed = createFeed();

  const refresh = async () => {
    await Promise.all([wallet.refresh(), feed.refresh()]);
  };

  const refreshButton = el('button', { type: 'button', class: 'button small', testid: 'wallet-refresh', text: 'Refresh' });
  refreshButton.addEventListener('click', () => void refresh());

  const pay = createActionForm(
    {
      ids: {
        handle: 'pay-handle',
        amount: 'pay-amount',
        note: 'pay-note',
        visibility: 'pay-visibility',
        submit: 'pay-submit',
        error: 'pay-error',
        uncertain: 'pay-uncertain',
        success: 'pay-success',
      },
      title: 'Send money',
      intro: 'Pay someone by handle. The money moves right away.',
      endpoint: '/payments',
      handleField: 'to_handle',
      handleLabel: 'Recipient handle',
      amountLabel: 'Amount',
      submitLabel: 'Send money',
      successText: 'Payment sent.',
      uncertainText:
        'We could not confirm whether this payment went through. Press Send money again to check: it will be sent only once.',
      withVisibility: true,
      ignoreUnchanged: true,
    },
    wallet,
    refresh,
  );
  const request = createActionForm(
    {
      ids: {
        handle: 'request-handle',
        amount: 'request-amount',
        note: 'request-note',
        visibility: 'request-visibility',
        submit: 'request-submit',
        error: 'request-error',
        uncertain: 'request-uncertain',
        success: 'request-success',
      },
      title: 'Request money',
      intro: 'Ask someone to pay you. They decide whether and when to pay.',
      endpoint: '/requests',
      handleField: 'payer_handle',
      handleLabel: 'Ask this handle',
      amountLabel: 'Amount',
      submitLabel: 'Request money',
      successText: 'Request sent.',
      uncertainText: 'We could not confirm whether the request was created. Press Request money again to check.',
      withVisibility: false,
      ignoreUnchanged: false,
    },
    wallet,
    refresh,
  );
  const authorize = createActionForm(authorizeOptions(), wallet, refresh);

  main.append(
    el('h1', { class: 'page-title', text: 'Wallet' }),
    el(
      'div',
      { class: 'columns' },
      el('div', { class: 'stack' }, walletCard(wallet, refreshButton), pay, request, authorize),
      el('div', { class: 'stack' }, feedCard(feed, wallet)),
    ),
  );
  void feed.refresh();
}
