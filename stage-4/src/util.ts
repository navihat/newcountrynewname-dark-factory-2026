import { tick } from './clock';
import { malformed } from './errors';

/** A fresh RFC 3339 instant (milliseconds, +00:00), later than any issued before. */
export function nowRfc3339(): string {
  return formatInstant(tick());
}

const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:\d{2})$/;
const instantCache = new Map<string, number | null>();

/** Epoch milliseconds of a strict RFC 3339 instant with an explicit offset; null if it is not one. */
export function parseInstant(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const cached = instantCache.get(text);
  if (cached !== undefined) return cached;
  const parsed = parseInstantUncached(text);
  if (instantCache.size > 100_000) instantCache.clear();
  instantCache.set(text, parsed);
  return parsed;
}

function parseInstantUncached(text: string): number | null {
  const match = INSTANT_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const millis = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (new Date(utc).getUTCDate() !== day) return null;
  let offsetMinutes = 0;
  if (match[8].toUpperCase() !== 'Z') {
    const sign = match[8][0] === '-' ? -1 : 1;
    const [offsetHour, offsetMinute] = match[8].slice(1).split(':').map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }
  return utc - offsetMinutes * 60_000;
}

export function characterCount(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** Stable JSON text of a parsed value: object key order is irrelevant. */
export function canonicalJson(value: unknown): string {
  try {
    return canonicalize(value);
  } catch (error) {
    if (error instanceof RangeError) throw malformed('request body is nested too deeply');
    throw error;
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** RFC 3339 instant with milliseconds and an explicit +00:00 offset. */
export function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('Z', '+00:00');
}

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
