import { randomBytes } from 'node:crypto';
import { now } from '../clock';
import { notFound, validation } from '../errors';
import { authed, json, type Ctx } from '../http';
import { movementsFor, type Movement } from '../ledger';
import { store, type StatementSnapshot, type User } from '../state';
import { page, readInstantParam, readPaging } from '../validation';
import { paymentView } from '../wallet';

const SNAPSHOT_EXCLUSIVE = ['from', 'to', 'known_at'];

export const statement = authed((ctx, user) => {
  const paging = readPaging(ctx.query);
  const token = ctx.query.get('snapshot');
  if (token !== null) return pageOf(readSnapshot(ctx, user, token), token, paging);

  const from = readInstantParam(ctx.query, 'from');
  const to = readInstantParam(ctx.query, 'to');
  const knownAt = readInstantParam(ctx.query, 'known_at');
  // Without `to`, the window runs up to and including the present instant.
  const frozen = buildStatement(user, from?.ms ?? -Infinity, to?.ms ?? now() + 1, knownAt?.ms ?? Infinity);
  const newToken = randomBytes(24).toString('hex');
  store.state.statements.set(newToken, frozen);
  return pageOf(frozen, newToken, paging);
});

function readSnapshot(ctx: Ctx, user: User, token: string): StatementSnapshot {
  if (SNAPSHOT_EXCLUSIVE.some((name) => ctx.query.has(name))) {
    throw validation('from, to and known_at cannot be combined with a snapshot');
  }
  const snapshot = store.state.statements.get(token);
  if (!snapshot || snapshot.userId !== user.id) throw notFound('unknown statement snapshot');
  return snapshot;
}

function pageOf(frozen: StatementSnapshot, token: string, paging: { limit: number; offset: number }) {
  const { items, hasMore } = page(frozen.entries, paging);
  return json(200, {
    opening_balance: frozen.openingBalance,
    entries: items,
    closing_balance: frozen.closingBalance,
    has_more: hasMore,
    snapshot: token,
  });
}

/** The full statement for the window [fromMs, toMs), as known at `knownMs`. */
function buildStatement(user: User, fromMs: number, toMs: number, knownMs: number): StatementSnapshot {
  const movements = movementsFor(store.state, user.id, knownMs);
  const windowEnd = Math.max(toMs, fromMs);
  let balance = user.openingBalance;
  for (const movement of movements) if (movement.effectiveMs < fromMs) balance += movement.delta;
  const openingBalance = balance;

  const entries = movements
    .filter((movement) => movement.effectiveMs >= fromMs && movement.effectiveMs < windowEnd)
    .map((movement) => {
      balance += movement.delta;
      return entryOf(movement, balance);
    });
  return { userId: user.id, openingBalance, closingBalance: balance, entries };
}

function entryOf(movement: Movement, balanceAfter: number) {
  return {
    payment: paymentView(movement.payment, movement.revision.amount),
    delta: movement.delta,
    balance_after: balanceAfter,
    revision: movement.revision.revision,
    effective_at: movement.revision.effectiveAt,
    recorded_at: movement.revision.recordedAt,
  };
}
