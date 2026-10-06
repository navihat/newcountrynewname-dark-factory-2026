import type { Authorization, State, User } from './state';

/** The amount an authorization still reserves: nothing once it is no longer open. */
export function remainingAmount(authorization: Authorization): number {
  return authorization.status === 'open' ? authorization.amount - authorization.capturedAmount : 0;
}

export function heldFunds(state: State, userId: string): number {
  let held = 0;
  for (const authorization of state.authorizations.values()) {
    if (authorization.fromUserId === userId) held += remainingAmount(authorization);
  }
  return held;
}

/** What a user can spend on new payments, authorizations and settlement debits. */
export function availableFunds(state: State, user: User): number {
  return user.balance - heldFunds(state, user.id);
}

/**
 * Expiry is evaluated lazily: any open authorization whose deadline has passed is closed here,
 * which releases its remainder. Called before every request, so no timer is needed.
 */
export function expireDue(state: State, nowMs: number = Date.now()): void {
  for (const authorization of state.authorizations.values()) {
    if (authorization.status === 'open' && Date.parse(authorization.expiresAt) <= nowMs) {
      authorization.status = 'expired';
    }
  }
}
