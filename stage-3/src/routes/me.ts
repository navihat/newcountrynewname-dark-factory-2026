import { now } from '../clock';
import { authed, json } from '../http';
import { heldAt, heldFunds } from '../holds';
import { movementsFor, totalAt } from '../ledger';
import { store, type User } from '../state';
import { readInstantParam } from '../validation';

export const me = authed((ctx, user) => {
  const asOf = readInstantParam(ctx.query, 'as_of');
  const knownAt = readInstantParam(ctx.query, 'known_at');
  const state = store.state;
  const profile = {
    user_id: user.id,
    display_name: user.displayName,
    handle: user.handle,
    currency: state.currency,
    minor_units: state.minorUnits,
  };

  if (!asOf && !knownAt) {
    const held = heldFunds(state, user.id);
    return json(200, { ...profile, balance: user.balance, total: user.balance, available: user.balance - held, held });
  }

  const atMs = asOf ? asOf.ms : now();
  const knownMs = knownAt ? knownAt.ms : Infinity;
  const total = historicalTotal(user, atMs, knownMs);
  const held = heldAt(state, user.id, atMs, knownMs);
  return json(200, {
    ...profile,
    balance: total,
    total,
    available: total - held,
    held,
    ...(asOf ? { as_of: asOf.text } : {}),
    ...(knownAt ? { known_at: knownAt.text } : {}),
  });
});

function historicalTotal(user: User, atMs: number, knownMs: number): number {
  return totalAt(user, movementsFor(store.state, user.id, knownMs), atMs);
}
