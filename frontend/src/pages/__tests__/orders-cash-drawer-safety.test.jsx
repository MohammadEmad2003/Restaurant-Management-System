import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../i18n/index.js';
import { ConfirmHost } from '../../components/ui.jsx';

// Regression coverage for a real bug found via live E2E testing: the legacy
// free-text delivery-courier checkout path used to call POST /orders (which
// the backend marks paymentStatus=PAID for any order with no deliveryAgentId)
// BEFORE the "Cash collected?" confirmation was even answered — so clicking
// Cancel had no effect on money already counted. The fix reorders the flow to
// confirm first, create only if confirmed — this test locks that in.

const apiPost = vi.fn().mockResolvedValue({ data: { id: 'ORD-1', invoiceNo: 'INV-1' } });
vi.mock('../../api/client.js', () => {
  const api = {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: (...args) => apiPost(...args),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  };
  return { api, default: api, openReport: vi.fn() };
});

const PRODUCT = { id: 'PRD-1', name: 'Burger', price: 500, category: 'Main', margin: 50 };
const CLIENT = { id: 'CLI-1', name: 'Test Customer', phoneNumbers: ['01099998888'], addresses: [] };

vi.mock('../../hooks/useApi.js', () => {
  const useFetch = (path) => {
    if (path === '/products') return { data: [PRODUCT], loading: false, refetch: () => {} };
    if (path === '/clients') return { data: [CLIENT], loading: false, refetch: () => {} };
    return { data: [], loading: false, refetch: () => {} };
  };
  return { useFetch, default: useFetch };
});

afterEach(() => cleanup());

describe('Orders POS — legacy free-text delivery courier must never count cash before confirmation', () => {
  it('does not create an order (or any Cash Drawer impact) when the cashier clicks Cancel on the confirmation dialog', async () => {
    const Orders = (await import('../Orders.jsx')).default;
    render(<MemoryRouter><Orders /><ConfirmHost /></MemoryRouter>);

    fireEvent.click(screen.getByText('Burger'));
    fireEvent.change(screen.getByPlaceholderText(/Customer phone or name/i), { target: { value: '0109' } });
    fireEvent.click(await screen.findByText('Test Customer'));
    fireEvent.change(screen.getByPlaceholderText(/Delivery man's name/i), { target: { value: 'Random Courier' } });

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));

    // The "Cash collected?" confirmation must appear BEFORE any order is created.
    await screen.findByText(/Cash collected\?/i);
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryByText(/Cash collected\?/i)).not.toBeInTheDocument());

    expect(apiPost).not.toHaveBeenCalled();
  });

  it('creates the order only after the cashier confirms cash was collected', async () => {
    const Orders = (await import('../Orders.jsx')).default;
    render(<MemoryRouter><Orders /><ConfirmHost /></MemoryRouter>);

    fireEvent.click(screen.getByText('Burger'));
    fireEvent.change(screen.getByPlaceholderText(/Customer phone or name/i), { target: { value: '0109' } });
    fireEvent.click(await screen.findByText('Test Customer'));
    fireEvent.change(screen.getByPlaceholderText(/Delivery man's name/i), { target: { value: 'Random Courier' } });

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));
    await screen.findByText(/Cash collected\?/i);

    fireEvent.click(screen.getByRole('button', { name: /Collected/i }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/orders', expect.objectContaining({ deliveryAgentId: null }));
  });
});
