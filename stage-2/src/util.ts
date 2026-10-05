import { malformed } from './errors';

export function nowRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
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
