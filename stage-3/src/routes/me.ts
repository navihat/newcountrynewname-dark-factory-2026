import { authed, json } from '../http';
import { heldFunds } from '../holds';
import { store } from '../state';

export const me = authed((_ctx, user) => {
  const held = heldFunds(store.state, user.id);
  return json(200, {
    user_id: user.id,
    display_name: user.displayName,
    handle: user.handle,
    balance: user.balance,
    total: user.balance,
    available: user.balance - held,
    held,
    currency: store.state.currency,
    minor_units: store.state.minorUnits,
  });
});
