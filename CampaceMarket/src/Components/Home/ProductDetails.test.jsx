import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import ProductDetails from './ProductDetails';
import { IMAGE_PLACEHOLDER } from '../../config';
import { clearPendingProductAction, getPendingProductAction } from '../../utils/productActionState';

const { mockSetCartItems, mockCartItems, mockMarkCheckoutComplete } = vi.hoisted(() => ({
  mockSetCartItems: vi.fn(),
  mockCartItems: [],
  mockMarkCheckoutComplete: vi.fn(),
}));

vi.mock('../../context/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key) => key,
  }),
}));

vi.mock('../../context/CartContext', () => ({
  useCart: () => ({
    items: mockCartItems,
    setItems: mockSetCartItems,
    markCheckoutComplete: mockMarkCheckoutComplete,
    loadedStudentId: 'buyer-1',
    loading: false,
    error: null,
  }),
}));

const product = {
  id: 42,
  title: 'Test phone',
  price: '1000',
  stock: 1,
  status: 'Approved',
};

const detail = {
  ...product,
  is_owner: false,
  seller_typical_response_bucket: null,
  seller_id: 'seller-1',
  seller_name: 'Seller',
  pickup_location: 'Student Center',
  pickup_hours: '08:00-17:00',
  views: 1,
};

const similarProduct = {
  id: 99,
  title: 'Similar book',
  category: 'Books',
  price: 500,
  image: '/uploads/book.jpg',
  status: 'Approved',
};

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

const galleryImageSet = [
  { url: '/uploads/gallery-one.jpg' },
  { url: '/uploads/gallery-two.jpg' },
  { url: '/uploads/gallery-three.jpg' },
];

const galleryFetchMock = (detailsById) => vi.fn((input) => {
  const url = String(input);
  const similarMatch = url.match(/\/api\/products\/(\d+)\/similar$/);
  if (similarMatch) return Promise.resolve(jsonResponse([]));
  const productMatch = url.match(/\/api\/products\/(\d+)$/);
  if (productMatch) {
    const id = productMatch[1];
    return Promise.resolve(jsonResponse(detailsById[id] || { ...detail, id: Number(id) }));
  }
  if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
  if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
  if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
  return Promise.resolve(jsonResponse({}));
});

