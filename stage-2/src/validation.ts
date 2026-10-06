import { malformed, validation } from './errors';
import type { Visibility } from './state';
import { characterCount, type JsonObject } from './util';

export const MAX_AMOUNT = 1_000_000_000;
const MAX_NOTE_LENGTH = 200;
const MAX_PAGE_SIZE = 200;

/** Amount of a payment, request or split; fractions, strings and booleans are not amounts. */
export function readAmount(body: JsonObject): number {
  const value = body.amount;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_AMOUNT) {
    throw validation(`amount must be an integer from 1 to ${MAX_AMOUNT}`);
  }
  return value;
}

export function readNote(body: JsonObject): string {
  const value = body.note;
  if (value === undefined) return '';
  if (typeof value !== 'string' || characterCount(value) > MAX_NOTE_LENGTH) {
    throw validation(`note must be a string of at most ${MAX_NOTE_LENGTH} characters`);
  }
  return value;
}

export function readVisibility(body: JsonObject): Visibility {
  const value = body.visibility;
  if (value === undefined) return 'public';
  if (value !== 'public' && value !== 'private') {
    throw validation('visibility must be "public" or "private"');
  }
  return value;
}

/** A required string field: wrong JSON type is 400, absence is 422. */
export function readRequiredString(body: JsonObject, field: string): string {
  const value = body[field];
  if (value === undefined) throw validation(`${field} is required`);
  if (typeof value !== 'string') throw malformed(`${field} must be a string`);
  return value;
}

export interface Paging {
  limit: number;
  offset: number;
}

export function readPaging(query: URLSearchParams): Paging {
  return {
    limit: readDigits(query, 'limit', 50, 1, MAX_PAGE_SIZE),
    offset: readDigits(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function readDigits(query: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const text = query.get(name);
  if (text === null) return fallback;
  const value = /^[0-9]+$/.test(text) ? Number(text) : NaN;
  if (!(value >= min && value <= max)) {
    throw validation(`${name} must be a plain decimal integer from ${min} to ${max}`);
  }
  return value;
}

export function readEnum<T extends string>(query: URLSearchParams, name: string, allowed: readonly T[]): T | undefined {
  const text = query.get(name);
  if (text === null) return undefined;
  const match = allowed.find((candidate) => candidate === text);
  if (match === undefined) throw validation(`${name} must be one of ${allowed.join(', ')}`);
  return match;
}

export function page<T>(items: T[], { limit, offset }: Paging): { items: T[]; hasMore: boolean } {
  return { items: items.slice(offset, offset + limit), hasMore: offset + limit < items.length };
}
