import { api, describeError, isSuccess } from './api.js';
import type { Money } from './money.js';
import { createResource, type Resource } from './resource.js';

export interface Me {
  user_id: string;
  display_name: string;
  handle: string;
  balance: number;
  total: number;
  available: number;
  held: number;
  currency: string;
  minor_units: number;
}

export interface Payment {
  payment_id: string;
  from_handle: string;
  to_handle: string;
  amount: number;
  note: string;
  visibility: 'public' | 'private';
  request_id: string | null;
  authorization_id: string | null;
  created_at: string;
}

export interface PaymentRequest {
  request_id: string;
  requester_handle: string;
  payer_handle: string;
  amount: number;
  note: string;
  status: 'pending' | 'paid' | 'declined' | 'cancelled';
  created_at: string;
}

export interface Authorization {
  authorization_id: string;
  from_handle: string;
  to_handle: string;
  amount: number;
  captured_amount: number;
  remaining_amount: number;
  note: string;
  visibility: 'public' | 'private';
  status: 'open' | 'captured' | 'voided' | 'expired';
  expires_at: string;
  created_at: string;
}

export const moneyOf = (me: Me): Money => ({ currency: me.currency, minorUnits: me.minor_units });

async function get<T>(path: string): Promise<T> {
  const result = await api('GET', path);
  if (!isSuccess(result)) throw new Error(describeError(result));
  return result.body as T;
}

export const createWallet = (): Resource<Me> => createResource(() => get<Me>('/me'));

export const createFeed = (): Resource<Payment[]> =>
  createResource(async () => (await get<{ payments: Payment[] }>('/activity?limit=200')).payments);

export const createRequestList = (direction: 'incoming' | 'outgoing'): Resource<PaymentRequest[]> =>
  createResource(
    async () => (await get<{ requests: PaymentRequest[] }>(`/requests?direction=${direction}&limit=200`)).requests,
  );

export const createAuthorizationList = (): Resource<Authorization[]> =>
  createResource(async () => (await get<{ authorizations: Authorization[] }>('/authorizations?limit=200')).authorizations);
