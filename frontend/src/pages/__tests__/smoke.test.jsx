import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../i18n/index.js'; // initialize i18next so useTranslation works

// Inert axios client — no network, resolves empty payloads for any direct api.* call.
vi.mock('../../api/client.js', () => {
  const api = {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  };
  return { api, default: api };
});

// Return the declared empty shape so list pages render an empty state instead of crashing.
vi.mock('../../hooks/useApi.js', () => {
  const useFetch = (_path, _deps, initial = []) => ({
    data: initial ?? [], loading: false, error: null, refetch: () => {}, setData: () => {},
  });
  return { useFetch, default: useFetch };
});

// List/table pages that should mount cleanly with empty data. Covers every page
// touched by the refactor plus the previously crash-prone list pages.
const PAGES = {
  Rent: () => import('../Rent.jsx'),
  CashAdvances: () => import('../CashAdvances.jsx'),
  Complaints: () => import('../Complaints.jsx'),
  PettyCash: () => import('../PettyCash.jsx'),
  Loyalty: () => import('../Loyalty.jsx'),
  Clients: () => import('../Clients.jsx'),
  Reservations: () => import('../Reservations.jsx'),
  Inventory: () => import('../Inventory.jsx'),
  Products: () => import('../Products.jsx'),
  Workers: () => import('../Workers.jsx'),
  Scheduling: () => import('../Scheduling.jsx'),
  GoodsCheck: () => import('../GoodsCheck.jsx'),
  CashierShift: () => import('../CashierShift.jsx'),
  OrderHistory: () => import('../OrderHistory.jsx'),
};

afterEach(() => cleanup());

describe('page smoke render', () => {
  for (const [name, load] of Object.entries(PAGES)) {
    it(`${name} renders without crashing`, async () => {
      const mod = await load();
      const Page = mod.default;
      expect(() => render(<MemoryRouter><Page /></MemoryRouter>)).not.toThrow();
    });
  }
});
