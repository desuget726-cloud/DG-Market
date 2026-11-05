import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SellerCompletedOrders from './SellerCompletedOrders';

vi.mock('../../context/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key) => ({
      'sellerOrders.history': 'Order History',
      'sellerOrders.completedOrders': 'Completed Orders',
      'sellerOrders.orderCount': '{count} orders',
      'sellerOrders.order': 'Order',
      'sellerOrders.customer': 'Customer',
      'sellerOrders.product': 'Product',
      'sellerOrders.amount': 'Amount',
      'sellerOrders.status': 'Status',
      'sellerOrders.completed': 'Completed',
      'sellerOrders.actions': 'Actions',
      'sellerOrders.openOrder': 'View completed order',
      'sellerOrders.sold': 'Sold',
      'sellerOrders.view': 'View',
      'sellerOrders.pageOf': 'Page {page} of {pages}',
      'sellerOrders.search': 'Search',
      'sellerOrders.searchPlaceholder': 'Product or customer name',
      'sellerOrders.dateFrom': 'Completed from',
      'sellerOrders.dateTo': 'Completed to',
      'sellerOrders.noCompletedOrders': 'No completed orders yet.',
      'sellerOrders.noMatchingOrders': 'No orders match these filters.',
      'sellerOrders.previous': 'Previous',
      'sellerOrders.next': 'Next',
    })[key] || key,
  }),
}));

afterEach(() => cleanup());

const renderOrders = (onOpenOrder) => render(
  <SellerCompletedOrders
    pageData={{
      items: [{
        id: 41,
        buyer_name: 'Aster Buyer',
        product_title: 'Campus Textbook',
        amount: 125,
        payment_status: 'Successful',
        completed_at: '2026-10-20T12:00:00',
      }],
      total: 1,
      page: 1,
      page_size: 10,
    }}
    filters={{ page: 1, search: '', dateFrom: '', dateTo: '' }}
    loading={false}
    error=""
    onRetry={vi.fn()}
    onFilterChange={vi.fn()}
    onOpenOrder={onOpenOrder}
  />,
);

describe('SellerCompletedOrders', () => {
  it('keeps the completed orders table horizontally scrollable without text wrapping', () => {
    renderOrders(vi.fn());
    const table = screen.getByRole('table');

    expect(table.className).toContain('min-w-[680px]');
    expect(table.className).toContain('w-full');
    expect(table.parentElement.className).toContain('overflow-x-auto');
    expect(Array.from(table.querySelectorAll('th, td')).every((cell) => (
      cell.className.includes('whitespace-nowrap')
      && cell.className.includes('px-4')
      && cell.className.includes('py-3')
    ))).toBe(true);
  });

  it('opens an order when the row or View button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    renderOrders(onOpenOrder);

    await user.click(screen.getByRole('link', { name: 'View completed order #41' }));
    expect(screen.getByRole('status')).toHaveTextContent('Payment Received / Order Settled');
    expect(onOpenOrder).toHaveBeenCalledWith(41);

    onOpenOrder.mockClear();
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(onOpenOrder).toHaveBeenCalledWith(41);
  });

  it('opens the focused row with Enter and Space', async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    renderOrders(onOpenOrder);
    const row = screen.getByRole('link', { name: 'View completed order #41' });

    row.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onOpenOrder).toHaveBeenNthCalledWith(1, 41);
    expect(onOpenOrder).toHaveBeenNthCalledWith(2, 41);
  });
});
