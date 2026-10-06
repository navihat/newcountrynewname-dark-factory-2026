export type Visibility = 'public' | 'private';
export type RequestStatus = 'pending' | 'paid' | 'declined' | 'cancelled';
export type AuthorizationStatus = 'open' | 'captured' | 'voided' | 'expired';

export interface User {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  passwordHash: string;
  balance: number;
  /** What the wallet held before any payment moved; corrections never change it. */
  openingBalance: number;
}

/** One immutable entry in a payment's history. Revision 1 is the payment as originally made. */
export interface PaymentRevision {
  revision: number;
  amount: number;
  effectiveAt: string;
  recordedAt: string;
  reason: string;
}

export interface Payment {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  note: string;
  visibility: Visibility;
  requestId: string | null;
  settlementId: string | null;
  authorizationId: string | null;
  createdAt: string;
  revisions: PaymentRevision[];
}

/** A hold on the payer's wallet. Only an `open` authorization holds its uncaptured remainder. */
export interface Authorization {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  capturedAmount: number;
  note: string;
  visibility: Visibility;
  status: AuthorizationStatus;
  expiresAt: string;
  /** When the hold was closed by capture, void or expiry; null while open. */
  closedAt: string | null;
  paymentIds: string[];
  createdAt: string;
}

/** A frozen statement result, paged by token. Entries are kept as serialised JSON. */
export interface StatementSnapshot {
  userId: string;
  openingBalance: number;
  closingBalance: number;
  entries: unknown[];
}

export interface PaymentRequest {
  id: string;
  requesterId: string;
  payerId: string;
  amount: number;
  note: string;
  status: RequestStatus;
  paymentId: string | null;
  createdAt: string;
}

/** A completed idempotent write: the response is kept as the exact JSON text sent. */
export interface IdempotencyRecord {
  userId: string;
  key: string;
  method: string;
  path: string;
  fingerprint: string;
  status: number;
  response: string;
}

export interface Counters {
  user: number;
  payment: number;
  request: number;
  split: number;
  settlement: number;
  authorization: number;
}

export interface State {
  currency: string;
  minorUnits: number;
  users: Map<string, User>;
  tokens: Map<string, string>;
  payments: Map<string, Payment>;
  requests: Map<string, PaymentRequest>;
  authorizations: Map<string, Authorization>;
  authorizationTtlSeconds: number;
  statements: Map<string, StatementSnapshot>;
  idempotency: Map<string, IdempotencyRecord>;
  operatorIds: Set<string>;
  counters: Counters;
}

export const DEFAULT_AUTHORIZATION_TTL_SECONDS = 600;

export function emptyState(): State {
  return {
    currency: 'EUR',
    minorUnits: 2,
    users: new Map(),
    tokens: new Map(),
    payments: new Map(),
    requests: new Map(),
    authorizations: new Map(),
    authorizationTtlSeconds: DEFAULT_AUTHORIZATION_TTL_SECONDS,
    statements: new Map(),
    idempotency: new Map(),
    operatorIds: new Set(),
    counters: { user: 0, payment: 0, request: 0, split: 0, settlement: 0, authorization: 0 },
  };
}

/** The live state. Handlers run synchronously, so each one is a critical section. */
export const store: { state: State } = { state: emptyState() };

export function idempotencyKey(userId: string, method: string, path: string, key: string): string {
  return [userId, method, path, key].join('\u0000');
}

export function findUserByHandle(state: State, handle: string): User | undefined {
  for (const user of state.users.values()) if (user.handle === handle) return user;
  return undefined;
}

export function findUserByEmail(state: State, email: string): User | undefined {
  const wanted = email.toLowerCase();
  for (const user of state.users.values()) if (user.email.toLowerCase() === wanted) return user;
  return undefined;
}

const ID_PREFIX = { user: 'u_', payment: 'p_', request: 'rq_', split: 'sp_', settlement: 'st_', authorization: 'a_' } as const;

/** Generated payment ids are zero-padded so that sorting them as text sorts them by creation. */
const ID_PADDING: Partial<Record<keyof Counters, number>> = { payment: 8 };

/** Next unused id of a kind; skips ids that seeded or imported data already took. */
export function nextId(state: State, kind: keyof Counters): string {
  for (;;) {
    state.counters[kind] += 1;
    const id = `${ID_PREFIX[kind]}${String(state.counters[kind]).padStart(ID_PADDING[kind] ?? 0, '0')}`;
    const taken =
      (kind === 'user' && state.users.has(id)) ||
      (kind === 'payment' && state.payments.has(id)) ||
      (kind === 'request' && state.requests.has(id)) ||
      (kind === 'authorization' && state.authorizations.has(id));
    if (!taken) return id;
  }
}
