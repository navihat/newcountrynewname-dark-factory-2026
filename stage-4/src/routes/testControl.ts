import { stateFromFixture } from '../fixture';
import { json, parseJsonObject, type Ctx } from '../http';
import { exportState, importState } from '../snapshot';
import { store } from '../state';

export function reset(ctx: Ctx) {
  store.state = stateFromFixture(parseJsonObject(ctx.rawBody));
  return { status: 204 };
}

export function exportSnapshot() {
  return json(200, exportState(store.state));
}

export function importSnapshot(ctx: Ctx) {
  store.state = importState(parseJsonObject(ctx.rawBody));
  return { status: 204 };
}
