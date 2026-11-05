import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Check, LockKeyhole, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL, IMAGE_PLACEHOLDER, resolveImageUrl } from '../../config';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { getStudentAccessToken } from '../../utils/publicListings';
import SimilarProductsSection from './SimilarProductsSection';
import ProductPurchaseActions from '../ProductPurchaseActions';
import {
  buildProductReturnTo,
  restorePendingProductAction,
  startProductActionLogin,
} from '../../utils/productActionState';
import { buildOrderDashboardUrl } from '../../utils/orderDashboardLink';
import PaymentProviderLogo from '../PaymentProviderLogo';

const isVerifiedStudent = (student) => [true, 1, '1', 'true'].includes(student?.is_verified);
const PRODUCT_VIEW_STORAGE_KEY = 'viewed_products';
const PRODUCT_VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const hasRecentProductView = (productId, viewerKey) => {
  try {
    const viewedProducts = JSON.parse(localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY) || '{}');
    const viewedAt = Number(viewedProducts[`${viewerKey}:${productId}`]);
    const elapsed = Date.now() - viewedAt;
    return Number.isFinite(viewedAt) && elapsed >= 0 && elapsed < PRODUCT_VIEW_COOLDOWN_MS;
  } catch (error) {
    console.warn('Unable to read product view cooldown from local storage:', error);
    return false;
  }
};
const storeProductView = (productId, viewerKey) => {
  try {
    const viewedProducts = JSON.parse(localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY) || '{}');
    const now = Date.now();
    Object.entries(viewedProducts).forEach(([key, value]) => {
      const viewedAt = Number(value);
      if (!Number.isFinite(viewedAt) || now - viewedAt < 0 || now - viewedAt >= PRODUCT_VIEW_COOLDOWN_MS) {
        delete viewedProducts[key];
      }
    });
    viewedProducts[`${viewerKey}:${productId}`] = now;
    localStorage.setItem(PRODUCT_VIEW_STORAGE_KEY, JSON.stringify(viewedProducts));
  } catch (error) {
    console.warn('Unable to save product view cooldown to local storage:', error);
  }
};
const formatRelativeTime = (value, language) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const units = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  const [unit, unitSeconds] = units.find(([, size]) => Math.abs(seconds) >= size) || units[units.length - 1];
  return new Intl.RelativeTimeFormat(language === 'am' ? 'am' : 'en', { numeric: 'auto' })
    .format(Math.round(seconds / unitSeconds), unit);
};
const parseProductImages = (image) => {
  let imageValues;
  if (Array.isArray(image)) {
    imageValues = image;
  } else if (typeof image === 'string' && image.trim()) {
    const imageValue = image.trim();
    try {
      const parsedImage = JSON.parse(imageValue);
      imageValues = Array.isArray(parsedImage)
        ? parsedImage
        : typeof parsedImage === 'string'
          ? parsedImage.split(',')
          : imageValue.split(',');
    } catch {
      imageValues = imageValue.split(',');
    }
  } else {
    return [];
  }

  return imageValues.flatMap((value) => {
    if (typeof value === 'string') {
      const url = value.trim();
      return url ? [url] : [];
    }
    if (value && typeof value === 'object' && typeof value.url === 'string' && value.url.trim()) {
      return [{ ...value, url: value.url.trim() }];
    }
    return [];
  });
};

