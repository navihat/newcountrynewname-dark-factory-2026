import { api, describeError, isSuccess, NetworkError } from '../api.js';
import { moneyOf } from '../data.js';
import { el, field, replaceChildren } from '../dom.js';
import { characterCount, cleanHandle } from '../format.js';
import { mountPage, walletCard } from '../layout.js';
import { equalShares, formatAmount, parseAmount } from '../money.js';
import { noticeSlot } from '../notice.js';

const MAX_NOTE_LENGTH = 200;

function parseHandles(text: string): string[] {
  return text
    .split(',')
    .map(cleanHandle)
    .filter((handle) => handle !== '');
}

export function renderSplit(): void {
  const page = mountPage({ title: 'Split a bill', path: '/split', requiresSession: true });
  if (!page) return;
  const { main, wallet } = page;

  const amount = el('input', { type: 'text', testid: 'split-amount', name: 'amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
  const handles = el('input', { type: 'text', testid: 'split-handles', name: 'handles', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'ada, bob, cy' });
  const note = el('input', { type: 'text', testid: 'split-note', name: 'note', autocomplete: 'off', placeholder: 'What was it for? (optional)' });
  const submit = el('button', { type: 'submit', class: 'button primary', testid: 'split-submit', text: 'Split and request' });
  const preview = el('div', { class: 'preview', testid: 'split-preview', 'aria-live': 'polite' });
  const notices = noticeSlot();
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    field('Total amount you paid', amount),
    field('Who shares it', handles, 'Separate handles with commas. The extra cent goes to whoever is listed first.'),
    field('Note', note),
    el('h3', { class: 'subhead', text: 'Preview' }),
    preview,
    submit,
    notices.element,
  );

  /** The shares the server will compute, or the reason there is nothing to preview yet. */
  function compute(): { shares: { handle: string; minor: number }[] } | { hint: string } {
    const me = wallet.state.data;
    if (!me) return { hint: 'Loading your wallet…' };
    if (amount.value.trim() === '' && handles.value.trim() === '') return { hint: 'Enter an amount and who shares it to see each share.' };
    const parsed = parseAmount(amount.value, moneyOf(me));
    if (!parsed.ok) return { hint: parsed.error };
    const people = parseHandles(handles.value);
    if (people.length === 0) return { hint: 'Add at least one handle.' };
    if (new Set(people).size !== people.length) return { hint: 'Each handle can appear only once.' };
    const shares = equalShares(parsed.minor, people.length);
    return { shares: people.map((handle, index) => ({ handle, minor: shares[index] })) };
  }

  function renderPreview(): void {
    const me = wallet.state.data;
    const result = compute();
    if ('hint' in result || !me) {
      replaceChildren(preview, [el('p', { class: 'hint', text: 'hint' in result ? result.hint : '' })]);
      return;
    }
    const money = moneyOf(me);
    replaceChildren(preview, [
      el(
        'ul',
        { class: 'shares' },
        ...result.shares.map((share) =>
          el(
            'li',
            {},
            el('span', { class: 'share-handle', text: share.handle }),
            el('span', { class: 'share-amount', testid: `split-share-${share.handle}`, text: formatAmount(share.minor, money) }),
          ),
        ),
      ),
    ]);
  }
  form.addEventListener('input', renderPreview);
  wallet.subscribe(renderPreview);

  let busy = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) void send();
  });

  async function send(): Promise<void> {
    const me = wallet.state.data;
    const fail = (text: string) => notices.show('error', 'split-error', text);
    if (!me) return fail('Your wallet is still loading. Please try again in a moment.');
    const parsed = parseAmount(amount.value, moneyOf(me));
    if (!parsed.ok) return fail(parsed.error);
    const people = parseHandles(handles.value);
    if (people.length === 0) return fail('Add at least one handle.');
    if (new Set(people).size !== people.length) return fail('Each handle can appear only once.');
    if (characterCount(note.value) > MAX_NOTE_LENGTH) return fail(`Notes can have at most ${MAX_NOTE_LENGTH} characters.`);

    busy = true;
    submit.disabled = true;
    try {
      const result = await api('POST', '/splits', {
        body: { amount: parsed.minor, participant_handles: people, note: note.value },
        key: crypto.getRandomValues(new Uint32Array(4)).join('-'),
      });
      if (isSuccess(result)) {
        const count = result.body.requests.length;
        notices.show('success', 'split-success', `Split created. ${count} ${count === 1 ? 'request was' : 'requests were'} sent.`);
        await wallet.refresh();
      } else {
        fail(describeError(result));
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      fail('We could not confirm whether the split was created. Check your requests before trying again.');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  }

  main.append(
    el('h1', { class: 'page-title', text: 'Split a bill' }),
    el(
      'div',
      { class: 'columns' },
      el('div', { class: 'stack' }, walletCard(wallet)),
      el('div', { class: 'stack' }, el('section', { class: 'card', 'aria-label': 'Split form' }, el('h2', { text: 'Split a bill' }), el('p', { class: 'intro', text: 'You already paid. Ask everyone else for their equal share.' }), form)),
    ),
  );
  renderPreview();
}
