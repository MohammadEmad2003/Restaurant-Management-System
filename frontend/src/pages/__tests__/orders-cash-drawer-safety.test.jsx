import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../i18n/index.js';
import { ConfirmHost } from '../../components/ui.jsx';

// Regression coverage for a real bug found via live E2E testing, and for the
// subsequent fix that unified the two delivery flows (registered Delivery
// Agent vs. manual/free-text courier) behind the exact same four-option
// collection modal. Previously, a manual/free-text courier order called
// POST /orders (which the backend marked paymentStatus=PAID) BEFORE any
// confirmation — so Cancel had no effect on money already counted, and it
// never went through the Pay Now / End of Day / Print Unpaid / Cancel choice
// at all. Both flows must now behave identically.

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

/** Adds a product, selects the test customer, and types a manual/free-text
 * courier name (no registered Delivery Agent exists in this test's fixtures,
 * so this always exercises the manual-courier path). */
async function setUpManualCourierOrder() {
  const Orders = (await import('../Orders.jsx')).default;
  render(<MemoryRouter><Orders /><ConfirmHost /></MemoryRouter>);

  fireEvent.click(screen.getByText('Burger'));
  fireEvent.change(screen.getByPlaceholderText(/Customer phone or name/i), { target: { value: '0109' } });
  fireEvent.click(await screen.findByText('Test Customer'));
  fireEvent.change(screen.getByPlaceholderText(/Delivery man's name/i), { target: { value: 'Random Courier' } });
}

describe('Orders POS — manual/free-text courier follows the exact same four-option collection flow as a registered Delivery Agent', () => {
  it('clicking Charge opens the four-option collection modal, not an immediate order/confirmation', async () => {
    await setUpManualCourierOrder();

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));

    // All four options must be visible simultaneously; no order created yet.
    await screen.findByText('Choose Collection Method');
    expect(screen.getByRole('button', { name: /Pay Now \+ Print Receipt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay at End of Day \+ Print Receipt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print receipt only/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('Cancel has zero financial side effects: no order, no payment, no ledger/drawer change', async () => {
    await setUpManualCourierOrder();

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));
    await screen.findByText('Choose Collection Method');

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryByText('Choose Collection Method')).not.toBeInTheDocument());

    expect(apiPost).not.toHaveBeenCalled();
  });

  it('Pay Now shows a SECOND "cash received?" confirmation, and cancelling THAT still creates nothing', async () => {
    await setUpManualCourierOrder();

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));
    await screen.findByText('Choose Collection Method');

    fireEvent.click(screen.getByRole('button', { name: /Pay Now \+ Print Receipt/i }));
    await screen.findByText(/Cash collected\?/i);
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryByText(/Cash collected\?/i)).not.toBeInTheDocument());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('Pay Now creates the order as PAID_NOW only after the second confirmation is accepted', async () => {
    await setUpManualCourierOrder();

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));
    await screen.findByText('Choose Collection Method');
    fireEvent.click(screen.getByRole('button', { name: /Pay Now \+ Print Receipt/i }));
    await screen.findByText(/Cash collected\?/i);

    fireEvent.click(screen.getByRole('button', { name: /Collected/i }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/orders', expect.objectContaining({ deliveryAgentId: null, paymentTiming: 'PAID_NOW' }));
  });

  it('End of Day creates the order immediately with no "cash received" prompt', async () => {
    await setUpManualCourierOrder();

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));
    await screen.findByText('Choose Collection Method');
    fireEvent.click(screen.getByRole('button', { name: /Pay at End of Day \+ Print Receipt/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/orders', expect.objectContaining({ deliveryAgentId: null, paymentTiming: 'END_OF_DAY' }));
    expect(screen.queryByText(/Cash collected\?/i)).not.toBeInTheDocument();
  });

  it('Print Unpaid creates the order immediately with no "cash received" prompt', async () => {
    await setUpManualCourierOrder();

    apiPost.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Charge/i }));
    await screen.findByText('Choose Collection Method');
    fireEvent.click(screen.getByRole('button', { name: /Print receipt only/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/orders', expect.objectContaining({ deliveryAgentId: null, paymentTiming: 'UNPAID_PRINTED' }));
    expect(screen.queryByText(/Cash collected\?/i)).not.toBeInTheDocument();
  });
});
