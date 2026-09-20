/* Typed API client — all calls go to same-origin /api (nginx in prod, vite proxy in dev). */

export type Status = "booked" | "in_transit" | "out_for_delivery" | "delivered" | "cancelled";

export interface Courier {
  id: number;
  tracking_id: string;
  customer_name: string;
  phone: string;
  parcel_type: string;
  weight_kg: number;
  source: string;
  destination: string;
  status: Status;
  charge_usd: number;
  created_at: string;
  updated_at: string;
  eta_date: string | null;
  eta_label: string | null;
}

export interface CourierEvent {
  id: number;
  courier_id: number;
  event: string;
  from_status: string | null;
  to_status: Status;
  message: string;
  created_at: string;
}

export interface Stats {
  total: number;
  booked: number;
  in_transit: number;
  out_for_delivery: number;
  delivered: number;
  cancelled: number;
  total_revenue_usd: number;
}

export interface Revenue {
  total_revenue_usd: number;
  delivered_count: number;
  total_count: number;
  currency: string;
}

export interface ChargePreview {
  weight_kg: number;
  base_fee_usd: number;
  rate_per_kg_usd: number;
  total_usd: number;
  currency: string;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  list: (params: { status?: string; q?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.q) sp.set("q", params.q);
    sp.set("limit", "200");
    return req<Courier[]>(`/api/couriers?${sp.toString()}`);
  },
  delivered: () => req<Courier[]>("/api/couriers/delivered"),
  get: (id: number) => req<Courier>(`/api/couriers/${id}`),
  byTracking: (code: string) => req<Courier>(`/api/couriers/by-tracking/${encodeURIComponent(code.trim())}`),
  events: (id: number) => req<CourierEvent[]>(`/api/couriers/${id}/events`),
  create: (body: object) =>
    req<Courier>("/api/couriers", { method: "POST", body: JSON.stringify(body) }),
  setStatus: (id: number, status: Status) =>
    req<Courier>(`/api/couriers/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (id: number) => req<void>(`/api/couriers/${id}`, { method: "DELETE" }),
  previewCharge: (weight_kg: number) =>
    req<ChargePreview>(`/api/couriers/charges/preview?weight_kg=${encodeURIComponent(weight_kg)}`),
  revenue: () => req<Revenue>("/api/revenue"),
  stats: () => req<Stats>("/api/stats"),
};

export const NEXT_STATUS: Record<Status, Status | null> = {
  booked: "in_transit",
  in_transit: "out_for_delivery",
  out_for_delivery: "delivered",
  delivered: null,
  cancelled: null,
};

export const STATUS_LABEL: Record<Status, string> = {
  booked: "Booked",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n ?? 0);
}
