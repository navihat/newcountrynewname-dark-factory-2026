import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COST = 4096;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;

/** Stored form: scrypt$N$r$p$salt$hash (salt and hash base64). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || hash === undefined) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
  });
  return timingSafeEqual(actual, expected);
}

export function isPasswordHash(value: string): boolean {
  return /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value);
}
