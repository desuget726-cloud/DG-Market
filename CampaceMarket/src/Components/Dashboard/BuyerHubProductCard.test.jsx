import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BuyerHubProductCard from './BuyerHubProductCard';

const item = {
  id: 42,
  title: 'Test phone',
  price: 1000,
  stock: 2,
  image: '',
  seller_id: 'seller-1',
};

const renderCard = (props = {}) => render(
  <BuyerHubProductCard
    item={item}
    priceLabel="1,000 ETB"
    isOwnProduct={false}
    isOutOfStock={false}
    isInWishlist={false}
    cartReady
    cartError={false}
    isAddingToCart={false}
    onViewProduct={vi.fn()}
    onAddToCart={vi.fn()}
    onPay={vi.fn()}
    onAddToWishlist={vi.fn()}
    onEdit={vi.fn()}
    onDelete={vi.fn()}
    {...props}
  />,
);

afterEach(cleanup);

describe('BuyerHubProductCard purchase actions', () => {
  it('shows Add to Cart and wishlist, but no direct payment, when not in cart', () => {
    renderCard({ isInCart: false });

    expect(screen.getByRole('button', { name: 'Add to Cart', exact: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '♡ Add to Wishlist', exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay with Chapa', exact: true })).toBeNull();
  });

  it('shows Chapa payment and In cart, but no Add to Cart, when already in cart', () => {
    const onPay = vi.fn();
    renderCard({ isInCart: true, onPay });

    expect(screen.getByText('In cart')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay with Chapa', exact: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: '♡ Add to Wishlist', exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to Cart', exact: true })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pay with Chapa', exact: true }));
    expect(onPay).toHaveBeenCalledOnce();
  });

  it('replaces purchase and wishlist actions with the owner listing label', () => {
    renderCard({ isOwnProduct: true, isInCart: true });

    expect(screen.getByText('This is your listing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to Cart', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay with Chapa', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '♡ Add to Wishlist', exact: true })).toBeNull();
  });

  it('hides purchase actions for sold-out products while keeping wishlist available', () => {
    renderCard({ isOutOfStock: true });

    expect(screen.getByText('Sold out')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to Cart', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay with Chapa', exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: '♡ Add to Wishlist', exact: true })).toBeTruthy();
  });
});
