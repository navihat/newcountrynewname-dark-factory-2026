import { malformed, validation } from '../errors';
import { authed, parseJsonObject } from '../http';
import { runIdempotent } from '../idempotency';
import { nextId, store } from '../state';
import { nowRfc3339 } from '../util';
import { readAmount, readNote } from '../validation';
import { requestView, resolveUser } from '../wallet';
import { openRequest } from './requests';

/** Equal split in whole minor units; the first `amount % count` shares get one extra unit. */
export function equalShares(amount: number, count: number): number[] {
  const base = Math.floor(amount / count);
  const extra = amount % count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

function readParticipantHandles(body: Record<string, unknown>): string[] {
  const value = body.participant_handles;
  if (value === undefined) throw validation('participant_handles is required');
  if (!Array.isArray(value) || value.some((handle) => typeof handle !== 'string')) {
    throw malformed('participant_handles must be an array of strings');
  }
  const handles = value as string[];
  if (handles.length === 0) throw validation('participant_handles must not be empty');
  if (new Set(handles).size !== handles.length) throw validation('participant_handles must not repeat a handle');
  return handles;
}

export const createSplit = authed((ctx, user) => {
  const body = parseJsonObject(ctx.rawBody);
  return runIdempotent(ctx, user, body, () => {
    const handles = readParticipantHandles(body);
    const amount = readAmount(body);
    const note = readNote(body);
    const participants = handles.map(resolveUser);

    const shares = equalShares(amount, participants.length);
    const createdAt = nowRfc3339();
    const requests = participants.flatMap((participant, index) =>
      participant.id === user.id ? [] : [requestView(openRequest(user.id, participant.id, shares[index], note, createdAt))],
    );
    return {
      split_id: nextId(store.state, 'split'),
      amount,
      currency: store.state.currency,
      note,
      shares: participants.map((participant, index) => ({ handle: participant.handle, amount: shares[index] })),
      requests,
      created_at: createdAt,
    };
  });
});
