import { api, describeError, isSuccess, NetworkError, session } from '../api.js';
import { el, field } from '../dom.js';
import { mountPage } from '../layout.js';
import { noticeSlot } from '../notice.js';

interface AuthFormOptions {
  path: string;
  ids: { email: string; password: string; submit: string };
  title: string;
  intro: string;
  endpoint: string;
  submitLabel: string;
  withName: boolean;
  alternate: { href: string; text: string };
}

function renderAuth(options: AuthFormOptions): void {
  const page = mountPage({ title: options.title, path: options.path, requiresSession: false });
  if (!page) return;
  const { ids } = options;

  const email = el('input', { type: 'email', testid: ids.email, name: 'email', autocomplete: 'email', autocapitalize: 'none' });
  const password = el('input', {
    type: 'password',
    testid: ids.password,
    name: 'password',
    autocomplete: options.path === '/login' ? 'current-password' : 'new-password',
  });
  const name = options.withName ? el('input', { type: 'text', testid: 'signup-display-name', name: 'display_name', autocomplete: 'name' }) : null;
  const submit = el('button', { type: 'submit', class: 'button primary', testid: ids.submit, text: options.submitLabel });
  const notices = noticeSlot();
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    name ? field('Display name', name) : null,
    field('Email', email),
    field('Password', password, options.withName ? 'At least 8 characters.' : undefined),
    submit,
    notices.element,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });

  async function send(): Promise<void> {
    const body: Record<string, string> = { email: email.value.trim(), password: password.value };
    if (name) body.display_name = name.value.trim();
    submit.disabled = true;
    try {
      const result = await api('POST', options.endpoint, { body });
      if (isSuccess(result)) {
        session.start(result.body.token);
        location.assign('/');
        return;
      }
      notices.show('error', 'auth-error', describeError(result));
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      notices.show('error', 'auth-error', 'We could not reach the server. Please try again.');
    }
    submit.disabled = false;
  }

  page.main.append(
    el(
      'section',
      { class: 'card narrow', 'aria-label': options.title },
      el('h1', { text: options.title }),
      el('p', { class: 'intro', text: options.intro }),
      form,
      el('p', { class: 'switch' }, el('a', { class: 'link', href: options.alternate.href, text: options.alternate.text })),
    ),
  );
}

export const renderLogin = (): void =>
  renderAuth({
    path: '/login',
    ids: { email: 'login-email', password: 'login-password', submit: 'login-submit' },
    title: 'Log in',
    intro: 'Welcome back. Log in to see your wallet.',
    endpoint: '/auth/login',
    submitLabel: 'Log in',
    withName: false,
    alternate: { href: '/signup', text: 'New here? Create an account' },
  });

export const renderSignup = (): void =>
  renderAuth({
    path: '/signup',
    ids: { email: 'signup-email', password: 'signup-password', submit: 'signup-submit' },
    title: 'Create your account',
    intro: 'Your handle comes from your email address.',
    endpoint: '/auth/signup',
    submitLabel: 'Sign up',
    withName: true,
    alternate: { href: '/login', text: 'Already have an account? Log in' },
  });