describe('ProductDetails guest actions', () => {
  beforeEach(() => {
    clearPendingProductAction();
    mockSetCartItems.mockClear();
    mockMarkCheckoutComplete.mockClear();
    mockCartItems.length = 0;
    localStorage.removeItem('token');
    localStorage.removeItem('campaceSession');
    localStorage.removeItem('viewed_products');
    vi.stubGlobal('fetch', vi.fn((input, options = {}) => {
      const url = String(input);
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([similarProduct]));
      if (url.includes('/api/products/42')) return Promise.resolve(jsonResponse(detail));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/student/cart') && options.method === 'POST') {
        return Promise.resolve(jsonResponse({
          item: { id: 8, product_id: 42, student_id: 'buyer-1', quantity: 1 },
        }));
      }
      return Promise.resolve(jsonResponse({}));
    }));
  });

  afterEach(() => {
    cleanup();
    clearPendingProductAction();
    localStorage.removeItem('token');
    localStorage.removeItem('campaceSession');
    localStorage.removeItem('viewed_products');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redirects a guest Add to Cart click to Login and restores the same product after login', async () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <ProductDetails product={product} currentUser={null} onNavigate={onNavigate} />,
    );

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add to Cart' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to Cart' })[0]);

    expect(onNavigate).toHaveBeenCalledWith('login', {
      returnTo: '/?productId=42',
      message: 'productDetails.loginPrompt',
    });
    const pendingAction = getPendingProductAction();
    expect(pendingAction).toMatchObject({ returnTo: '42', action: 'addToCart', quantity: 1 });

    rerender(
      <ProductDetails
        product={product}
        currentUser={{ studentId: 'buyer-1' }}
        pendingAction={pendingAction}
        onPendingActionHandled={clearPendingProductAction}
        onNavigate={onNavigate}
      />,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/student/cart'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(mockSetCartItems).toHaveBeenCalled();
  });

  it('shows admin listing controls without buyer or report actions', async () => {
    const onNavigate = vi.fn();
    render(
      <ProductDetails
        product={product}
        currentUser={{ isAdmin: true, access_token: 'admin-token' }}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Go to Moderation' }));
    expect(onNavigate).toHaveBeenCalledWith('admin-dashboard', { tab: 'product-management' });
    expect(screen.getByRole('button', { name: 'Unpublish / Delist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Listing' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Increase quantity' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decrease quantity' })).toBeNull();
    expect(screen.queryByText('🚩 Report/Flag Product')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Unpublish / Delist' }));
    await waitFor(() => {
      const request = globalThis.fetch.mock.calls.find(([url, options]) => (
        String(url).includes('/api/admin/products/42') && options?.method === 'PUT'
      ));
      expect(request).toBeTruthy();
      expect(JSON.parse(request[1].body)).toEqual({ status: 'Pending' });
    });
  });

  it('shows owner listing actions without buyer purchase or report controls', async () => {
    vi.stubGlobal('fetch', vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/api/products/42')) {
        return Promise.resolve(jsonResponse({ ...detail, seller_id: 'seller-owner', is_owner: false }));
      }
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    }));

    render(<ProductDetails product={product} currentUser={{ student_id: 'seller-owner' }} />);

    expect(await screen.findByRole('button', { name: 'productDetails.owner.editListing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'productDetails.owner.markSoldUnlist' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Increase quantity' })).toBeNull();
    expect(screen.queryByText('🚩 Report/Flag Product')).toBeNull();
  });

  it('hides the seller response-time stat when the backend returns null', async () => {
    render(<ProductDetails product={product} currentUser={{ studentId: 'buyer-1' }} />);

    await waitFor(() => expect(screen.getByText('Seller')).toBeTruthy());
    expect(screen.queryByText('productDetails.buyer.responseTime')).toBeNull();
  });

  it('sends an authenticated message to the seller with the bearer token', async () => {
    const currentUser = {
      studentId: 'buyer-1',
      is_verified: true,
      access_token: 'student-token',
    };
    const fetchMock = globalThis.fetch;
    render(<ProductDetails product={product} currentUser={currentUser} />);

    fireEvent.click(await screen.findByRole('button', { name: /Send Message & Start Chat/ }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/student/messages/send'));
      expect(request).toBeTruthy();
      expect(request[1].headers.Authorization).toBe('Bearer student-token');
    });
  });

  it('lets admins reveal, call, copy, and text the seller phone without student verification', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const adminDetail = { ...detail, seller_phone: '0912345678' };
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([]));
      if (url.endsWith('/api/products/42')) return Promise.resolve(jsonResponse(adminDetail));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ProductDetails
        product={product}
        currentUser={{ role: 'admin', access_token: 'admin-token' }}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Show Contact/ }));

    const phoneLink = await screen.findByRole('link', { name: /0912345678/ });
    expect(phoneLink.getAttribute('href')).toBe('tel:0912345678');
    expect(screen.getByRole('link', { name: 'Message' }).getAttribute('href')).toBe('sms:0912345678');
    const productRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/products/42'));
    expect(productRequest[1].headers.Authorization).toBe('Bearer admin-token');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('0912345678'));
    expect(screen.queryByRole('button', { name: /Send Message & Start Chat/ })).toBeNull();
  });

  it('does not send a chat request without a token and prompts the user to sign in', async () => {
    const onNavigate = vi.fn();
    const toastError = vi.spyOn(toast, 'error');
    const fetchMock = globalThis.fetch;
    render(
      <ProductDetails
        product={product}
        currentUser={{ studentId: 'buyer-1', is_verified: true }}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Send Message & Start Chat/ }));

    expect(toastError).toHaveBeenCalledWith('Please sign in to message the seller.');
    expect(onNavigate).toHaveBeenCalledWith('login', expect.objectContaining({
      returnTo: '/?productId=42',
    }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/student/messages/send'))).toBe(false);
  });

  it('handles a 401 chat response with sign-in feedback even when the response is not JSON', async () => {
    const onNavigate = vi.fn();
    const toastError = vi.spyOn(toast, 'error');
    const fetchMock = globalThis.fetch;
    const defaultFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, options = {}) => {
      if (String(input).includes('/api/student/messages/send')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: async () => {
            throw new Error('Invalid JSON response');
          },
        });
      }
      return defaultFetch(input, options);
    });

    render(
      <ProductDetails
        product={product}
        currentUser={{ studentId: 'buyer-1', is_verified: true, access_token: 'student-token' }}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Send Message & Start Chat/ }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Please sign in to message the seller.');
      expect(onNavigate).toHaveBeenCalledWith('login', expect.objectContaining({
        returnTo: '/?productId=42',
      }));
    });
  });

  it('shows the saved pickup location instead of a default handover location', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, pickup_location: 'Dormitory Gate 2' },
    }));

    render(<ProductDetails product={product} currentUser={{ studentId: 'buyer-1' }} />);

    expect(await screen.findByText('productDetails.buyer.handover: Dormitory Gate 2')).toBeTruthy();
    expect(screen.queryByText(/Student Center/)).toBeNull();
  });

  it('skips view tracking for a product revisited within 24 hours in this browser', async () => {
    const fetchMock = globalThis.fetch;
    const firstVisit = render(
      <ProductDetails product={product} currentUser={{ studentId: 'buyer-1' }} />,
    );

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/products/42')),
    ).toBe(true));
    expect(JSON.parse(localStorage.getItem('viewed_products'))['buyer-1:42']).toBeGreaterThan(0);

    firstVisit.unmount();
    render(<ProductDetails product={product} currentUser={{ studentId: 'buyer-1' }} />);

    await waitFor(() => expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/products/42?track_view=false')),
    ).toBe(true));
  });

  it('refreshes listing availability when the payment summary reports it out of stock', async () => {
    mockCartItems.push({ id: 8, product_id: 42, student_id: 'buyer-1', quantity: 1 });
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/pay-summary')) {
        return Promise.resolve(jsonResponse({
          detail: { code: 'OUT_OF_STOCK', message: 'This item is out of stock.' },
        }, 409));
      }
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([]));
      if (/\/api\/products\/42(?:\?track_view=false)?$/.test(url)) return Promise.resolve(jsonResponse(detail));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductDetails product={product} currentUser={{ studentId: 'buyer-1' }} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Pay with Chapa' }))[0]);

    expect((await screen.findByRole('alert')).textContent).toContain('This item is out of stock.');
    await waitFor(() => expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Pay with Chapa' })).toBeNull();
  });

  it('shows Chapa checkout initialization errors without marking the cart complete', async () => {
    mockCartItems.push({ id: 8, product_id: 42, student_id: 'buyer-1', quantity: 1 });
    const checkoutWindow = { location: { href: '' }, opener: {}, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow);
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/products/42/pay-summary')) {
        return Promise.resolve(jsonResponse({
          title: 'Test phone',
          unit_price: '1000.00',
          total: '1000.00',
          quantity_limit: 1,
          seller_name: 'Seller',
        }));
      }
      if (url.endsWith('/api/products/42/checkout')) {
        return Promise.resolve(jsonResponse({
          detail: 'Seller must complete payout setup.',
        }, 409));
      }
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([]));
      if (/\/api\/products\/42(?:\?track_view=false)?$/.test(url)) return Promise.resolve(jsonResponse(detail));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductDetails product={product} currentUser={{ studentId: 'buyer-1' }} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Pay with Chapa' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Chapa · 1000.00 ETB' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Seller must complete payout setup.');
    expect(screen.getByRole('heading', { name: 'Pay with Chapa' })).toBeTruthy();
    expect(checkoutWindow.close).toHaveBeenCalledOnce();
    expect(mockMarkCheckoutComplete).not.toHaveBeenCalled();
  });

  it('opens Chapa checkout without requiring a Wallet PIN', async () => {
    mockCartItems.push({ id: 8, product_id: 42, student_id: 'buyer-1', quantity: 1 });
    const checkoutWindow = { location: { href: '' }, opener: {}, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow);
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/products/42/pay-summary')) {
        return Promise.resolve(jsonResponse({
          title: 'Test phone',
          unit_price: '1000.00',
          total: '1000.00',
          seller_commission: '10.00',
          quantity_limit: 1,
          seller_name: 'Seller',
        }));
      }
      if (url.endsWith('/api/products/42/checkout')) {
        return Promise.resolve(jsonResponse({
          checkout_url: 'https://checkout.chapa.test/tx',
          order_id: 123,
        }));
      }
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([]));
      if (/\/api\/products\/42(?:\?track_view=false)?$/.test(url)) return Promise.resolve(jsonResponse(detail));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductDetails
      product={product}
      currentUser={{ studentId: 'buyer-1', is_verified: true, access_token: 'student-token' }}
    />);

    expect(screen.getByText('Make sure you have inspected the product in person before completing the payment.')).toBeTruthy();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Pay with Chapa' }))[0]);
    expect(await screen.findByRole('heading', { name: 'Pay with Chapa' })).toBeTruthy();
    expect(screen.getAllByText('Make sure you have inspected the product in person before completing the payment.')).toHaveLength(2);
    expect(screen.getByText('10.00 ETB')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Chapa · 1000.00 ETB' }));

    await waitFor(() => expect(checkoutWindow.location.href).toBe('https://checkout.chapa.test/tx'));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/wallet/set-pin'))).toBe(false);
    expect(mockMarkCheckoutComplete).not.toHaveBeenCalled();
    const paymentRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/products/42/checkout'));
    expect(paymentRequest[1].method).toBe('POST');
    expect(JSON.parse(paymentRequest[1].body)).toEqual({ quantity: 1 });
  });

  it('does not expose wallet PIN recovery in product checkout', async () => {
    mockCartItems.push({ id: 8, product_id: 42, student_id: 'buyer-1', quantity: 1 });
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/products/42/pay-summary')) {
        return Promise.resolve(jsonResponse({
          title: 'Test phone',
          unit_price: '1000.00',
          total: '1000.00',
          quantity_limit: 1,
          seller_name: 'Seller',
        }));
      }
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([]));
      if (/\/api\/products\/42(?:\?track_view=false)?$/.test(url)) return Promise.resolve(jsonResponse(detail));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProductDetails
      product={product}
      currentUser={{ studentId: 'buyer-1', is_verified: true, access_token: 'student-token' }}
    />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Pay with Chapa' }))[0]);
    expect(await screen.findByRole('heading', { name: 'Pay with Chapa' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Wallet PIN/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/wallet/pin-reset/'))).toBe(false);
  });

  it.each([
    ['anonymous', null],
    ['signed-in', { studentId: 'buyer-1' }],
  ])('renders similar products below the description and reviews for %s visitors', async (_audience, currentUser) => {
    const detailedProduct = {
      ...detail,
      review_count: 1,
      reviews: [{
        id: 7,
        reviewer_name: 'Buyer',
        rating: 5,
        comment: 'Great item',
      }],
    };
    const fetchMock = vi.fn((input) => {
      const url = String(input);
      if (url.includes('/api/products/42/similar')) return Promise.resolve(jsonResponse([similarProduct]));
      if (url.includes('/api/products/42')) return Promise.resolve(jsonResponse(detailedProduct));
      if (url.includes('/api/settings/moderation')) return Promise.resolve(jsonResponse({ allowStudentReports: true }));
      if (url.includes('/api/settings/chat')) return Promise.resolve(jsonResponse({ enabled: true }));
      if (url.includes('/api/student/wishlist')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNavigate = vi.fn();
    render(
      <ProductDetails
        product={product}
        currentUser={currentUser}
        onNavigate={onNavigate}
      />,
    );

    const similarHeading = await screen.findByRole('heading', {
      name: 'productDetails.buyer.similarProducts',
    });
    const descriptionHeading = screen.getByRole('heading', { name: 'Detailed Description' });
    const reviewsHeading = screen.getByRole('heading', { name: 'Buyer ratings' });
    expect(descriptionHeading.compareDocumentPosition(reviewsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reviewsHeading.compareDocumentPosition(similarHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const card = await screen.findByRole('button', { name: /Similar book/ });
    fireEvent.click(card);
    expect(onNavigate).toHaveBeenCalledWith('product-details', { productId: 99 });

    const similarRequest = fetchMock.mock.calls.find(([input]) => String(input).includes('/similar'));
    expect(similarRequest).toHaveLength(2);
    expect(similarRequest[1].headers).toEqual({});
  });

  it('shows only the neutral placeholder when there are no gallery images', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, images: [], image: null, image_urls: [] },
    }));
    render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('Seller');
    const mainImage = screen.getByRole('img', { name: 'Test phone', exact: true });
    expect(mainImage.getAttribute('src')).toBe(IMAGE_PLACEHOLDER);
    expect(screen.queryByRole('button', { name: 'Previous image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Show product image/ })).toBeNull();
  });

  it('hides gallery controls and thumbnails for a single image', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, images: [galleryImageSet[0]], image: null, image_urls: [] },
    }));
    render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('Seller');
    expect(screen.queryByRole('button', { name: 'Previous image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Show product image/ })).toBeNull();
  });

  it('shows two images and wraps the next-image arrow back to the first', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, images: galleryImageSet.slice(0, 2), image: null, image_urls: [] },
    }));
    render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('1/2');
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next image' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Show product image/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('2/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it.each([
    ['JSON-string arrays', JSON.stringify(['/uploads/gallery-one.jpg', '/uploads/gallery-two.jpg'])],
    ['comma-separated values', '/uploads/gallery-one.jpg, /uploads/gallery-two.jpg'],
  ])('parses %s from the image field', async (_description, image) => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, image, images: [], image_urls: [] },
    }));
    render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('1/2');
    expect(screen.getAllByRole('button', { name: /Show product image/ })).toHaveLength(2);
  });

  it('supports thumbnail selection, wrapping arrows, keyboard, and touch for multiple images', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, images: galleryImageSet, image: null, image_urls: [] },
    }));
    render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('1/3');
    const gallery = screen.getByRole('group', { name: 'Product image gallery' });
    expect(screen.getAllByRole('button', { name: /Show product image/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('1/3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show product image 3' }));
    expect(screen.getByText('3/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('1/3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(screen.getByText('3/3')).toBeTruthy();

    fireEvent.keyDown(gallery, { key: 'ArrowLeft' });
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.touchStart(gallery, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(gallery, { changedTouches: [{ clientX: 40 }] });
    expect(screen.getByText('3/3')).toBeTruthy();
  });

  it('shows the image gallery controls in the owner view', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, is_owner: true, images: galleryImageSet, image: null, image_urls: [] },
    }));
    render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('1/3');
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeTruthy();
  });

  it('resets the gallery index when navigating to another product', async () => {
    vi.stubGlobal('fetch', galleryFetchMock({
      42: { ...detail, images: galleryImageSet, image: null, image_urls: [] },
      43: {
        ...detail,
        id: 43,
        title: 'Second product',
        images: galleryImageSet.slice(0, 2),
        image: null,
        image_urls: [],
      },
    }));
    const { rerender } = render(<ProductDetails product={product} currentUser={null} />);

    await screen.findByText('1/3');
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('2/3')).toBeTruthy();

    rerender(<ProductDetails product={{ ...product, id: 43, title: 'Second product' }} currentUser={null} />);

    expect(await screen.findByText('1/2')).toBeTruthy();
  });
});
