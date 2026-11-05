import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SellerOrderDetails from './SellerOrderDetails';

vi.mock('../../context/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key) => ({
      'sellerOrders.timeline': 'Timeline',
      'sellerOrders.orderCreated': 'Order created',
      'sellerOrders.paymentCompleted': 'Payment completed',
      'sellerOrders.orderCompleted': 'Order completed',
      'sellerOrders.unavailable': 'Not available',
    })[key] || key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderOrderDetails = (timeline) => render(
  <SellerOrderDetails
    order={{
      id: 30,
      status: 'Completed',
      product: { name: 'Campus Textbook', images: [] },
      payment: {
        item_price: 100,
        fees: 0,
        total_received: 100,
        payment_status: 'Successful',
        paid_at: '2026-10-28T11:00:00+00:00',
      },
      buyer: { name: 'Buyer' },
      timeline,
    }}
    loading={false}
    error=""
    onRetry={vi.fn()}
    onBack={vi.fn()}
  />,
);

const getTimelineItems = () => {
  const section = screen.getByRole('heading', { name: 'Timeline' }).closest('section');
  return within(section).getAllByRole('listitem');
};

describe('SellerOrderDetails timeline', () => {
  it('shows a settled payment and lets the seller view the official receipt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        receipt_number: 'RCPT-20261028-0030',
        order_number: 30,
        payment_date: '2026-10-28T11:00:00+00:00',
        product_name: 'Campus Textbook',
        quantity: 1,
        total_paid: 100,
        transaction_reference: 'CHAPA-ORDER-30',
        payment_message: 'The buyer paid through Chapa Split Payment.',
      }),
    }));
    renderOrderDetails({});

    expect(screen.getByRole('status')).toHaveTextContent('Payment Received / Order Settled');
    await userEvent.setup().click(screen.getByRole('button', { name: 'View official receipt' }));

    expect(await screen.findByText(/Official payment receipt · RCPT-20261028-0030/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download receipt' })).toBeTruthy();
  });

  it('renders three steps with consistent timestamps for a new order', () => {
    const timestamp = '2026-10-28T11:00:00+00:00';
    renderOrderDetails({
      order_created_at: timestamp,
      payment_completed_at: timestamp,
      order_completed_at: timestamp,
    });

    const steps = getTimelineItems();
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Order created'),
      expect.stringContaining('Payment completed'),
      expect.stringContaining('Order completed'),
    ]);
    expect(steps.map((step) => step.textContent.match(/2026/gu)?.length || 0)).toEqual([1, 1, 1]);
  });

  it('renders legacy orders with handover data without showing a handover step', () => {
    renderOrderDetails({
      order_created_at: '2024-01-02T03:00:00+00:00',
      handover_at: '2024-01-02T04:00:00+00:00',
      payment_completed_at: '2024-01-02T05:00:00+00:00',
      order_completed_at: '2024-01-02T05:00:00+00:00',
    });

    const steps = getTimelineItems();
    expect(steps).toHaveLength(3);
    expect(screen.queryByText(/handover|meeting/iu)).toBeNull();
  });
});
