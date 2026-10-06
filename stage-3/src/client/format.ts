const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : timeFormat.format(date);
}

export function characterCount(text: string): number {
  return Array.from(text).length;
}

export function cleanHandle(text: string): string {
  return text.trim().replace(/^@/, '');
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  declined: 'Declined',
  cancelled: 'Cancelled',
  open: 'On hold',
  captured: 'Captured',
  voided: 'Released',
  expired: 'Expired',
};