function ProductDetails({ product, currentUser, pendingAction, onPendingActionHandled, onNavigate, onNavigateToMessages, onBack, onStartChat }) {
  const { t, language } = useLanguage();
  const {
    items: cartItems,
    setItems: setCartItems,
    markCheckoutComplete,
    loadedStudentId: cartStudentId,
    loading: cartLoading,
    error: cartError,
  } = useCart();
  const [phoneProductId, setPhoneProductId] = useState(null);
  const [detailedProduct, setDetailedProduct] = useState(null);
  const [previewAsBuyer, setPreviewAsBuyer] = useState(false);
  const initialStatus = String(product?.status || '').trim().toLowerCase();
  const [ownerStockDraft, setOwnerStockDraft] = useState(String(product?.stock ?? 0));
  const [ownerStatusDraft, setOwnerStatusDraft] = useState(initialStatus === 'sold' ? 'sold-out' : ['paused', 'hidden'].includes(initialStatus) ? 'hidden' : 'active');
  const [ownerActionStatus, setOwnerActionStatus] = useState('');
  const [ownerActionLoading, setOwnerActionLoading] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const [cartStatus, setCartStatus] = useState('');
  const [cartAdding, setCartAdding] = useState(false);
  const [cartQuantityUpdating, setCartQuantityUpdating] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [isChatEnabled, setIsChatEnabled] = useState(true);
  const [chatDraft, setChatDraft] = useState({ productId: '', text: '', initialized: false });
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantitySelection, setQuantitySelection] = useState({ productId: '', quantity: 1 });
  const [allowStudentReports, setAllowStudentReports] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportEvidenceFile, setReportEvidenceFile] = useState(null);
  const [reportStatus, setReportStatus] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const galleryTouchStartXRef = useRef(null);
  const activeThumbnailRef = useRef(null);
  const [wishlistState, setWishlistState] = useState({
    studentId: '',
    productId: '',
    isWishlisted: false,
    itemId: null,
    loaded: false,
  });
  const [wishlistStatus, setWishlistStatus] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [showPayModal, setShowPayModal] = useState(false);
  const [paySummary, setPaySummary] = useState(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('telebirr');
  const [payStatusMessage, setPayStatusMessage] = useState('');
  const [payError, setPayError] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payResult, setPayResult] = useState(null);
  const [reportReasons, setReportReasons] = useState([]);
  const restoredActionRef = useRef('');
  const cartAddInFlightRef = useRef(false);
  const payAttemptKeyRef = useRef(null);
  const messageInputRef = useRef(null);
  const isAdmin = Boolean(currentUser?.isAdmin)
    || String(currentUser?.role || '').trim().toLowerCase() === 'admin';
  const verifiedCurrentUser = isVerifiedStudent(currentUser);
  const hasDetailsForCurrentProduct = String(detailedProduct?.id) === String(product?.id);
  const item = hasDetailsForCurrentProduct ? detailedProduct : product;
  const sellerPhone = item?.seller?.phone
    || item?.seller?.phone_number
    || item?.seller_phone
    || product?.seller?.phone
    || product?.seller?.phone_number
    || product?.seller_phone
    || '';
  const availableStock = Math.max(0, Number(item?.stock ?? 1));
  const currentUserStudentId = String(currentUser?.studentId || currentUser?.student_id || '').trim();
  const productSellerId = String(item?.seller_id || product?.seller_id || '').trim();
  const isOwnerStatusLoaded = hasDetailsForCurrentProduct && typeof detailedProduct?.is_owner === 'boolean';
  const isOwner = !isAdmin && Boolean(currentUser) && (
    (currentUserStudentId && productSellerId && currentUserStudentId === productSellerId)
    || (isOwnerStatusLoaded && detailedProduct.is_owner === true)
  );
  const showOwnerView = isOwner && !previewAsBuyer;
  const showBuyerView = !isAdmin && isOwnerStatusLoaded && (!isOwner || previewAsBuyer);
  const isReadOnlyPreview = isOwner && previewAsBuyer;
  const buyerStudentId = String(currentUser?.studentId || currentUser?.student_id || '').trim();
  const currentUserAccessToken = getStudentAccessToken(currentUser);
  const showPhone = phoneProductId === String(product?.id || '');
  const cartLoaded = Boolean(buyerStudentId && cartStudentId === buyerStudentId && !cartLoading && !cartError);
  const cartItem = cartLoaded
    ? cartItems.find((cartEntry) => String(cartEntry.product_id) === String(product?.id))
    : null;
  const isInCart = Boolean(cartItem);
  const productId = String(product?.id || '');
  const selectedQuantity = isInCart
    ? Number(cartItem.quantity || 1)
    : quantitySelection.productId === productId
      ? quantitySelection.quantity
      : 1;
  const setSelectedQuantity = (nextQuantity) => {
    const previousQuantity = quantitySelection.productId === productId
      ? quantitySelection.quantity
      : 1;
    setQuantitySelection({
      productId,
      quantity: typeof nextQuantity === 'function' ? nextQuantity(previousQuantity) : nextQuantity,
    });
    payAttemptKeyRef.current = null;
  };
  const currentWishlistStudentId = String(currentUser?.studentId || currentUser?.student_id || '');
  const currentWishlistProductId = String(item?.id || product?.id || '');
  const wishlistMatchesCurrent = Boolean(
    currentWishlistStudentId
    && currentWishlistProductId
    && wishlistState.studentId === currentWishlistStudentId
    && wishlistState.productId === currentWishlistProductId,
  );
  const isWishlisted = wishlistMatchesCurrent && wishlistState.isWishlisted;
  const wishlistItemId = wishlistMatchesCurrent ? wishlistState.itemId : null;
  const wishlistLoadedFor = wishlistMatchesCurrent && wishlistState.loaded
    ? currentWishlistStudentId
    : '';
  const productTitleForChat = String(item?.title || '').trim();
  const defaultChatMessage = productTitleForChat
    ? `Hi, I am interested in buying your ${productTitleForChat}. Is it still available?`
    : '';
  const chatDraftMatchesCurrent = chatDraft.productId === productId && chatDraft.initialized;
  const messageText = chatDraftMatchesCurrent ? chatDraft.text : defaultChatMessage;
  const setMessageText = (nextText) => {
    const currentText = chatDraft.productId === productId && chatDraft.initialized
      ? chatDraft.text
      : defaultChatMessage;
    setChatDraft({
      productId,
      initialized: true,
      text: typeof nextText === 'function' ? nextText(currentText) : nextText,
    });
  };
  const requireLogin = (action, quantity = 1) => {
    startProductActionLogin({ returnTo: product?.id, action, quantity }, () => {
      onNavigate?.('login', {
        returnTo: buildProductReturnTo(product?.id),
        message: t('productDetails.loginPrompt'),
      });
    });
  };
  const promptLoginToMessage = () => {
    toast.error('Please sign in to message the seller.');
    requireLogin('sendMessage');
  };

  useEffect(() => {
    if (!product?.id) return;
    const fetchProductDetails = async () => {
      try {
        const viewerKey = String(
          currentUser?.studentId || currentUser?.student_id || 'guest',
        );
        const recentlyViewed = hasRecentProductView(product.id, viewerKey);
        const trackViewQuery = recentlyViewed ? '?track_view=false' : '';
        const response = await fetch(`${API_BASE_URL}/api/products/${product.id}${trackViewQuery}`, {
          headers: currentUserAccessToken ? { Authorization: `Bearer ${currentUserAccessToken}` } : {},
        });
        if (!response.ok) {
          throw new Error('Failed to fetch product details');
        }
        const data = await response.json();
        if (!recentlyViewed && !data.is_owner) {
          storeProductView(product.id, viewerKey);
        }
        setDetailedProduct(data);
        setOwnerStockDraft(String(data.stock ?? 0));
        const status = String(data.status || '').trim().toLowerCase();
        setOwnerStatusDraft(status === 'sold' ? 'sold-out' : ['paused', 'hidden'].includes(status) ? 'hidden' : 'active');
        setPreviewAsBuyer(false);
      } catch (error) {
        console.error(error);
      }
    };

    fetchProductDetails();
  }, [
    product?.id,
    currentUser?.studentId,
    currentUser?.student_id,
    currentUser?.role,
    currentUserAccessToken,
  ]);

  useEffect(() => {
    const studentId = currentUser?.studentId || currentUser?.student_id;
    if (!studentId || !product?.id) return undefined;

    let active = true;
    fetch(`${API_BASE_URL}/api/student/wishlist?student_id=${encodeURIComponent(studentId)}`)
      .then((response) => response.ok ? response.json() : [])
      .then((items) => {
        const match = (Array.isArray(items) ? items : []).find((wishlistItem) => String(wishlistItem.product_id) === String(product.id));
        if (active) {
          setWishlistState({
            studentId: String(studentId),
            productId: String(product.id),
            isWishlisted: Boolean(match),
            itemId: match?.id || null,
            loaded: true,
          });
        }
      })
      .catch(() => {
        if (active) {
          setWishlistState({
            studentId: String(studentId),
            productId: String(product.id),
            isWishlisted: false,
            itemId: null,
            loaded: true,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [currentUser?.studentId, currentUser?.student_id, product?.id]);

  useEffect(() => {
    payAttemptKeyRef.current = null;
  }, [product?.id]);

  useEffect(() => {
    setSelectedImageIndex(0);
    setIsZoomed(false);
  }, [product?.id]);

  useEffect(() => {
    let active = true;

    const fetchModerationSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings/moderation`);
        if (!response.ok) throw new Error('Failed to fetch moderation settings');
        const data = await response.json();
        if (active) setAllowStudentReports(data.allowStudentReports === true);
      } catch (error) {
        if (active) setAllowStudentReports(false);
        console.error(error);
      }
    };

    fetchModerationSettings();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const fetchChatSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings/chat`);
        if (!response.ok) throw new Error('Failed to fetch chat settings');
        const data = await response.json();
        if (active && typeof data.enabled === 'boolean') {
          setIsChatEnabled(data.enabled);
        }
      } catch (error) {
        console.error(error);
      }
    };

    fetchChatSettings();
    return () => {
      active = false;
    };
  }, []);

  const handleStartChat = async () => {
    if (!buyerStudentId || !currentUserAccessToken) {
      promptLoginToMessage();
      return;
    }
    if (!isChatEnabled) {
      setChatStatus('Chat is currently disabled by the administrator.');
      return;
    }

    if (!verifiedCurrentUser) {
      setChatStatus('Verification is required to start a chat with other students.');
      return;
    }

    const buyerId = currentUser?.studentId;
    const sellerId = item?.seller_id || item?.seller;

    if (!buyerId || !product?.id || !messageText.trim() || !sellerId) {
      setChatStatus('Enter a message before starting the chat.');
      return;
    }

    setChatLoading(true);
    setChatStatus('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/student/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentUserAccessToken}`,
        },
        body: JSON.stringify({
          sender_id: buyerId,
          receiver_id: sellerId,
          product_id: product.id,
          message_text: messageText.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          promptLoginToMessage();
          return;
        }
        const detail = data?.detail;
        throw new Error(
          typeof detail === 'string'
            ? detail
            : detail?.message || 'Unable to send chat request.',
        );
      }

      setMessageText('');
      setChatStatus(data.message || 'Message sent successfully.');
      if (typeof onStartChat === 'function') {
        onStartChat();
      }
      if (typeof onNavigateToMessages === 'function') {
        onNavigateToMessages();
      } else if (typeof onNavigate === 'function') {
        onNavigate('student-dashboard');
      }
    } catch (error) {
      const message = error.message || 'Unable to send chat request.';
      setChatStatus(message);
      toast.error(message);
    } finally {
      setChatLoading(false);
    }
  };

  const handleAddToCartFromSearch = async (productId, quantity = 1) => {
    const session = JSON.parse(window.localStorage.getItem('campaceSession') || '{}');
    const response = await fetch(`${API_BASE_URL}/api/student/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token || session.user?.access_token || ''}`,
      },
      body: JSON.stringify({
        student_id: buyerStudentId,
        product_id: Number(productId),
        quantity: Number(quantity),
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Unable to add this product to your cart.');
    }
    return data;
  };

  const handleAddToCart = async (requestedQuantity = selectedQuantity) => {
    const studentId = buyerStudentId;
    if (!studentId) {
      requireLogin('addToCart', selectedQuantity);
      return;
    }
    if (!cartLoaded) return;
    if (isOwner) {
      setCartStatus(t('studentToast.ownProductAction'));
      return;
    }
    if (isInCart || cartAddInFlightRef.current) return;

    cartAddInFlightRef.current = true;
    setCartAdding(true);
    setCartStatus('');
    try {
      const quantity = typeof requestedQuantity === 'number' ? requestedQuantity : selectedQuantity;
      const data = await handleAddToCartFromSearch(item?.id || product?.id, quantity);
      const addedItem = {
        ...item,
        id: data.item?.id,
        product_id: data.item?.product_id ?? Number(productId),
        student_id: data.item?.student_id ?? studentId,
        quantity: data.item?.quantity ?? quantity,
      };
      setCartItems((previous) => [
        ...previous.filter((cartEntry) => String(cartEntry.product_id) !== productId),
        addedItem,
      ]);
      setCartStatus('Product added to cart successfully.');
    } catch (error) {
      const detail = error.message;
      setCartStatus(typeof detail === 'string' ? detail : 'Unable to add this product to your cart.');
      console.error(error);
    } finally {
      cartAddInFlightRef.current = false;
      setCartAdding(false);
    }
  };

  const handleQuantityChange = async (nextQuantity) => {
    const previousQuantity = isInCart ? selectedQuantity : quantitySelection.productId === productId ? quantitySelection.quantity : 1;
    const requestedQuantity = typeof nextQuantity === 'function' ? nextQuantity(previousQuantity) : nextQuantity;
    const quantity = Math.max(1, Math.min(availableStock, Number(requestedQuantity)));
    if (!isInCart) {
      setSelectedQuantity(quantity);
      return;
    }
    if (!cartItem || cartQuantityUpdating || quantity === selectedQuantity) return;

    setCartQuantityUpdating(true);
    setCartStatus('');
    try {
      const token = getStudentAccessToken(currentUser);
      const response = await fetch(`${API_BASE_URL}/api/student/cart/${cartItem.id}/quantity`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ quantity }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Unable to update cart quantity.');
      }
      setCartItems((previous) => previous.map((entry) => (
        entry.id === cartItem.id
          ? { ...entry, quantity: data.item?.quantity ?? quantity }
          : entry
      )));
    } catch (error) {
      setCartStatus(error.message || 'Unable to update cart quantity.');
      console.error(error);
    } finally {
      setCartQuantityUpdating(false);
    }
  };

  const refreshPaySummary = useCallback(async () => {
    const token = getStudentAccessToken(currentUser);
    const requestedProductId = item?.id || product?.id;
    const response = await fetch(
      `${API_BASE_URL}/api/products/${encodeURIComponent(requestedProductId)}/pay-summary?quantity=${selectedQuantity}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      if (detail?.code === 'OUT_OF_STOCK') {
        const stock = Math.max(0, Number(detail.stock) || 0);
        setDetailedProduct((previous) => (
          String(previous?.id) === String(requestedProductId)
            ? { ...previous, stock, ...(stock === 0 ? { status: 'Sold' } : {}) }
            : previous
        ));
      }
      setPaySummary(null);
      throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Unable to load payment details.');
    }
    setPaySummary(data);
    setPayError('');
    return data;
  }, [currentUser, item?.id, product?.id, selectedQuantity]);

  const openPayModal = async () => {
    if (!currentUser?.studentId && !currentUser?.student_id) {
      requireLogin('pay', selectedQuantity);
      return;
    }
    setPayResult(null);
    setPaySummary(null);
    setPayError('');
    setPayStatusMessage('');
    setShowPayModal(true);
    try {
      await refreshPaySummary();
    } catch (error) {
      setPayError(error.message || 'Unable to load payment details.');
    }
  };

  const submitProductPayment = async (event) => {
    event.preventDefault();
    if (payLoading || !paySummary) return;
    const checkoutWindow = window.open('about:blank', '_blank');
    if (!checkoutWindow) {
      setPayError('Allow pop-ups to open Chapa checkout, then try again.');
      return;
    }
    checkoutWindow.opener = null;
    setPayLoading(true);
    setPayError('');
    const token = getStudentAccessToken(currentUser);
    // Reuse the key for uncertain retries; only a new intent or definitive response creates another.
    const payIntent = `${String(currentUser?.studentId || currentUser?.student_id || '')}:${String(item?.id || product?.id || '')}:${selectedQuantity}`;
    const storageKey = `campacePayAttempt:${payIntent}`;
    const clearPaymentAttempt = () => {
      payAttemptKeyRef.current = null;
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch (error) {
        console.error('Unable to clear the completed payment attempt key.', error);
      }
    };
    try {
      const previousAttempt = payAttemptKeyRef.current;
      const storedKey = window.sessionStorage.getItem(storageKey);
      const requestKey = previousAttempt?.intent === payIntent
        ? previousAttempt.key
        : storedKey || `pay-${window.crypto?.randomUUID?.() || `${Date.now()}-${window.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] || 'attempt'}`}`;
      window.sessionStorage.setItem(storageKey, requestKey);
      payAttemptKeyRef.current = { intent: payIntent, key: requestKey };
      const response = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(item?.id || product?.id)}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          quantity: selectedQuantity,
          payment_method: selectedPaymentMethod,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || (!data.checkout_url && !data.already_paid)) {
        checkoutWindow.close();
        const detail = data.detail;
        if (response.status >= 400 && response.status < 500) {
          clearPaymentAttempt();
        }
        setPayError(typeof detail === 'string' ? detail : detail?.message || 'Unable to start Chapa checkout.');
        return;
      }
      if (data.already_paid) {
        checkoutWindow.close();
        setPayResult(data);
        markCheckoutComplete();
        clearPaymentAttempt();
        return;
      }
      checkoutWindow.location.href = data.checkout_url;
      setPayStatusMessage('Complete your payment in the new tab. Your order will update after Chapa confirms it.');
    } catch (error) {
      checkoutWindow.close();
      setPayError(error.message || 'Connection error. Retry this payment to safely check its status.');
    } finally {
      setPayLoading(false);
    }
  };

  useEffect(() => {
    if (!showPayModal) return undefined;
    const refreshWhenReturning = () => {
      refreshPaySummary().catch((error) => setPayError(error.message || 'Unable to refresh checkout details.'));
    };
    window.addEventListener('focus', refreshWhenReturning);
    return () => window.removeEventListener('focus', refreshWhenReturning);
  }, [showPayModal, refreshPaySummary]);

  const handleToggleWishlist = async () => {
    const studentId = currentUser?.studentId || currentUser?.student_id;
    if (!studentId) {
      requireLogin('wishlist');
      return;
    }

    try {
      const response = isWishlisted
        ? await fetch(`${API_BASE_URL}/api/student/wishlist/${wishlistItemId}`, { method: 'DELETE' })
        : await fetch(`${API_BASE_URL}/api/student/wishlist`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getStudentAccessToken(currentUser)}`,
          },
          body: JSON.stringify({ student_id: studentId, product_id: Number(product.id) }),
        });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Unable to update wishlist.');
      }
      const data = isWishlisted ? {} : await response.json().catch(() => ({}));
      setWishlistState({
        studentId: currentWishlistStudentId,
        productId: currentWishlistProductId,
        isWishlisted: !isWishlisted,
        itemId: data.id || null,
        loaded: true,
      });
      const statusMessage = isWishlisted ? 'Removed from wishlist.' : 'Added to wishlist.';
      setWishlistStatus(statusMessage);
      toast.success(statusMessage);
    } catch (error) {
      const errorMessage = error.message === 'You cannot buy or save your own product.'
        ? t('studentToast.ownProductAction')
        : error.message || 'Unable to update wishlist.';
      setWishlistStatus(errorMessage);
      toast.error(errorMessage);
    }
  };

  const handleShowContact = () => {
    const studentId = currentUser?.studentId || currentUser?.student_id;
    if (!isAdmin && !studentId) {
      requireLogin('showContact');
      return;
    }
    setPhoneProductId((previous) => (
      previous === String(product?.id || '') ? null : String(product?.id || '')
    ));
  };

  const handleCopySellerPhone = async () => {
    if (!sellerPhone) return;
    try {
      await navigator.clipboard.writeText(sellerPhone);
      toast.success('Phone number copied.');
    } catch (error) {
      console.error('Unable to copy the seller phone number:', error);
      toast.error('Unable to copy the phone number.');
    }
  };

  const runPendingAction = useEffectEvent((action) => restorePendingProductAction(action, {
    addToCart: ({ quantity }) => handleAddToCart(quantity),
    showContact: () => setPhoneProductId(String(product?.id || '')),
    wishlist: async () => {
      if (!isWishlisted) await handleToggleWishlist();
    },
    pay: () => openPayModal(),
    report: () => setShowReportForm(true),
    sendMessage: () => messageInputRef.current?.focus(),
  }, onPendingActionHandled));
  const clearPendingAction = useEffectEvent(() => onPendingActionHandled?.());

  useEffect(() => {
    const studentId = currentUser?.studentId || currentUser?.student_id;
    if (!pendingAction || !studentId || String(pendingAction.returnTo) !== String(product?.id)) return;
    if (!isOwnerStatusLoaded) return;
    if (isOwner) {
      clearPendingAction();
      return;
    }
    if (['addToCart', 'pay'].includes(pendingAction.action) && !cartLoaded) return;
    if (pendingAction.action === 'wishlist' && wishlistLoadedFor !== String(studentId)) return;
    if (pendingAction.action === 'pay' && !isInCart) {
      clearPendingAction();
      return;
    }

    const actionKey = `${pendingAction.returnTo}:${pendingAction.action}:${pendingAction.quantity}`;
    if (restoredActionRef.current === actionKey) return;
    restoredActionRef.current = actionKey;

    runPendingAction(pendingAction).catch((error) => {
      setCartStatus(error.message || 'Unable to restore this product action.');
    });
  }, [currentUser, pendingAction, product?.id, wishlistLoadedFor, cartLoaded, isInCart, isOwnerStatusLoaded, isOwner]);

  const handleMakeOffer = () => {
    const amount = offerAmount.trim() || '[amount]';
    setMessageText(`Hi, I'd like to offer ${amount} ETB for this item. Is that acceptable?`);
    setChatStatus('Offer message ready. Edit it before sending.');
  };

  const handleShare = async (destination) => {
    const shareUrl = window.location.href;
    const shareText = `${displayTitle} on Campace Market`;
    if (destination === 'copy') {
      await navigator.clipboard?.writeText(shareUrl);
      setChatStatus('Product link copied.');
    } else {
      const target = destination === 'telegram'
        ? `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`
        : `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
      window.open(target, '_blank', 'noopener,noreferrer');
    }
    setShowShareMenu(false);
  };

  const handleSubmitReport = async (event) => {
    event.preventDefault();
    if (!allowStudentReports || !currentUser || !product?.id || !reportReasons.length || !reportText.trim()) return;

    setReportLoading(true);
    setReportStatus('');
    try {
      const formData = new FormData();
      formData.append('product_id', String(product.id));
      formData.append('student_id', currentUser.studentId || '');
      formData.append('student_name', currentUser.name || currentUser.studentId || 'Student');
      formData.append('email', currentUser.email || '');
      formData.append('category', 'Product Report');
      formData.append('issue', `${reportReasons.join(', ')}: ${reportText.trim()}`);
      if (reportEvidenceFile) formData.append('evidence_image', reportEvidenceFile);

      const response = await fetch(`${API_BASE_URL}/api/student/report`, {
        method: 'POST',
        headers: currentUser?.access_token || currentUser?.accessToken || currentUser?.token
          ? { Authorization: `Bearer ${currentUser.access_token || currentUser.accessToken || currentUser.token}` }
          : {},
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map((error) => error.msg || 'Invalid report data.').join(', ')
          : data.detail;
        throw new Error(detail || 'Unable to report this product.');
      }

      setReportText('');
      setReportReasons([]);
      setReportEvidenceFile(null);
      setShowReportForm(false);
      setReportStatus(data.message || 'Product report submitted successfully.');
    } catch (error) {
      setReportStatus(error.message || 'Unable to report this product.');
      console.error(error);
    } finally {
      setReportLoading(false);
    }
  };

  const saveOwnerStock = async () => {
    const quantity = Number(ownerStockDraft);
    if (!Number.isInteger(quantity) || quantity < 0) {
      setOwnerActionStatus(t('productDetails.owner.invalidStock'));
      return;
    }
    const status = ownerStatusDraft === 'sold-out' ? 'Sold' : ownerStatusDraft === 'hidden' ? 'Paused' : 'Approved';
    const nextQuantity = status === 'Sold' ? 0 : quantity;
    if (status !== 'Sold' && nextQuantity < 1) {
      setOwnerActionStatus(t('productDetails.owner.stockRequired'));
      return;
    }
    const token = getStudentAccessToken(currentUser);
    setOwnerActionLoading(true);
    setOwnerActionStatus('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/products/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ quantity: nextQuantity, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || t('productDetails.owner.updateFailed'));
      }
      setDetailedProduct((previous) => ({ ...previous, ...data.product }));
      setOwnerStockDraft(String(data.product?.stock ?? nextQuantity));
      setOwnerStatusDraft(status === 'Sold' ? 'sold-out' : status === 'Paused' ? 'hidden' : 'active');
      setOwnerActionStatus(t('productDetails.owner.stockSaved'));
    } catch (error) {
      setOwnerActionStatus(error.message || t('productDetails.owner.updateFailed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const toggleListingStatus = async () => {
    const restoring = ownerStatusDraft !== 'active';
    const quantity = restoring ? Math.max(1, Number(item.stock) || Number(ownerStockDraft) || 1) : 0;
    const status = restoring ? 'Approved' : 'Sold';
    const token = getStudentAccessToken(currentUser);
    setOwnerActionLoading(true);
    setOwnerActionStatus('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/products/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ quantity, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || t('productDetails.owner.updateFailed'));
      }
      setDetailedProduct((previous) => ({ ...previous, ...data.product }));
      setOwnerStockDraft(String(data.product?.stock ?? quantity));
      setOwnerStatusDraft(restoring ? 'active' : 'sold-out');
      setOwnerActionStatus(t('productDetails.owner.stockSaved'));
    } catch (error) {
      setOwnerActionStatus(error.message || t('productDetails.owner.updateFailed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const delistAdminProduct = async () => {
    const token = getStudentAccessToken(currentUser);
    setOwnerActionLoading(true);
    setOwnerActionStatus('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/products/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'Pending' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Unable to delist this product.');
      }
      setDetailedProduct((previous) => ({ ...previous, status: data.status || 'Pending' }));
      setOwnerActionStatus('Listing delisted and moved to moderation.');
    } catch (error) {
      setOwnerActionStatus(error.message || 'Unable to delist this product.');
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const deleteOwnerListing = async () => {
    const token = getStudentAccessToken(currentUser);
    setOwnerActionLoading(true);
    setOwnerActionStatus('');
    try {
      const endpoint = isAdmin
        ? `${API_BASE_URL}/api/admin/products/${item.id}`
        : `${API_BASE_URL}/api/student/products/${item.id}`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || t('productDetails.owner.deleteFailed'));
      }
      setShowDeleteConfirmation(false);
      onBack?.();
    } catch (error) {
      setShowDeleteConfirmation(false);
      setOwnerActionStatus(error.message || t('productDetails.owner.deleteFailed'));
    } finally {
      setOwnerActionLoading(false);
    }
  };

  const purchaseBlocked = !isOwnerStatusLoaded || isOwner || availableStock === 0 || selectedQuantity > availableStock;

  const productTitle = String(item?.title || '').trim();
  const displayTitle = productTitle.length >= 3
    ? productTitle.charAt(0).toUpperCase() + productTitle.slice(1)
    : 'Campus Marketplace Item';
  const priceValue = Number.parseFloat(String(item?.price || '').replace(/[^0-9.]/g, ''));
  const itemTotal = Number.isFinite(priceValue) ? priceValue * selectedQuantity : null;
  const formattedPrice = Number.isFinite(priceValue)
    ? `${priceValue.toLocaleString('en-ET', { maximumFractionDigits: 2 })} ETB`
    : 'Negotiable';
  const campusLocation = String(
    item?.pickup_location
      || item?.pickup_point
      || item?.handover_location
      || item?.location
      || '',
  ).trim() || 'Not specified';
  const toGalleryEntry = (image) => (
    typeof image === 'string' ? { url: image, note: null } : image
  );
  const galleryImages = [
    ...parseProductImages(item?.images).map(toGalleryEntry),
    ...parseProductImages(item?.image).map(toGalleryEntry),
    ...parseProductImages(item?.image_urls).map(toGalleryEntry),
  ].filter((image) => image?.url).filter((image, index, images) => images.findIndex((candidate) => candidate.url === image.url) === index);
  const fallbackImage = 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1200&q=80';
  const hasMultipleImages = galleryImages.length > 1;
  const activeIndex = galleryImages.length ? selectedImageIndex % galleryImages.length : 0;
  const activeEntry = galleryImages[activeIndex] || { url: IMAGE_PLACEHOLDER, note: null };
  const activeImage = activeEntry.url;
  useEffect(() => {
    activeThumbnailRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeIndex]);
  const handleGalleryKeyDown = (event) => {
    if (!hasMultipleImages || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setSelectedImageIndex((index) => (
      event.key === 'ArrowLeft'
        ? (index - 1 + galleryImages.length) % galleryImages.length
        : (index + 1) % galleryImages.length
    ));
  };
  const handleGalleryTouchStart = (event) => {
    galleryTouchStartXRef.current = event.touches[0]?.clientX ?? null;
  };
  const handleGalleryTouchEnd = (event) => {
    const startX = galleryTouchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX;
    galleryTouchStartXRef.current = null;
    if (!hasMultipleImages || startX === null || endX === undefined) return;

    const deltaX = endX - startX;
    if (Math.abs(deltaX) < 40) return;
    setSelectedImageIndex((index) => (
      deltaX < 0
        ? (index + 1) % galleryImages.length
        : (index - 1 + galleryImages.length) % galleryImages.length
    ));
  };
  const reviews = Array.isArray(item?.reviews) ? item.reviews : [];
  const reviewCount = Number(item?.review_count || reviews.length);
  const similarProducts = Array.isArray(item?.similar_products) ? item.similar_products : [];
  const moreFromSeller = Array.isArray(item?.more_from_seller) ? item.more_from_seller.slice(0, 4) : [];
  const responseTimeHours = Number(item?.seller_response_time_hours);
  const sellerReviewCount = Number(item?.seller_review_count || 0);
  const sellerAverageRating = Number(item?.seller_average_rating || 0);
  const viewCount = Number(item?.views ?? item?.stats?.views ?? 0);
  const postedRelativeTime = item?.created_at ? formatRelativeTime(item.created_at, language) : '';
  const postedFullDate = item?.created_at
    ? new Date(item.created_at).toLocaleString(language === 'am' ? 'am-ET' : 'en-ET')
    : '';
  const sellerMemberSince = item?.seller_member_since
    ? new Date(item.seller_member_since).toLocaleDateString(language === 'am' ? 'am-ET' : 'en-ET', { year: 'numeric', month: 'long' })
    : '';
  const sellerTypicalResponseBucket = item?.seller_typical_response_bucket;
  const isNegotiable = item?.negotiable === true;
  const pickupHours = item?.pickup_hours;
  const additionalSpecifications = [
    ['Brand', item?.brand],
    ['Model', item?.model],
    ['Screen Size', item?.screen_size],
    ['Resolution', item?.resolution],
    ['Ports', item?.ports],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim());

  if (!product) return null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] animate-fade-in lg:pb-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center text-sm text-slate-500">
          <button onClick={onBack} className="font-semibold text-slate-700 hover:text-emerald-600 transition cursor-pointer">Home</button>
          <span className="mx-2">&gt;</span>
          <span>{item.category || 'Category'}</span>
          <span className="mx-2">&gt;</span>
          <span className="max-w-[150px] truncate font-semibold text-slate-900 sm:max-w-xs">{displayTitle}</span>
        </div>
        <button
          onClick={onBack}
          className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
        >
          ← Back to Listings
        </button>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="contents lg:col-start-1 lg:block lg:space-y-6">
          <section className="order-1 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:order-none">
            <div
              className="relative overflow-hidden rounded-xl bg-slate-50"
              role="group"
              aria-label="Product image gallery"
              tabIndex={hasMultipleImages ? 0 : undefined}
              onKeyDown={handleGalleryKeyDown}
              onTouchStart={handleGalleryTouchStart}
              onTouchEnd={handleGalleryTouchEnd}
            >
              <button type="button" onClick={() => setIsZoomed(true)} className="block aspect-[4/3] w-full cursor-zoom-in bg-slate-50" aria-label="Zoom product image">
                <img src={resolveImageUrl(activeImage)} alt={displayTitle} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-full w-full object-contain" />
              </button>
              {hasMultipleImages && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedImageIndex((index) => (index - 1 + galleryImages.length) % galleryImages.length)}
                    aria-label="Previous image"
                    className="btn-primary absolute left-3 top-1/2 z-10 flex h-10 min-h-10 w-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-full text-xl font-bold"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedImageIndex((index) => (index + 1) % galleryImages.length)}
                    aria-label="Next image"
                    className="btn-primary absolute right-3 top-1/2 z-10 flex h-10 min-h-10 w-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-full text-xl font-bold"
                  >
                    ›
                  </button>
                  <span className="absolute bottom-3 left-3 rounded-full bg-slate-950/75 px-2.5 py-1 text-xs font-bold text-white">
                    {activeIndex + 1}/{galleryImages.length}
                  </span>
                </>
              )}
            </div>
            {hasMultipleImages && (
              <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto overscroll-x-contain p-3 [scrollbar-width:thin]">
                {galleryImages.map((image, index) => (
                  <button
                    key={`${image.url}-${index}`}
                    ref={index === activeIndex ? activeThumbnailRef : null}
                    type="button"
                    onClick={() => setSelectedImageIndex(index)}
                    aria-label={`Show product image ${index + 1}`}
                    aria-pressed={activeIndex === index}
                    className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition ${activeIndex === index ? 'border-emerald-500' : 'border-slate-200 hover:border-slate-400'}`}
                  >
                    <img src={resolveImageUrl(image.url)} alt={`${displayTitle} thumbnail ${index + 1}`} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-full w-full object-cover" />
                    {image.note && <span title={image.note} className="absolute bottom-1 right-1 rounded-full bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-bold text-white">i</span>}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="order-3 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:order-none">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold text-slate-950">{displayTitle}</h1>
                {isOwner && <span className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{t('productDetails.owner.badge')}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {showBuyerView && !isOwner && <button type="button" onClick={handleToggleWishlist} aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'} className={`flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-2xl ${isWishlisted ? 'text-rose-500' : 'text-slate-500'} hover:text-rose-500`}>{isWishlisted ? '♥' : '♡'}</button>}
                <div className="relative">
                  <button type="button" onClick={() => setShowShareMenu((previous) => !previous)} className="rounded-full border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">↗ Share</button>
                  {showShareMenu && <div className="absolute right-0 z-20 mt-2 w-48 rounded-2xl border border-slate-200 bg-white p-2 text-left shadow-xl"><button type="button" onClick={() => handleShare('copy')} className="block w-full rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Copy Link</button><button type="button" onClick={() => handleShare('telegram')} className="block w-full rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Share to Telegram</button><button type="button" onClick={() => handleShare('whatsapp')} className="block w-full rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Share to WhatsApp</button></div>}
                </div>
              </div>
              {isOwner && (
                <label className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={previewAsBuyer} onChange={(event) => setPreviewAsBuyer(event.target.checked)} />
                  {t('productDetails.owner.previewAsBuyer')}
                </label>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-y border-slate-100 py-3 text-xs font-semibold text-slate-500 sm:text-sm">
              {showBuyerView ? (
                <>
                  <span>{t('productDetails.buyer.handover')}: {campusLocation}</span>
                  {pickupHours && <span>{t('productDetails.buyer.availableHours')}: {pickupHours}</span>}
                  <span title={postedFullDate}>{t('productDetails.buyer.posted')} {postedRelativeTime || t('productDetails.buyer.recently')}</span>
                  <span>{viewCount} {t('productDetails.buyer.peopleViewed')}</span>
                </>
              ) : (
                <>
                  <span>{t('productDetails.buyer.handover')}: {campusLocation}</span>
                  {pickupHours && <span>{pickupHours}</span>}
                  <span>Posted {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'recently'}</span>
                  <span>{viewCount} people viewed this listing</span>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[item.condition || 'Used', item.category || 'General', item.subcategory || 'General'].map((chip) => (
                <span key={chip} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{chip}</span>
              ))}
            </div>
            <div className="mt-4">
              <h2 className="text-lg font-bold text-slate-900">Detailed Description</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{item.description || 'No additional description provided by the seller.'}</p>
            </div>
            {additionalSpecifications.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h2 className="text-base font-bold text-slate-900">Key Specifications</h2>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  {additionalSpecifications.map(([label, value]) => (
                    <div key={label} className="min-w-0 border-b border-slate-100 py-2">
                      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
                      <dd className="mt-0.5 break-words text-sm font-bold text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {wishlistStatus && <p className="mt-3 text-sm text-slate-500">{wishlistStatus}</p>}
            {reviewCount > 0 && (
              <section className="mt-5 border-t border-slate-100 pt-4" aria-labelledby="buyer-ratings-heading">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">Reviews</p><h2 id="buyer-ratings-heading" className="mt-1 text-xl font-black text-slate-900">Buyer ratings</h2></div>
                  <div className="text-right"><p className="text-2xl font-black text-amber-500">{Number(item.average_rating || 0).toFixed(1)} ★</p><p className="text-xs font-semibold text-slate-500">{reviewCount} review{reviewCount === 1 ? '' : 's'}</p></div>
                </div>
                <div className="mt-4 space-y-4">
                  {reviews.map((review) => (
                    <article key={review.id} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-slate-900">{review.reviewer_name || 'Buyer'}</p><p className="text-xs font-semibold text-slate-500">{review.created_at ? new Date(review.created_at).toLocaleDateString() : 'Recent'}</p></div>
                      <p className="mt-1 text-sm font-black text-amber-500">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}<span className="ml-2 text-slate-400">{Number(review.rating) || 0}/5</span></p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{review.comment}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </section>

          {isOwner && similarProducts.length > 0 && (
            <section className="order-7 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:order-none" aria-labelledby="similar-products-heading">
              <h2 id="similar-products-heading" className="text-xl font-black text-slate-900">{t('productDetails.buyer.similarProducts')}</h2>
              <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {similarProducts.map((similar) => (
                  <button key={similar.id} type="button" onClick={() => onNavigate?.('product-details', { productId: similar.id })} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-md">
                    <img src={resolveImageUrl(similar.image || fallbackImage)} alt={similar.title || 'Similar product'} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-28 w-full object-cover sm:h-36" />
                    <span className="flex min-w-0 flex-1 flex-col p-3">
                      <span className="text-sm font-bold text-emerald-700">{similar.price ? `${Number(similar.price).toLocaleString('en-ET', { maximumFractionDigits: 2 })} ETB` : 'Negotiable'}</span>
                      <span className="mt-1 line-clamp-2 break-words text-sm font-semibold text-slate-900">{similar.title || 'Campus item'}</span>
                      <span className="mt-2 line-clamp-1 text-xs text-slate-500">{similar.pickup_location || similar.location || 'Not specified'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {showBuyerView && !isOwner && (
            <SimilarProductsSection
              productId={item?.id || product?.id}
              currentUser={currentUser}
              onNavigate={onNavigate}
            />
          )}
        </div>

        <aside className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:flex lg:self-start lg:flex-col lg:gap-6">
          <section className="order-2 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm lg:order-none">
            <span className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">Price</span>
            <p className="mt-3 text-4xl font-extrabold text-slate-900">{formattedPrice}</p>
            {showBuyerView && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">{t('productDetails.buyer.protectionNote')}</p>}
            {isNegotiable && <div className="mt-4 inline-flex items-center justify-center rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 border border-emerald-100">Negotiable</div>}
            {showBuyerView && !isOwner && <div className="mt-5 flex items-center justify-center gap-4">
              <button type="button" onClick={() => handleQuantityChange((value) => Math.max(1, value - 1))} disabled={selectedQuantity <= 1 || cartQuantityUpdating} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-lg font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Decrease quantity">-</button>
              <span className="min-w-8 text-center text-lg font-black text-slate-900">{selectedQuantity}</span>
              <button type="button" onClick={() => handleQuantityChange((value) => Math.min(availableStock, value + 1))} disabled={selectedQuantity >= availableStock || cartQuantityUpdating} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-lg font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Increase quantity">+</button>
            </div>}
            {showBuyerView && !isOwner && <p className="mt-2 text-xs font-semibold text-slate-500">{availableStock > 0 ? `${availableStock} available` : 'Not enough stock'}</p>}
            {showBuyerView && !isOwner && itemTotal !== null && <p className="mt-3 text-base font-black text-slate-900">Item Total: {itemTotal.toLocaleString('en-ET', { maximumFractionDigits: 2 })} ETB</p>}
            {showBuyerView && !isOwner && availableStock === 0 && <p className="mt-2 text-sm font-bold text-rose-600">Not enough stock available.</p>}
            {showBuyerView && !isOwner && (
              <>
                <p role="note" className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm font-bold leading-6 text-amber-950">
                  Make sure you have inspected the product in person before completing the payment.
                </p>
                <ProductPurchaseActions
                  isOwner={isOwner}
                  isSoldOut={availableStock === 0}
                  isInCart={isInCart}
                  cartReady={!buyerStudentId || cartLoaded}
                  cartError={Boolean(buyerStudentId && cartError)}
                  isAddingToCart={cartAdding}
                  addDisabled={isReadOnlyPreview || purchaseBlocked}
                  payDisabled={isReadOnlyPreview || availableStock === 0 || selectedQuantity > availableStock || cartQuantityUpdating}
                  onAddToCart={handleAddToCart}
                  onPay={openPayModal}
                  className="mt-5 grid grid-cols-1 gap-2"
                  addButtonClassName="btn-primary w-full rounded-full py-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                  payButtonClassName="w-full rounded-full bg-emerald-600 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  statusClassName="rounded-2xl border px-3 py-2 text-center text-xs font-bold"
                />
              </>
            )}
            {showBuyerView && cartStatus && <p className="mt-3 text-sm text-blue-700">{cartStatus}</p>}
            {isAdmin && (
              <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left" aria-label="Admin Management Bar">
                <h3 className="text-sm font-black uppercase tracking-wide text-violet-950">Admin Management</h3>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('admin-dashboard', { tab: 'product-management' })}
                    className="w-full rounded-full bg-violet-700 px-4 py-3 text-sm font-bold text-white hover:bg-violet-800"
                  >
                    Go to Moderation
                  </button>
                  <button
                    type="button"
                    onClick={delistAdminProduct}
                    disabled={ownerActionLoading}
                    className="w-full rounded-full border border-violet-300 bg-white px-4 py-3 text-sm font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                  >
                    Unpublish / Delist
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirmation(true)}
                    disabled={ownerActionLoading}
                    className="w-full rounded-full border border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Delete Listing
                  </button>
                </div>
                {ownerActionStatus && <p role="status" className="mt-3 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-900">{ownerActionStatus}</p>}
              </div>
            )}
          </section>

          {showBuyerView && (
            <section className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm" aria-labelledby="how-buying-works-heading">
              <h3 id="how-buying-works-heading" className="text-lg font-black text-emerald-950">{t('productDetails.buyer.howBuyingWorks')}</h3>
              <ol className="mt-3 space-y-2 text-sm font-semibold leading-6 text-emerald-900">
                <li>1. {t('productDetails.buyer.steps.chat')}</li>
                <li>2. {t('productDetails.buyer.steps.checkItem')}</li>
                <li>3. {t('productDetails.buyer.steps.payWallet')}</li>
                <li>4. {t('productDetails.buyer.steps.keepReceipt')}</li>
              </ol>
            </section>
          )}

          {showOwnerView && (
            <>
              <section className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
                <h3 className="text-lg font-black text-slate-900">{t('productDetails.owner.listingActions')}</h3>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => onNavigate?.('student-dashboard', { tab: 'seller', editProduct: item })} className="rounded-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800">{t('productDetails.owner.editListing')}</button>
                  <button type="button" onClick={toggleListingStatus} disabled={ownerActionLoading} className="rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50">{ownerStatusDraft === 'active' ? t('productDetails.owner.markSoldUnlist') : t('productDetails.owner.relist')}</button>
                  <button type="button" onClick={() => setShowDeleteConfirmation(true)} disabled={ownerActionLoading} className="rounded-full border border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 sm:col-span-2">{t('productDetails.owner.deleteListing')}</button>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <label className="text-sm font-semibold text-slate-700">
                    {t('productDetails.owner.quantity')}
                    <input type="number" min="0" step="1" value={ownerStockDraft} onChange={(event) => setOwnerStockDraft(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base" />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    {t('productDetails.owner.status')}
                    <select value={ownerStatusDraft} onChange={(event) => setOwnerStatusDraft(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base">
                      <option value="active">{t('productDetails.owner.active')}</option>
                      <option value="sold-out">{t('productDetails.owner.soldOut')}</option>
                      <option value="hidden">{t('productDetails.owner.hidden')}</option>
                    </select>
                  </label>
                </div>
                <button type="button" onClick={saveOwnerStock} disabled={ownerActionLoading} className="mt-3 w-full rounded-full border border-emerald-700 px-4 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">{ownerActionLoading ? t('productDetails.owner.saving') : t('productDetails.owner.saveStock')}</button>
                <button type="button" onClick={() => onNavigateToMessages?.(item.id)} className="mt-3 block text-sm font-bold text-emerald-800 underline underline-offset-2">{t('productDetails.owner.viewInquiries')}</button>
                {ownerActionStatus && <p role="status" className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-800">{ownerActionStatus}</p>}
              </section>

              {item?.stats && (
                <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-lg font-black text-slate-900">{t('productDetails.owner.listingStats')}</h3>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['views', item.stats.views],
                      ['wishlist', item.stats.wishlist_count],
                      ['inquiries', item.stats.inquiries_count],
                      ['cart', item.stats.cart_count],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-slate-50 p-3">
                        <dt className="text-slate-500">{t(`productDetails.owner.stats.${label}`)}</dt>
                        <dd className="mt-1 text-xl font-black text-slate-900">{Number(value || 0).toLocaleString()}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </>
          )}

          <section className="order-4 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm lg:order-none">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-3xl font-bold text-sky-700">
              {item.seller_name ? item.seller_name.slice(0, 2).toUpperCase() : 'ST'}
            </div>
            <h4 className="mt-4 text-xl font-bold text-slate-900">{item.seller_name || item.seller || 'Verified Seller'}</h4>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <p className="text-sm text-slate-500">Department: {item.seller_dept || item.department || item.seller_department || 'Software Engineering'}</p>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">✓ Verified Student</span>
            </div>
            {showBuyerView ? (
              <dl className="mt-4 grid grid-cols-2 gap-2 text-left text-xs">
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="font-semibold text-slate-500">{t('productDetails.buyer.sellerRating')}</dt>
                  <dd className="mt-1 font-black text-slate-900">{sellerReviewCount ? `${sellerAverageRating.toFixed(1)} ★ · ${sellerReviewCount} ${t('productDetails.buyer.reviews')}` : t('productDetails.buyer.noSellerReviews')}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="font-semibold text-slate-500">{t('productDetails.buyer.itemsSold')}</dt>
                  <dd className="mt-1 font-black text-slate-900">{Number(item.seller_items_sold || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-ET')}</dd>
                </div>
                {sellerMemberSince && <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="font-semibold text-slate-500">{t('productDetails.buyer.memberSince')}</dt>
                  <dd className="mt-1 font-black text-slate-900">{sellerMemberSince}</dd>
                </div>}
                {sellerTypicalResponseBucket && <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="font-semibold text-slate-500">{t('productDetails.buyer.responseTime')}</dt>
                  <dd className="mt-1 font-black text-slate-900">{t(`productDetails.buyer.${sellerTypicalResponseBucket}`)}</dd>
                </div>}
              </dl>
            ) : (
              <>
                {reviewCount === 0 && <p className="mt-3 text-xs font-semibold text-slate-500">No reviews yet</p>}
                {Number.isFinite(responseTimeHours) && responseTimeHours > 0 && <p className="mt-2 text-xs font-semibold text-slate-500">Usually responds within {responseTimeHours < 1 ? 'an hour' : `${Math.round(responseTimeHours)} hours`}</p>}
              </>
            )}

            {showBuyerView && <div className="mt-6 space-y-3">
              {showPhone ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 font-medium text-blue-900">
                  <a
                    href={sellerPhone ? `tel:${sellerPhone}` : undefined}
                    className="flex min-w-0 items-center gap-2 break-all hover:underline"
                  >
                    <span aria-hidden="true">📞</span>
                    <span>{sellerPhone || 'No phone provided'}</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleCopySellerPhone}
                    disabled={!sellerPhone}
                    className="shrink-0 rounded border bg-white px-2 py-1 text-xs shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy
                  </button>
                  {isAdmin && sellerPhone && (
                    <a
                      href={`sms:${sellerPhone}`}
                      className="shrink-0 rounded border bg-white px-2 py-1 text-xs shadow-sm hover:underline"
                    >
                      Message
                    </a>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleShowContact}
                  disabled={isReadOnlyPreview}
                  className="w-full rounded-full border border-slate-800 bg-white py-3.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span aria-hidden="true">📞</span>
                  <span>Show Contact</span>
                </button>
              )}

              {currentUser && !isAdmin ? (
                <>
                  <div className="flex items-center justify-between gap-3 text-left">
                    <label htmlFor="seller-message" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Message to seller</label>
                    <span className="text-xs font-semibold text-slate-400">Editable before sending</span>
                  </div>
                  <textarea
                    id="seller-message"
                    ref={messageInputRef}
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    placeholder={isChatEnabled ? 'Write a message to the seller...' : 'Chat is currently disabled by the administrator'}
                    rows={4}
                    disabled={isReadOnlyPreview || !isChatEnabled || !verifiedCurrentUser || chatLoading}
                    className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white"
                  />
                  {!verifiedCurrentUser && (
                    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                      Verification is required to start a chat with other students.
                    </p>
                  )}
                  {/* አረንጓዴ የቻት መክፈቻ ቁልፍ (Start Chat Button) */}
                  <button
                    onClick={handleStartChat}
                    disabled={isReadOnlyPreview || !isChatEnabled || !verifiedCurrentUser || chatLoading || !messageText.trim()}
                    className="btn-primary w-full rounded-full py-3.5 text-sm font-semibold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <span>💬</span>
                    <span>{chatLoading ? 'Sending...' : 'Send Message & Start Chat'}</span>
                  </button>
                  {isNegotiable && <div className="flex items-center gap-2"><input type="number" min="1" value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} placeholder="Offer amount" disabled={isReadOnlyPreview} className="min-w-0 flex-1 rounded-full border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-amber-400 disabled:opacity-50" /><button type="button" onClick={handleMakeOffer} disabled={isReadOnlyPreview} className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">Make an Offer</button></div>}
                </>
              ) : (
                <button type="button" onClick={promptLoginToMessage} className="w-full rounded-full border border-emerald-700 py-3.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50">
                  {t('productDetails.buyer.sendMessage')}
                </button>
              )}
              {chatStatus && (
                <p className="text-sm text-emerald-700">{chatStatus}</p>
              )}
            </div>}
          </section>

          {showBuyerView && moreFromSeller.length > 0 && (
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="more-from-seller-heading">
              <h3 id="more-from-seller-heading" className="text-lg font-black text-slate-900">{t('productDetails.buyer.moreFromSeller')}</h3>
              <div className="mt-3 space-y-3">
                {moreFromSeller.map((other) => (
                  <button key={other.id} type="button" onClick={() => onNavigate?.('product-details', { productId: other.id })} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-2 text-left transition hover:bg-slate-50">
                    <img src={resolveImageUrl(other.image || fallbackImage)} alt={other.title || 'Seller listing'} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-14 w-16 shrink-0 rounded-lg object-cover" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-900">{other.title}</span>
                      <span className="mt-1 block text-xs font-bold text-emerald-700">{other.price ? `${Number(other.price).toLocaleString('en-ET', { maximumFractionDigits: 2 })} ETB` : 'Negotiable'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showBuyerView && !isOwner && !isAdmin && !isReadOnlyPreview && allowStudentReports && (
            <section className="order-5 min-w-0 lg:order-none">
              {!currentUser ? (
                <button type="button" onClick={() => requireLogin('report')} className="text-sm font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-800">🚩 Report/Flag Product</button>
              ) : !showReportForm ? (
                <button type="button" onClick={() => setShowReportForm(true)} className="text-sm font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-800">🚩 Report/Flag Product</button>
              ) : (
                <form onSubmit={handleSubmitReport} className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
                  <fieldset className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-3"><legend className="px-1 text-sm font-bold text-rose-800">Choose report reasons</legend>{['Fake/counterfeit item', 'Scam attempt', 'Wrong category', 'Inappropriate content', 'Other'].map((reason) => <label key={reason} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={reportReasons.includes(reason)} onChange={(event) => setReportReasons((previous) => event.target.checked ? [...previous, reason] : previous.filter((value) => value !== reason))} disabled={reportLoading} />{reason}</label>)}</fieldset>
                  <textarea value={reportText} onChange={(event) => setReportText(event.target.value)} placeholder="Tell us why this product should be reviewed..." rows={4} required disabled={reportLoading} className="w-full resize-none rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:bg-white" />
                  <input type="file" accept="image/*" onChange={(event) => setReportEvidenceFile(event.target.files?.[0] || null)} disabled={reportLoading} className="w-full rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-rose-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-rose-700" />
                  <div className="flex gap-2">
                    <button type="submit" disabled={reportLoading || !reportReasons.length || !reportText.trim()} className="flex-1 rounded-full bg-rose-600 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300">{reportLoading ? 'Submitting...' : 'Submit Report'}</button>
                    <button type="button" onClick={() => { setShowReportForm(false); setReportEvidenceFile(null); setReportReasons([]); }} className="rounded-full border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                  </div>
                </form>
              )}
              {reportStatus && <p className="mt-2 text-sm text-rose-700">{reportStatus}</p>}
            </section>
          )}

          {showBuyerView && <section className="order-6 min-w-0 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm lg:order-none">
            <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2">
              <span>🛡️</span> Safety Tips
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-amber-800 list-disc pl-5 leading-7">
              <li>
                Do not pay in advance.
              </li>
              <li>
                Meet in busy public areas only.
              </li>
              <li>
                Check the item carefully before paying.
              </li>
            </ul>
          </section>}
          {showOwnerView && (
            <section className="min-w-0 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 shadow-sm">
              <h4 className="text-sm font-bold text-sky-900">{t('productDetails.owner.sellerSafetyTips')}</h4>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-sky-900">
                <li>{t('productDetails.owner.safety.inspect')}</li>
                <li>{t('productDetails.owner.safety.public')}</li>
                <li>{t('productDetails.owner.safety.wallet')}</li>
              </ul>
            </section>
          )}
        </aside>
      </div>
      {showBuyerView && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur lg:hidden" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">Price</p>
            <p className="truncate text-lg font-extrabold text-slate-900">{formattedPrice}</p>
          </div>
          {showBuyerView && !isOwner && (
            <ProductPurchaseActions
              isOwner={isOwner}
              isSoldOut={availableStock === 0}
              isInCart={isInCart}
              cartReady={!buyerStudentId || cartLoaded}
              cartError={Boolean(buyerStudentId && cartError)}
              isAddingToCart={cartAdding}
              addDisabled={isReadOnlyPreview || purchaseBlocked}
              payDisabled={isReadOnlyPreview || availableStock === 0 || selectedQuantity > availableStock || cartQuantityUpdating}
              onAddToCart={handleAddToCart}
              onPay={openPayModal}
              className="shrink-0"
              addButtonClassName="btn-primary shrink-0 rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
              payButtonClassName="shrink-0 rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              statusClassName="inline-flex rounded-full border px-3 py-1 text-xs font-bold"
            />
          )}
        </div>
        {cartStatus && <p className="mx-auto mt-1 w-full max-w-7xl px-1 text-xs text-blue-700">{cartStatus}</p>}
      </div>}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-listing-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="delete-listing-title" className="text-xl font-black text-slate-950">{isAdmin ? 'Delete listing?' : t('productDetails.owner.confirmDeleteTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{isAdmin ? 'This permanently deletes the listing and cannot be undone.' : t('productDetails.owner.confirmDelete')}</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowDeleteConfirmation(false)} disabled={ownerActionLoading} className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">{isAdmin ? 'Cancel' : t('productDetails.owner.cancel')}</button>
              <button type="button" onClick={deleteOwnerListing} disabled={ownerActionLoading} className="rounded-full bg-rose-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{ownerActionLoading ? t('productDetails.owner.deleting') : isAdmin ? 'Delete Listing' : t('productDetails.owner.confirmDeleteAction')}</button>
            </div>
          </section>
        </div>
      )}
      {showPayModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-md sm:p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="chapa-pay-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/70 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800">
                  <LockKeyhole aria-hidden="true" className="h-3 w-3" />
                  256-bit Encrypted Checkout
                </div>
                <h2 id="chapa-pay-title" className="mt-3 text-2xl font-black tracking-tight text-slate-950 dark:text-white">Pay with Chapa</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A secure payment, made simple.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPayModal(false)}
                disabled={payLoading}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition duration-200 hover:rotate-90 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close payment dialog"
              >
                <span aria-hidden="true" className="block text-xl leading-4">×</span>
              </button>
            </div>
            <p role="note" className="mt-5 flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-3 text-sm font-medium leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
              <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-700" />
              <span>Campus Handover: Inspect item before completing payment.</span>
            </p>
            {payResult ? (
              <div className="mt-6 space-y-4">
                <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">
                  Payment completed. Order #{payResult.order_id} is Completed.
                </p>
                <p className="text-sm text-slate-600">You can report a problem within 24 hours if needed.</p>
                <button type="button" onClick={() => { setShowPayModal(false); onNavigate?.(buildOrderDashboardUrl(payResult.order_id)); }} className="w-full rounded-full bg-slate-900 py-3 font-bold text-white hover:bg-slate-800">View my orders</button>
              </div>
            ) : (
              <>
                {paySummary && (
                  <dl className="mt-5 space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/50">
                    <div className="flex items-start justify-between gap-4">
                      <dt className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900 dark:text-white">{paySummary.title}</span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Qty {selectedQuantity} <span aria-hidden="true">·</span> {paySummary.unit_price} ETB each</span>
                      </dt>
                      <dd className="shrink-0 font-semibold text-slate-900 dark:text-slate-100">{(Number(paySummary.unit_price) * selectedQuantity).toFixed(2)} ETB</dd>
                    </div>
                    <div className="flex justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <dt>Seller</dt>
                      <dd className="text-right">{paySummary.seller_name}</dd>
                    </div>
                    <div className="flex justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <dt>Platform commission <span className="text-slate-400 dark:text-slate-500">(deducted from seller payout)</span></dt>
                      <dd className="shrink-0">{paySummary.seller_commission} ETB</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <dt className="font-semibold text-slate-700 dark:text-slate-300">Total amount</dt>
                      <dd className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{Number(paySummary.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB</dd>
                    </div>
                  </dl>
                )}
                {payError && <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{payError}</p>}
                {payStatusMessage && <p role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{payStatusMessage}</p>}
                {!paySummary && <p className="mt-5 text-sm text-slate-500">Loading payment summary…</p>}
                {paySummary && (
                  <form onSubmit={submitProductPayment} className="mt-5 space-y-5">
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">Payment method</p>
                        <span className="text-xs text-slate-500 dark:text-slate-400">Choose one to continue</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Choose a payment method">
                        {[
                          { id: 'telebirr', label: 'Telebirr', provider: 'telebirr' },
                          { id: 'cbe_birr', label: 'CBE Birr', provider: 'cbeBirr' },
                          { id: 'cbe_bank', label: 'CBE Bank', provider: 'cbe' },
                        ].map(({ id, label, provider }) => {
                          const isSelected = selectedPaymentMethod === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              aria-label={label}
                              aria-pressed={isSelected}
                              onClick={() => setSelectedPaymentMethod(id)}
                              className={`relative flex min-h-28 transform flex-col items-center justify-center gap-2 rounded-xl p-3 text-xs font-bold transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                                isSelected
                                  ? 'scale-[1.02] border-2 border-emerald-500 bg-emerald-50/20 text-emerald-900 shadow-sm dark:text-emerald-300'
                                  : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800'
                              }`}
                            >
                              {isSelected && (
                                <span aria-hidden="true" className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                                  <Check className="h-3 w-3" strokeWidth={3} />
                                </span>
                              )}
                              <span className={`transition-transform duration-200 ${isSelected ? 'scale-110' : ''}`}>
                                <PaymentProviderLogo provider={provider} className="h-10 w-10 rounded-lg border border-slate-100 bg-white" />
                              </span>
                              <span className="text-center text-[11px] sm:text-xs">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button type="submit" disabled={payLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition-all duration-200 hover:-translate-y-0.5 hover:from-emerald-700 hover:to-emerald-800 hover:shadow-emerald-900/25 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
                      {!payLoading && <LockKeyhole aria-hidden="true" className="h-4 w-4" />}
                      {payLoading
                        ? 'Opening Chapa…'
                        : `Pay ${Number(paySummary.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB via ${
                          selectedPaymentMethod === 'telebirr'
                            ? 'Telebirr'
                            : selectedPaymentMethod === 'cbe_birr'
                              ? 'CBE Birr'
                              : 'CBE Bank'
                        }`}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {isZoomed && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-label="Product image preview" onClick={() => setIsZoomed(false)}><div className="relative max-h-[90vh] max-w-5xl" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setIsZoomed(false)} className="absolute right-3 top-3 z-10 rounded-full bg-white px-3 py-1 text-lg font-black text-slate-700 shadow" aria-label="Close image preview">×</button><img src={resolveImageUrl(activeImage)} alt={displayTitle} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackImage; }} className="max-h-[88vh] max-w-full rounded-2xl object-contain" /></div></div>}
    </div>
  );
}

export default ProductDetails;