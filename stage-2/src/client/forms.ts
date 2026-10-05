import { api, describeError, isSuccess, isUncertain, NetworkError } from './api.js';
import { moneyOf, type Me } from './data.js';
import { el, field, visibilitySelect } from './dom.js';
import { characterCount, cleanHandle } from './format.js';
import { parseAmount } from './money.js';
import { noticeSlot } from './notice.js';
import type { Resource } from './resource.js';
import { Submission } from './submission.js';

const MAX_NOTE_LENGTH = 200;

export interface FormTestIds {
  handle: string;
  amount: string;
  note: string;
  visibility: string;
  submit: string;
  error: string;
  uncertain: string;
  success: string;
}

export interface ActionFormOptions {
  ids: FormTestIds;
  title: string;
  intro: string;
  endpoint: string;
  /** Body field that carries the other person's handle. */
  handleField: 'to_handle' | 'payer_handle';
  handleLabel: string;
  amountLabel: string;
  submitLabel: string;
  successText: string;
  uncertainText: string;
  withVisibility: boolean;
  /** When true, submitting an unchanged form again does nothing (it was already done). */
  ignoreUnchanged: boolean;
}

/**
 * One form that sends a single money action. Retries after a lost response reuse the idempotency
 * key, an unchanged form is not sent twice, and the page refreshes after every outcome.
 */
export function createActionForm(
  options: ActionFormOptions,
  wallet: Resource<Me>,
  refresh: () => Promise<void>,
): HTMLElement {
  const { ids } = options;
  const handle = el('input', { type: 'text', testid: ids.handle, name: 'handle', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'e.g. bob' });
  const amount = el('input', { type: 'text', testid: ids.amount, name: 'amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
  const note = el('input', { type: 'text', testid: ids.note, name: 'note', autocomplete: 'off', placeholder: 'What is it for? (optional)' });
  const visibility = options.withVisibility ? visibilitySelect(ids.visibility) : null;
  const submit = el('button', { type: 'submit', class: 'button primary', testid: ids.submit, text: options.submitLabel });
  const notices = noticeSlot();
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    field(options.handleLabel, handle),
    field(options.amountLabel, amount),
    field('Note', note),
    visibility ? field('Visibility', visibility) : null,
    submit,
    notices.element,
  );
  const card = el('section', { class: 'card', 'aria-label': options.title }, el('h2', { text: options.title }), el('p', { class: 'intro', text: options.intro }), form);

  const submission = new Submission();
  let busy = false;
  const fail = (text: string) => notices.show('error', ids.error, text);

  const onEdit = () => submission.edited(readBody().body ? JSON.stringify(readBody().body) : null);
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) void send();
  });

  /** The request body from the form, or the message to show when the form is not valid. */
  function readBody(): { body: Record<string, unknown>; error: '' } | { body: null; error: string } {
    const me = wallet.state.data;
    if (!me) return { body: null, error: 'Your wallet is still loading. Please try again in a moment.' };
    const otherHandle = cleanHandle(handle.value);
    if (otherHandle === '') return { body: null, error: 'Enter the handle of the person.' };
    const parsed = parseAmount(amount.value, moneyOf(me));
    if (!parsed.ok) return { body: null, error: parsed.error };
    if (characterCount(note.value) > MAX_NOTE_LENGTH) {
      return { body: null, error: `Notes can have at most ${MAX_NOTE_LENGTH} characters.` };
    }
    const body: Record<string, unknown> = { [options.handleField]: otherHandle, amount: parsed.minor, note: note.value };
    if (visibility) body.visibility = visibility.value;
    return { body, error: '' };
  }

  async function send(): Promise<void> {
    const { body, error } = readBody();
    if (!body) return fail(error);
    const fingerprint = JSON.stringify(body);
    const plan = submission.plan(fingerprint);
    if (plan.duplicate) return;

    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      const result = await api('POST', options.endpoint, { body, key: plan.key });
      if (isSuccess(result)) {
        submission.succeeded(fingerprint);
        if (!options.ignoreUnchanged) submission.forgetSettled();
        notices.show('success', ids.success, options.successText);
        await refresh();
      } else if (isUncertain(result)) {
        submission.uncertain(fingerprint, plan.key);
        notices.show('uncertain', ids.uncertain, options.uncertainText);
      } else {
        submission.refused();
        fail(describeError(result));
        await refresh();
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      submission.uncertain(fingerprint, plan.key);
      notices.show('uncertain', ids.uncertain, options.uncertainText);
    } finally {
      busy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  }
  return card;
}

/** The form that places a hold; shared by the wallet and holds screens. */
export function authorizeOptions(): ActionFormOptions {
  return {
    ids: {
      handle: 'authorize-handle',
      amount: 'authorize-amount',
      note: 'authorize-note',
      visibility: 'authorize-visibility',
      submit: 'authorize-submit',
      error: 'authorize-error',
      uncertain: 'authorize-uncertain',
      success: 'authorize-success',
    },
    title: 'Hold money for someone',
    intro: 'Reserve funds now. The recipient can collect them later, and unused money is released.',
    endpoint: '/authorizations',
    handleField: 'to_handle' as const,
    handleLabel: 'Recipient handle',
    amountLabel: 'Amount to hold',
    submitLabel: 'Place hold',
    successText: 'Hold placed.',
    uncertainText:
      'We could not confirm whether the hold was placed. Press Place hold again to check: it will be placed only once.',
    withVisibility: true,
    ignoreUnchanged: true,
  };
}
