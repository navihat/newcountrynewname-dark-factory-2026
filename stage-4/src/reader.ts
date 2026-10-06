import { validation } from './errors';
import { isObject, type JsonObject } from './util';

/** Strict readers for reset fixtures and imported snapshots; every failure is 422. */
export function object(value: unknown, what: string): JsonObject {
  if (!isObject(value)) throw validation(`${what} must be an object`);
  return value;
}

export function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw validation(`${what} must be an array`);
  return value;
}

export function string(value: unknown, what: string): string {
  if (typeof value !== 'string') throw validation(`${what} must be a string`);
  return value;
}

export function id(value: unknown, what: string): string {
  const text = string(value, what);
  if (text === '' || text.length > 64) throw validation(`${what} must be 1 to 64 characters`);
  return text;
}

export function integer(value: unknown, what: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw validation(`${what} must be an integer of at least ${min}`);
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw validation(`${what} must be one of ${allowed.join(', ')}`);
  return match;
}

export function optional<T>(value: unknown, read: (value: unknown) => T, fallback: T): T {
  return value === undefined || value === null ? fallback : read(value);
}
