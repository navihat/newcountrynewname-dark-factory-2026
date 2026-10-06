import { randomBytes } from 'node:crypto';
import { ApiError, unauthenticated, validation } from '../errors';
import { json, parseJsonObject, type Ctx } from '../http';
import { hashPassword, verifyPassword } from '../passwords';
import { findUserByEmail, findUserByHandle, nextId, store, type User } from '../state';
import { characterCount } from '../util';
import { readRequiredString } from '../validation';

const MIN_PASSWORD_LENGTH = 8;
const MAX_HANDLE_LENGTH = 20;

export function deriveHandle(email: string): string {
  const local = email.slice(0, email.indexOf('@'));
  return local.toLowerCase().replace(/[^a-z0-9_]/gu, '_').slice(0, MAX_HANDLE_LENGTH);
}

function issueToken(user: User): string {
  const token = randomBytes(32).toString('hex');
  store.state.tokens.set(token, user.id);
  return token;
}

function session(status: number, user: User) {
  return json(status, { user_id: user.id, display_name: user.displayName, token: issueToken(user) });
}

export function signup(ctx: Ctx) {
  const body = parseJsonObject(ctx.rawBody);
  const email = readRequiredString(body, 'email');
  const password = readRequiredString(body, 'password');
  const displayName = readRequiredString(body, 'display_name');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw validation('email must look like local@domain');
  if (characterCount(password) < MIN_PASSWORD_LENGTH) {
    throw validation(`password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (displayName === '') throw validation('display_name must not be empty');

  const state = store.state;
  if (findUserByEmail(state, email)) throw new ApiError(409, 'email_taken', 'email is already registered');
  const handle = deriveHandle(email);
  if (findUserByHandle(state, handle)) throw new ApiError(409, 'handle_taken', 'derived handle is already taken');

  const user: User = {
    id: nextId(state, 'user'),
    email,
    handle,
    displayName,
    passwordHash: hashPassword(password),
    balance: 0,
  };
  state.users.set(user.id, user);
  return session(201, user);
}

export function login(ctx: Ctx) {
  const body = parseJsonObject(ctx.rawBody);
  const email = readRequiredString(body, 'email');
  const password = readRequiredString(body, 'password');
  const user = findUserByEmail(store.state, email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw unauthenticated('wrong email or password');
  }
  return session(200, user);
}
