import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * Shared, backend-authoritative POS figures — the Restaurant-wide Cash
 * Drawer total and the Pending Payments count — held in one place so that
 * settling a payment on ANY page (e.g. Pending Payments) immediately updates
 * what any OTHER mounted component (e.g. the POS/Topbar badges) displays,
 * without requiring that component to unmount/remount or the user to
 * navigate away and back.
 *
 * The backend Restaurant Cash Ledger (`/cashier-shifts/current-all`) remains
 * the only source of truth for the balance — this store never computes or
 * derives it locally, it only holds the last value fetched from that same
 * endpoint so multiple components share one copy instead of independently
 * polling and potentially drifting.
 */
export const usePosStats = create((set, get) => ({
  cashDrawerTotal: null,
  pendingPaymentsCount: null,
  pendingPaymentsTotal: null,

  async refreshCashDrawer() {
    const { data } = await api.get('/cashier-shifts/current-all');
    set({ cashDrawerTotal: data?.total ?? 0 });
  },
  // Always fetches the TRUE restaurant-wide pending queue (no status/agent/
  // date/search params) — this is the one figure every page (POS badge,
  // Dashboard, Pending Payments summary tiles) shares, so it can never
  // silently reflect whatever filter someone else happens to have applied on
  // the Pending Payments page itself.
  async refreshPendingCount() {
    const { data } = await api.get('/orders/pending-payments');
    const rows = Array.isArray(data) ? data : [];
    set({
      pendingPaymentsCount: rows.length,
      pendingPaymentsTotal: rows.reduce((s, r) => s + (r.totalPrice || 0), 0),
    });
  },
  async refreshAll() {
    await Promise.all([get().refreshCashDrawer(), get().refreshPendingCount()]);
  },
}));

export default usePosStats;
