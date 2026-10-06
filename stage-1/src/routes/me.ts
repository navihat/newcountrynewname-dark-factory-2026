import { authed, json } from '../http';
import { store } from '../state';

export const me = authed((_ctx, user) =>
  json(200, {
    user_id: user.id,
    display_name: user.displayName,
    handle: user.handle,
    balance: user.balance,
    currency: store.state.currency,
    minor_units: store.state.minorUnits,
  }),
);
