import { session } from './api.js';
import { createWallet, moneyOf, type Me } from './data.js';
import { el, replaceChildren } from './dom.js';
import { formatAmount } from './money.js';
import type { Resource } from './resource.js';

interface NavLink {
  href: string;
  label: string;
}

const NAV: NavLink[] = [
  { href: '/', label: 'Wallet' },
  { href: '/requests', label: 'Requests' },
  { href: '/split', label: 'Split' },
  { href: '/authorizations', label: 'Holds' },
];

export interface MountedPage {
  main: HTMLElement;
  wallet: Resource<Me>;
}

/**
 * Builds the common frame (header, navigation, signed-in user) and returns the main region for
 * the page to fill. Returns null when the page needs a session and there is none.
 */
export function mountPage(options: { title: string; path: string; requiresSession: boolean }): MountedPage | null {
  const signedIn = session.token !== null;
  if (options.requiresSession && !signedIn) {
    location.replace('/login');
    return null;
  }

  const wallet = createWallet();
  const userSlot = el('div', { class: 'user' });
  const main = el('main', { id: 'main', class: 'content', tabindex: '-1' });
  const header = el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'bar' },
      el('a', { class: 'brand', href: '/' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: 'P' }), 'Pocketful'),
      signedIn ? navigation(options.path) : null,
      userSlot,
    ),
  );

  const app = document.getElementById('app') as HTMLElement;
  replaceChildren(app, [header, main]);
  document.title = `${options.title} · Pocketful`;

  if (signedIn) {
    wallet.subscribe((state) => renderUser(userSlot, state.data));
    void wallet.refresh();
  } else {
    replaceChildren(userSlot, [
      el('a', { class: 'link', href: '/login', text: 'Log in' }),
      el('a', { class: 'link', href: '/signup', text: 'Sign up' }),
    ]);
  }
  return { main, wallet };
}

function navigation(activePath: string): HTMLElement {
  return el(
    'nav',
    { class: 'nav', 'aria-label': 'Main' },
    ...NAV.map((link) =>
      el('a', { href: link.href, 'aria-current': link.href === activePath ? 'page' : undefined, text: link.label }),
    ),
  );
}

function renderUser(slot: HTMLElement, me: Me | undefined): void {
  const logout = el('button', { type: 'button', class: 'button quiet', testid: 'logout-button', text: 'Log out' });
  logout.addEventListener('click', () => {
    session.end();
    location.assign('/login');
  });
  replaceChildren(slot, [
    me
      ? el(
          'span',
          { class: 'who' },
          el('span', { class: 'who-name', testid: 'current-user', text: me.display_name }),
          el('span', { class: 'who-handle' }, '@', el('span', { testid: 'current-handle', text: me.handle })),
        )
      : el('span', { class: 'who who-loading', text: 'Signing in…' }),
    logout,
  ]);
}

/** The wallet summary: available funds are the headline, total and held are secondary. */
export function walletCard(wallet: Resource<Me>, actions: HTMLElement | null = null): HTMLElement {
  const body = el('div', { class: 'wallet-body' });
  const card = el(
    'section',
    { class: 'card wallet', 'aria-label': 'Wallet' },
    el('div', { class: 'card-head' }, el('h2', { text: 'Your wallet' }), actions),
    body,
  );

  wallet.subscribe((state) => {
    card.setAttribute('aria-busy', String(state.refreshing));
    const me = state.data;
    if (!me) {
      replaceChildren(body, [
        state.status === 'error'
          ? el(
              'div',
              { class: 'notice notice-error', role: 'alert' },
              `We could not load your balance. ${state.error ?? ''}`,
              retryButton(wallet),
            )
          : el('p', { class: 'loading', text: 'Loading your balance…' }),
      ]);
      return;
    }
    const money = moneyOf(me);
    replaceChildren(body, [
      el('p', { class: 'eyebrow', text: 'Available to spend' }),
      el('p', {
        class: 'headline',
        testid: 'wallet-available',
        'data-amount': String(me.available),
        text: formatAmount(me.available, money),
      }),
      el(
        'dl',
        { class: 'subtotals' },
        el(
          'div',
          {},
          el('dt', { text: 'Total balance' }),
          el('dd', { testid: 'wallet-balance', 'data-amount': String(me.total), text: formatAmount(me.total, money) }),
        ),
        me.held > 0
          ? el(
              'div',
              { class: 'held' },
              el('dt', { text: 'On hold' }),
              el('dd', { testid: 'wallet-held', 'data-amount': String(me.held), text: formatAmount(me.held, money) }),
            )
          : null,
      ),
      state.status === 'error'
        ? el('p', { class: 'notice notice-error', role: 'alert' }, 'Could not refresh. Showing the last known balance. ', retryButton(wallet))
        : null,
    ]);
  });
  return card;
}

export function retryButton(resource: Resource<unknown>): HTMLElement {
  const button = el('button', { type: 'button', class: 'button small', text: 'Try again' });
  button.addEventListener('click', () => void resource.refresh());
  return button;
}
