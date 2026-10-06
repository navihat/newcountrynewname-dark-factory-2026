export interface Money {
  currency: string;
  minorUnits: number;
}

const MAX_AMOUNT = 1_000_000_000;

/** `100.00 EUR`, or `1200 JPY` when the currency has no minor units. */
export function formatAmount(minor: number, money: Money): string {
  return `${formatDecimal(minor, money)} ${money.currency}`;
}

/** The decimal text a person would type for an amount, e.g. `15.50`. */
export function formatDecimal(minor: number, money: Money): string {
  if (money.minorUnits === 0) return String(minor);
  const unit = 10 ** money.minorUnits;
  const whole = Math.floor(minor / unit);
  return `${whole}.${String(minor % unit).padStart(money.minorUnits, '0')}`;
}

export type ParsedAmount = { ok: true; minor: number } | { ok: false; error: string };

/** Turns typed decimal text into minor units without rounding anything. */
export function parseAmount(text: string, money: Money): ParsedAmount {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return { ok: false, error: 'Enter the amount as a number, for example 15.00.' };
  const fraction = match[2] ?? '';
  if (fraction.length > money.minorUnits) {
    return {
      ok: false,
      error:
        money.minorUnits === 0
          ? `${money.currency} amounts are whole numbers, without decimals.`
          : `Use at most ${money.minorUnits} decimal places for ${money.currency}.`,
    };
  }
  const minor = Number(match[1]) * 10 ** money.minorUnits + Number(fraction.padEnd(money.minorUnits, '0') || 0);
  if (!Number.isSafeInteger(minor) || minor < 1) return { ok: false, error: 'The amount must be greater than zero.' };
  if (minor > MAX_AMOUNT) return { ok: false, error: 'That amount is above the maximum for a single action.' };
  return { ok: true, minor };
}

/** Equal split in whole minor units; the first `amount % count` shares get one extra unit. */
export function equalShares(amount: number, count: number): number[] {
  const base = Math.floor(amount / count);
  const extra = amount % count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}
