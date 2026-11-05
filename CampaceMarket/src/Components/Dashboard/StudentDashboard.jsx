import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Copy, Pencil, Search, Wallet, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { getErrorMessage, notifyError, notifyInfo, notifySuccess } from '../../utils/notify';
import SellerOperationsCenter from './SellerOperationsCenter';
import SellerModerationNotices from './SellerModerationNotices';
import ReportsInbox from './ReportsInbox';
import OrderDetailsView from './OrderDetailsView';
import NotificationCenter from './NotificationCenter';
import SettingsCenter from './SettingsCenter';
import BuyerHubProductCard from './BuyerHubProductCard';
import { API_BASE_URL, IMAGE_PLACEHOLDER, resolveImageUrl, WS_BASE_URL } from '../../config';
import { getAdminSettings } from '../../api/adminSettings';
import { isOrderRefunded } from '../../utils/orderReceiptState';
import { buildPaymentReceiptPdf, paymentReceiptPdfFilename } from '../../utils/paymentReceiptPdf';
import { shouldReduceUnreadNotificationCount } from '../../utils/notificationState';
import { buildOrderDashboardUrl, parseOrderDashboardLink } from '../../utils/orderDashboardLink';
import { filterPublicProducts } from '../../utils/publicListings';
import {
  getEssentialPayoutProviders,
  getPayoutSetupStateAfterMethodChange,
  isPayoutSetupValid,
  isValidPayoutAccountNumber,
  payoutNameNeedsAcknowledgement,
} from '../../utils/payoutSetupValidation';

const isVerifiedStudent = (student) => [true, 1, '1', 'true'].includes(student?.is_verified);
const CREDIT_TRANSACTION_TYPES = new Set(['wallet deposit', 'escrow release', 'product sale', 'dispute release', 'refund']);
const DEBIT_TRANSACTION_TYPES = new Set(['wallet withdrawal', 'seller payout', 'product purchase', 'dispute hold', 'escrow hold']);
const STUDENT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'campaceStudentSidebarCollapsed';
const STUDENT_SIDEBAR_TOOLTIP_ANCHORS = {
  home: '[anchor-name:--student-home]',
  buyer: '[anchor-name:--student-buyer]',
  seller: '[anchor-name:--student-seller]',
  messages: '[anchor-name:--student-messages]',
  notifications: '[anchor-name:--student-notifications]',
  settings: '[anchor-name:--student-settings]',
};
const STUDENT_SIDEBAR_TOOLTIP_POSITIONS = {
  home: '[position-anchor:--student-home]',
  buyer: '[position-anchor:--student-buyer]',
  seller: '[position-anchor:--student-seller]',
  messages: '[position-anchor:--student-messages]',
  notifications: '[position-anchor:--student-notifications]',
  settings: '[position-anchor:--student-settings]',
};
const EDIT_WINDOW_MINUTES = 15;
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const BUYER_HUB_PAGE_SIZE = 12;
const disputeReasons = [
  'Item not received',
  'Wrong item',
  'Item damaged',
  'Item differs from description',
  'Other',
];

const isDisputeEligibleOrder = (order) => {
  const normalizedStatus = String(order?.status || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
  return normalizedStatus === 'completed' && Boolean(order?.can_report_problem);
};

const universityStructure = {
  "College of Computing and Informatics (CCI)": [
    "Department of Computer Science",
    "Department of Information Technology (IT)",
    "Department of Software Engineering"
  ],
  "College of Natural and Computational Sciences (CNCS)": [
    "Department of Biology",
    "Department of Chemistry",
    "Department of Geology",
    "Department of Mathematics",
    "Department of Physics",
    "Department of Statistics",
    "Department of Sport Science"
  ],
  "College of Agriculture and Natural Resource": [
    "Department of Agro-Economics",
    "Department of Agribusiness and Value Chain Management",
    "Department of Animal Science",
    "Department of Forestry",
    "Department of Horticulture",
    "Department of Natural Resource Management",
    "Department of Plant Science",
    "Department of Rural Development and Agricultural Extension"
  ],
  "College of Business and Economics": [
    "Department of Accounting and Finance",
    "Department of Economics",
    "Department of Management",
    "Department of Marketing Management"
  ],
  "College of Social Sciences and Humanities": [
    "Department of Amharic Language and Literature",
    "Department of English Language and Literature",
    "Department of Geography and Environmental Studies",
    "Department of History and Heritage Management",
    "Department of Political Science and International Relations"
  ],
  "School of Law": [
    "Department of Law (LLB)"
  ]
};

const getStudentAvatar = (studentId) => (
  studentId
    ? resolveImageUrl(`/static/uploads/avatars/${encodeURIComponent(studentId)}.jpg`)
    : IMAGE_PLACEHOLDER
);

const getConversationIdFromUrl = () => (
  typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('conversation') || ''
);

const formatConversationTimestamp = (value, language) => {
  const timestamp = String(value || '').trim();
  const date = new Date(timestamp);
  if (!timestamp || Number.isNaN(date.getTime())) return timestamp;

  const locale = language === 'am' ? 'am' : 'en';
  const elapsedMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(elapsedMinutes) < 60) return relativeTime.format(elapsedMinutes, 'minute');
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return relativeTime.format(elapsedHours, 'hour');
  const elapsedDays = Math.round(elapsedHours / 24);
  if (Math.abs(elapsedDays) < 7) return relativeTime.format(elapsedDays, 'day');
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

const getRecommendationImage = (rawImage) => {
  if (Array.isArray(rawImage)) return rawImage.find((image) => String(image || '').trim()) || null;
  if (typeof rawImage !== 'string') return null;

  const imageValue = rawImage.trim();
  if (!imageValue) return null;
  if (imageValue.startsWith('[')) {
    try {
      return getRecommendationImage(JSON.parse(imageValue));
    } catch {
      return null;
    }
  }
  return resolveImageUrl(imageValue);
};

const getProductImages = (rawImage) => {
  if (Array.isArray(rawImage)) return rawImage.filter((image) => String(image || '').trim());
  if (typeof rawImage !== 'string' || !rawImage.trim()) return [];
  try {
    const parsedImage = JSON.parse(rawImage);
    return Array.isArray(parsedImage) ? parsedImage.filter((image) => String(image || '').trim()) : [rawImage.trim()];
  } catch {
    return [rawImage.trim()];
  }
};

const getRecommendationPlaceholder = (category) => {
  const isBook = String(category || '').toLowerCase().includes('book');
  const label = isBook ? 'BOOK' : 'SCREEN';
  const color = isBook ? '#0f766e' : '#0369a1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e2e8f0"/><rect x="${isBook ? '125' : '85'}" y="42" width="${isBook ? '70' : '150'}" height="96" rx="8" fill="${color}"/><text x="160" y="160" fill="#475569" font-family="Arial,sans-serif" font-size="14" text-anchor="middle">${label} - NO IMAGE</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const parseImageSizeBytes = (value, fallback = 5 * 1024 * 1024) => {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i);
  if (!match) return fallback;

  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Number(match[1]) * (units[(match[2] || 'B').toUpperCase()] || 1);
};


function StudentDashboard({
  user,
  initialTab = 'home',
  mode = 'buyer',
  openProductComposerRequest = 0,
  dashboardLink = null,
  onDashboardLinkInvalid,
  initialProductToEdit = null,
  onInitialProductEditHandled,
  initialMessagesProductId = null,
  onClearProductInquiryFilter,
  onTabChange,
  onUserUpdate,
  onNavigate,
  appUnreadNotificationCount = 0,
}) {
  const { t, language } = useLanguage();
  const initialOrderDashboardLink = typeof window === 'undefined'
    ? null
    : parseOrderDashboardLink(window.location.href);
  const studentToast = (key) => t(`studentToast.${key}`);
  const getStudentSessionToken = useCallback(() => {
    const userToken = user?.access_token || user?.accessToken || user?.token || user?.session_token || user?.sessionToken;
    if (userToken) return userToken;

    try {
      const savedSession = JSON.parse(window.localStorage.getItem('campaceSession') || '{}');
      return savedSession?.user?.access_token
        || savedSession?.user?.accessToken
        || savedSession?.user?.token
        || savedSession?.user?.session_token
        || savedSession?.user?.sessionToken
        || savedSession?.access_token
        || savedSession?.accessToken
        || savedSession?.token
        || savedSession?.session_token
        || savedSession?.sessionToken
        || '';
    } catch {
      return '';
    }
  }, [user?.access_token, user?.accessToken, user?.token, user?.session_token, user?.sessionToken]);

  const verifiedStudent = isVerifiedStudent(user);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // ምስል 2 ላይ የተጠየቀው የጎን ፓነል መክፈቻ/መዝጊያ ስቴት
  useEffect(() => {
    const toggleSidebar = () => setIsSidebarOpen((open) => !open);
    window.addEventListener('campace:toggle-dashboard-sidebar', toggleSidebar);
    return () => window.removeEventListener('campace:toggle-dashboard-sidebar', toggleSidebar);
  }, []);
  useEffect(() => {
    if (!isSidebarOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsSidebarOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isSidebarOpen]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(STUDENT_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
    } catch (error) {
      console.warn('Failed to load the student sidebar preference:', error);
      return false;
    }
  });
  const [areSidebarLabelsVisible, setAreSidebarLabelsVisible] = useState(() => !isSidebarCollapsed);
  useEffect(() => {
    try {
      window.localStorage.setItem(STUDENT_SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
    } catch (error) {
      console.warn('Failed to save the student sidebar preference:', error);
    }
  }, [isSidebarCollapsed]);
  useEffect(() => {
    if (isSidebarCollapsed) {
      setAreSidebarLabelsVisible(false);
      return undefined;
    }

    const timeout = window.setTimeout(() => setAreSidebarLabelsVisible(true), 200);
    return () => window.clearTimeout(timeout);
  }, [isSidebarCollapsed]);
  const [activeTab, setActiveTab] = useState(() => (
    initialOrderDashboardLink?.tab || (getConversationIdFromUrl() ? 'messages' : initialTab)
  )); // የጎን መቆጣጠሪያ ታብ
  const [dashboardMode, setDashboardMode] = useState(() => mode || (initialTab === 'seller' ? 'seller' : 'buyer'));
  const [activeSellerDestination, setActiveSellerDestination] = useState('overview');
  const [sellerNavigationRequest, setSellerNavigationRequest] = useState({ destination: 'dashboard', id: 0 });
  const dashboardContentRef = useRef(null);
  useEffect(() => {
    if (dashboardContentRef.current) dashboardContentRef.current.scrollTop = 0;
  }, [activeTab]);
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeTab]);
  const messagesViewRef = useRef(null);
  const [messagesViewHeight, setMessagesViewHeight] = useState(null);
  const [buyerTab, setBuyerTab] = useState(() => (
    initialOrderDashboardLink?.tab === 'buyer' && initialOrderDashboardLink.section
      ? initialOrderDashboardLink.section
      : 'search'
  )); // የገዢዎች ንዑስ ታብ (Search, Wishlist, Cart, Orders, Payments)
  useEffect(() => {
    if (dashboardLink?.tab === 'buyer') {
      setDashboardMode(dashboardLink.mode || 'buyer');
      setBuyerTab(dashboardLink.section || 'search');
    } else if (dashboardLink?.tab === 'seller') {
      setDashboardMode(dashboardLink.mode || 'seller');
      if (dashboardLink.sellerDestination) setActiveSellerDestination(dashboardLink.sellerDestination);
    }
  }, [dashboardLink]);
  useEffect(() => {
    if (activeTab !== 'buyer' || buyerTab !== 'orders') return;
    ordersBadgeAcknowledgedRef.current = true;
    setNewOrdersCount(0);
  }, [activeTab, buyerTab]);
  useEffect(() => {
    if (mode === 'buyer' || mode === 'seller') setDashboardMode(mode);
  }, [mode]);
  const [settingsTab, setSettingsTab] = useState(() => {
    const requestedTab = window.sessionStorage.getItem('campusmarket:settings-tab');
    window.sessionStorage.removeItem('campusmarket:settings-tab');
    return requestedTab || 'account';
  });
  const [isNotificationPrefsDirty, setIsNotificationPrefsDirty] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [, setUnreadNotificationCount] = useState(0);
  const [receiptSupportEmail, setReceiptSupportEmail] = useState('support@campus.edu.et');
  useEffect(() => {
    setUnreadNotificationCount((current) => current === appUnreadNotificationCount ? current : appUnreadNotificationCount);
  }, [appUnreadNotificationCount]);
  useEffect(() => {
    let isMounted = true;
    getAdminSettings()
      .then((settingsResponse) => {
        const settings = settingsResponse?.settings || settingsResponse;
        const configuredEmail = settings?.support_email
          || settings?.general?.supportEmail
          || settings?.general?.support_email;
        const nextEmail = String(configuredEmail || '').trim() || 'support@campus.edu.et';
        if (isMounted) setReceiptSupportEmail((current) => current === nextEmail ? current : nextEmail);
      })
      .catch((error) => {
        console.error('Failed to load receipt support email:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);
  const initialConversations = [
    {
      id: 'conv-sara',
      studentId: 'STU-1001',
      name: 'Sara Bekele',
      status: 'online',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
      lastMessage: 'Can we confirm the defense rehearsal slot?',
      timestamp: '2 min ago',
      unread: 2,
      product: {
        id: 18,
        title: 'Ecommerce Project Prototype Kit',
        price: 7800,
        image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80'
      },
      messages: [
        { id: 'm1', sender: 'them', text: 'Hi! I saw your project prototype and it looks great.', time: '09:42 AM' },
        { id: 'm2', sender: 'me', text: 'Thanks! I am refining the final demo slides right now.', time: '09:43 AM' },
        { id: 'm3', sender: 'them', text: 'Can we confirm the defense rehearsal slot after class?', time: '09:45 AM' },
      ]
    },
    {
      id: 'conv-abdi',
      studentId: 'STU-1002',
      name: 'Abdi Tadesse',
      status: 'offline',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
      lastMessage: 'The system demo is ready to test.',
      timestamp: '18 min ago',
      unread: 1,
      product: null,
      messages: [
        { id: 'm4', sender: 'them', text: 'I uploaded the latest API test logs for review.', time: '09:16 AM' },
        { id: 'm5', sender: 'me', text: 'Thanks, I will review them before the evening check-in.', time: '09:18 AM' },
        { id: 'm6', sender: 'them', text: 'The system demo is ready to test.', time: '09:19 AM' },
      ]
    },
    {
      id: 'conv-lina',
      studentId: 'STU-1003',
      name: 'Lina Mekonnen',
      status: 'online',
      avatar: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=200&q=80',
      lastMessage: 'I can help you rehearse your Q&A flow.',
      timestamp: '1 hour ago',
      unread: 0,
      product: {
        id: 29,
        title: 'Ecommerce Project Prototype Kit',
        price: 6400,
        image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80'
      },
      messages: [
        { id: 'm7', sender: 'them', text: 'I can help you rehearse your Q&A flow.', time: '08:40 AM' },
        { id: 'm8', sender: 'me', text: 'That would be great. I will send the latest version of my slides.', time: '08:42 AM' },
      ]
    },
  ];
  const [activeConversationId, setActiveConversationId] = useState(() => getConversationIdFromUrl() || initialConversations[0]?.id || '');
  const [conversationsList, setConversationsList] = useState(initialConversations);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState('');
  const [activeChatMessages, setActiveChatMessages] = useState(initialConversations[0]?.messages || []);
  const messagesContainerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const suppressNextMessageAutoScrollRef = useRef(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [lightboxImage, setLightboxImage] = useState('');
  const scrollMessagesToLatest = (behavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior });
  };
  const updateAutoScrollPreference = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    shouldAutoScrollRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
  };
  useEffect(() => {
    if (!lightboxImage) return undefined;
    const handleLightboxKeyDown = (event) => {
      if (event.key === 'Escape') setLightboxImage('');
    };
    window.addEventListener('keydown', handleLightboxKeyDown);
    return () => window.removeEventListener('keydown', handleLightboxKeyDown);
  }, [lightboxImage]);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [typingInput, setTypingInput] = useState('');
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const [showChatDropdown, setShowChatDropdown] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [mobileChatView, setMobileChatView] = useState(() => getConversationIdFromUrl() ? 'chat' : 'list');
  useLayoutEffect(() => {
    if (activeTab !== 'messages') return undefined;
    const messagesView = messagesViewRef.current;
    if (!messagesView) return undefined;

    const measureMessagesView = () => {
      const viewport = window.visualViewport;
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const availableHeight = Math.max(0, Math.floor(viewportBottom - messagesView.getBoundingClientRect().top - 16));
      setMessagesViewHeight((currentHeight) => currentHeight === availableHeight ? currentHeight : availableHeight);
    };

    measureMessagesView();
    window.addEventListener('resize', measureMessagesView);
    window.addEventListener('orientationchange', measureMessagesView);
    window.visualViewport?.addEventListener('resize', measureMessagesView);

    return () => {
      window.removeEventListener('resize', measureMessagesView);
      window.removeEventListener('orientationchange', measureMessagesView);
      window.visualViewport?.removeEventListener('resize', measureMessagesView);
    };
  }, [activeTab]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const attachmentInputRef = useRef(null);
  const [showAddChatModal, setShowAddChatModal] = useState(false);
  const [showProfileDetailsModal, setShowProfileDetailsModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isUpdatingConversationBlock, setIsUpdatingConversationBlock] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialConversations.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0));
  const socketRef = useRef(null);
  const activePeerIdRef = useRef('');
  const activeTabRef = useRef(activeTab);
  const mobileChatViewRef = useRef(mobileChatView);
  const markConversationReadRef = useRef(null);
  const sellerChatParticipantsRef = useRef({});
  const paymentVerificationStartedRef = useRef(false);
  const depositAutoChecksRef = useRef(new Set());
  const depositAutoCheckCleanupRef = useRef(new Set());
  const depositVerificationHandlerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const walletBalanceRef = useRef(walletBalance);

  useEffect(() => {
    activeTabRef.current = activeTab;
    mobileChatViewRef.current = mobileChatView;
  }, [activeTab, mobileChatView]);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isAiAdvisorOpen, setIsAiAdvisorOpen] = useState(false);
  const aiScrollRef = useRef(null);
  const showAiAdvisorFab = ['home', 'buyer', 'seller'].includes(activeTab);
  const aiAbortControllerRef = useRef(null);

  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    studentId: user?.studentId || '',
    email: user?.email || '',
    phone: user?.phone || '',
    college: user?.college || '',
    department: user?.department || '',
  });
  const [profileMessage, setProfileMessage] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // ለድጋፍ ፎም መቆጣጠሪያዎች (Support/Report Form States)
  const [supportSubject, setSupportSubject] = useState('');
  const [supportIssue, setSupportIssue] = useState('');
  const [supportCategory, setSupportCategory] = useState('General Inquiry');
  const [supportMsg, setSupportMsg] = useState('');
  const [supportEvidenceImage, setSupportEvidenceImage] = useState(null);

  // የገዢው ዳሽቦርድ መረጃዎችን ከዳታቤዝ ለመጥራት የተዘጋጁ ስቴቶች (Buyer States)
  const [wishlist, setWishlist] = useState([]);
  const {
    items: cart,
    setItems: setCart,
    replaceItems: replaceCartItems,
    cartBadgeDismissed,
    loadedStudentId: cartStudentId,
    loading: cartLoading,
    error: cartError,
  } = useCart();
  const [wishlistBadgeCount, setWishlistBadgeCount] = useState(0);
  const [addingCartProductIds, setAddingCartProductIds] = useState([]);
  const cartAddInFlightRef = useRef(new Set());
  const [orders, setOrders] = useState([]);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const ordersBadgeAcknowledgedRef = useRef(false);
  const knownOrderIdsRef = useRef(null);
  const [showHiddenOrders, setShowHiddenOrders] = useState(false);
  const [hiddenOrdersCount, setHiddenOrdersCount] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pendingSellerOrderId, setPendingSellerOrderId] = useState(null);
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);
  const [orderDetailsError, setOrderDetailsError] = useState('');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderNavigationMessage, setOrderNavigationMessage] = useState('');
  const initialOrderNavigationHandledRef = useRef(false);

  const [paymentInfo, setPaymentInfo] = useState({ balance: 0.00, recentTx: 'No transactions yet' });
  const payoutStatusTrackerRef = useRef({
    studentId: '',
    lastStatusByPayoutId: new Map(),
    notifiedEventIds: new Set(),
  });
  const dashboardRefreshInFlightRef = useRef(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositError, setDepositError] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [copiedTransactionHash, setCopiedTransactionHash] = useState('');
  const [transactionFilter, setTransactionFilter] = useState('all');
  const [transactionSearch, setTransactionSearch] = useState('');
  const [hiddenTransactions, setHiddenTransactions] = useState([]);
  const [hiddenTransactionsCount, setHiddenTransactionsCount] = useState(0);
  const [hiddenTransactionsLoading, setHiddenTransactionsLoading] = useState(false);
  const [transactionVisibilityActionId, setTransactionVisibilityActionId] = useState(null);
  const [transactionVisibilityError, setTransactionVisibilityError] = useState('');
  const [paymentVerificationState, setPaymentVerificationState] = useState('');
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPin, setWithdrawPin] = useState('');
  const [withdrawAttemptsLeft, setWithdrawAttemptsLeft] = useState(null);
  const [withdrawRetryAfterSeconds, setWithdrawRetryAfterSeconds] = useState(null);
  const [payoutAccount, setPayoutAccount] = useState(null);
  const [payoutAccountLoading, setPayoutAccountLoading] = useState(false);
  const [payoutSetupOpen, setPayoutSetupOpen] = useState(false);
  const [payoutSetupBanks, setPayoutSetupBanks] = useState([]);
  const [payoutSetupBanksLoading, setPayoutSetupBanksLoading] = useState(false);
  const [payoutSetupBanksError, setPayoutSetupBanksError] = useState('');
  const [payoutSetupRetryCount, setPayoutSetupRetryCount] = useState(0);
  const [payoutSetupError, setPayoutSetupError] = useState('');
  const [payoutSetupLoading, setPayoutSetupLoading] = useState(false);
  const payoutSetupInFlightRef = useRef(false);
  const [payoutSetupType, setPayoutSetupType] = useState('bank');
  const [payoutSetupBankCode, setPayoutSetupBankCode] = useState('');
  const [payoutSetupAccountName, setPayoutSetupAccountName] = useState(user?.name || '');
  const [payoutSetupNameMismatchAcknowledged, setPayoutSetupNameMismatchAcknowledged] = useState(false);
  const [payoutSetupAccountNumber, setPayoutSetupAccountNumber] = useState('');
  const [withdrawProviderUnavailable, setWithdrawProviderUnavailable] = useState(false);
  const [activeWithdrawal, setActiveWithdrawal] = useState(null);
  const [withdrawalStatusLoading, setWithdrawalStatusLoading] = useState(false);
  const [payoutStatusCheckId, setPayoutStatusCheckId] = useState(null);
  const [returnToWithdrawAfterPayoutSetup, setReturnToWithdrawAfterPayoutSetup] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const withdrawSubmitInFlightRef = useRef(false);
  const withdrawIdempotencyKeyRef = useRef(null);
  const [recommendedProducts, setRecommendedProducts] = useState([]);
  const [recommendationsStudentId, setRecommendationsStudentId] = useState('');
  const [recentCampusActivity, setRecentCampusActivity] = useState([]);

  // የሻጭ/ምርት መለጠፊያ ፎርም ስቴት (Seller Product Posting Form States)
  const [showProductModal, setShowProductModal] = useState(false);
  const handledComposerRequestRef = useRef(0);

  useEffect(() => {
    if (!showProductModal) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showProductModal]);

  const [editingProduct, setEditingProduct] = useState(null);
  const [existingProductImages, setExistingProductImages] = useState([]);
  const [newProductImagePreviews, setNewProductImagePreviews] = useState([]);
  const [productForm, setProductForm] = useState({
    name: '',
    title: '',
    category: '',
    subcategory: '',
    price: '',
    quantity: '1',
    condition: 'New',
    pickupLocation: '',
    pickupHours: '12 AM:00-12:00 PM',
    imageNotes: [],
    description: '',
    image: null
  });
  const [productError, setProductError] = useState('');
  const [productSuccessMsg, setProductSuccessMsg] = useState('');
  const [productSubmitting, setProductSubmitting] = useState(false);
  const [maxImageSize, setMaxImageSize] = useState('5MB');
  const [maxImagesPerProduct, setMaxImagesPerProduct] = useState(5);

  useEffect(() => {
    const files = Array.isArray(productForm.image)
      ? productForm.image.filter((image) => image instanceof File)
      : [];
    const previews = files.map((file) => URL.createObjectURL(file));
    setNewProductImagePreviews(previews);
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview));
  }, [productForm.image]);

  // Dynamic categories from backend
  const [categories, setCategories] = useState([]);
  const [dbCategories, setDbCategories] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchCategory, setSearchCategory] = useState('');
  const [searchSubcategory, setSearchSubcategory] = useState('');
  const [wishlistMessage, setWishlistMessage] = useState('');
  const [cartMessage, setCartMessage] = useState('');
  const [reviewOrderId, setReviewOrderId] = useState(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [disputeOrderId, setDisputeOrderId] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeEvidenceFiles, setDisputeEvidenceFiles] = useState([]);
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [disputeFeedback, setDisputeFeedback] = useState('');
  const [paymentReceiptState, setPaymentReceiptState] = useState({});
  const [printingReceiptOrderId, setPrintingReceiptOrderId] = useState(null);
  const printWindowRef = useRef(null);
  const printStartedRef = useRef(false);
  const [myListings, setMyListings] = useState([]);
  const [sellerDashboardData, setSellerDashboardData] = useState({
    stats: {
      total_listings: 0,
      active_listings: 0,
      pending_listings: 0,
      sold_listings: 0,
      received_orders: 0,
      completed_revenue: 0,
      pending_orders: 0,
      unapproved_products: 0
    },
    alerts: { pending_orders: 0, unapproved_products: 0 },
    performance: { rating: 0, response_rate: 0, order_completion: 0 },
    my_listings: [],
    received_orders: []
  });
  const [sellerData, setSellerData] = useState({
    totalListings: 0,
    receivedOrders: 0,
    totalRevenue: 0,
    incomingOrders: [],
    activeListings: []
  });
  const [reviewComment, setReviewComment] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarUploadMessage, setAvatarUploadMessage] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');

  const normalizePrice = (possiblePrice) => {
    if (typeof possiblePrice === 'number') return possiblePrice;
    if (!possiblePrice) return 0;
    const numeric = parseFloat(String(possiblePrice).replace(/[^0-9.]/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const formatETB = (value) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return '0 ETB';
    return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 0 })} ETB`;
  };

  const normalizeOrderStatus = (value) => {
    const raw = String(value || 'Processing').trim();
    if (!raw) return 'Processing';
    const normalized = raw.toLowerCase();
    if (normalized.includes('complete')) return 'Completed';
    if (normalized.includes('disput')) return 'Disputed';
    if (normalized.includes('ready')) return 'In Progress';
    if (normalized.includes('process')) return 'Processing';
    if (normalized.includes('placed')) return 'Order Placed';
    return raw;
  };

  const normalizePaymentStatus = (value) => {
    const raw = String(value || 'Pending').trim();
    if (!raw) return 'Pending';
    const normalized = raw.toLowerCase();
    if (normalized.includes('fail')) return 'Failed';
    if (normalized.includes('pend')) return 'Pending';
    if (normalized.includes('process')) return 'Processing';
    if (normalized.includes('refun')) return 'Refunded';
    if (normalized.includes('success') || normalized.includes('complete') || normalized.includes('paid')) return 'Successful';
    return 'Successful';
  };

  const getEffectiveStudentId = () => user?.studentId || user?.username || user?.email || '';

  const getSafeCartPayload = (productIdValue) => {
    const normalizedStudentId = String(user?.studentId ?? user?.student_id ?? getEffectiveStudentId() ?? '').trim();
    const normalizedProductId = Number.parseInt(String(productIdValue ?? '').trim(), 10);

    return {
      student_id: normalizedStudentId,
      product_id: Number.isFinite(normalizedProductId) ? normalizedProductId : null,
    };
  };

  const getErrorString = async (response) => {
    try {
      const errData = await response.json();

      if (typeof errData?.detail === 'string') {
        return errData.detail;
      }

      if (Array.isArray(errData?.detail)) {
        return errData.detail[0]?.msg || errData.detail[0]?.message || 'Failed to complete action.';
      }

      if (errData && typeof errData === 'object') {
        const detail = errData.detail;
        if (Array.isArray(detail)) {
          return detail[0]?.msg || detail[0]?.message || 'Failed to complete action.';
        }
        if (typeof detail === 'string') {
          return detail;
        }
        if (typeof detail?.msg === 'string') {
          return detail.msg;
        }
        if (typeof detail?.message === 'string') {
          return detail.message;
        }
      }

      return 'Failed to complete action.';
    } catch {
      return 'Failed to complete action.';
    }
  };
  const translateProductOwnershipError = (message) => (
    message === 'You cannot buy or save your own product.'
      ? studentToast('ownProductAction')
      : message
  );

  const derivedCartItemCount = cart.reduce((total, item) => total + Math.max(0, Number(item.quantity) || 1), 0);
  const cartItemCount = cartBadgeDismissed ? 0 : derivedCartItemCount;
  const wishlistCount = wishlistBadgeCount || wishlist.length;
  const orderCount = newOrdersCount;
  const updateOrdersAndBadge = (nextOrders) => {
    const nextOrderIds = new Set(nextOrders.map((order) => String(order.id)));
    const previouslyKnownOrderIds = knownOrderIdsRef.current;
    const newlyReceivedCount = previouslyKnownOrderIds === null
      ? 0
      : nextOrders.filter((order) => !previouslyKnownOrderIds.has(String(order.id))).length;
    knownOrderIdsRef.current = nextOrderIds;
    setOrders(nextOrders);

    if (previouslyKnownOrderIds === null) {
      if (!ordersBadgeAcknowledgedRef.current) setNewOrdersCount(nextOrders.length);
    } else if (newlyReceivedCount > 0) {
      const wasAcknowledged = ordersBadgeAcknowledgedRef.current;
      setNewOrdersCount((count) => wasAcknowledged ? newlyReceivedCount : count + newlyReceivedCount);
      ordersBadgeAcknowledgedRef.current = false;
    } else if (!ordersBadgeAcknowledgedRef.current) {
      setNewOrdersCount(nextOrders.length);
    }
  };
  const currentWalletBalance = Number(walletBalance ?? paymentInfo?.balance ?? 0);
  const heldWalletBalance = Number(paymentInfo?.heldBalance || 0);
  const withdrawalEntryBlocked = currentWalletBalance <= 0 || Boolean(activeWithdrawal);
  const withdrawAmountValue = Number(withdrawAmount);
  const withdrawExceedsBalance = withdrawAmount !== '' && Number.isFinite(withdrawAmountValue) && withdrawAmountValue > currentWalletBalance;

  const transactionLedger = Array.isArray(paymentInfo?.transactions) ? paymentInfo.transactions : [];
  const allTransactionLedger = [...transactionLedger, ...hiddenTransactions];
  const depositAmountValue = Number(depositAmount);
  const isValidDepositAmount = depositAmount !== '' && depositAmount !== null && Number.isFinite(depositAmountValue) && depositAmountValue > 0;

  const getTransactionSummaryText = (tx) => {
    if (!tx) return 'No transactions yet';

    const label = getTransactionLabel(tx);
    const amount = Number(tx.amount ?? tx.value ?? 0);
    const { sign } = getTransactionDirection(tx);
    const formatted = formatETB(Math.abs(amount));

    return `${label} — ${sign}${formatted}`;
  };

  const getTransactionLabel = (tx) => {
    const label = tx?.label || tx?.type || 'Transaction';
    const status = String(tx?.status || '').trim().toLowerCase();
    return status === 'successful' ? label.replace(/initiated/gi, 'completed') : label;
  };

  const getTransactionDirection = (tx) => {
    const direction = String(tx?.direction || '').trim().toLowerCase();
    const type = String(tx?.type || '').trim().toLowerCase();
    const label = String(tx?.label || '').trim().toLowerCase();
    const isPayoutOrWithdrawal = type.includes('payout')
      || type.includes('withdrawal')
      || label.includes('payout')
      || label.includes('withdrawal');
    const isDebit = direction === 'debit' || DEBIT_TRANSACTION_TYPES.has(type) || isPayoutOrWithdrawal;
    const isCredit = !isDebit && (direction === 'credit' || CREDIT_TRANSACTION_TYPES.has(type));
    return {
      sign: isCredit ? '+' : '-',
      colorClass: isCredit ? 'text-emerald-600' : isDebit ? 'text-rose-600' : 'text-slate-700',
    };
  };

  const getTransactionCategory = (tx) => {
    const typeAndLabel = `${tx?.type || ''} ${tx?.label || ''}`.toLowerCase();
    if (typeAndLabel.includes('withdraw') || typeAndLabel.includes('payout')) return 'withdrawals';
    if (getTransactionDirection(tx).sign === '+') return 'deposits';
    return 'payments';
  };

  const getTransactionAmount = (tx) => {
    const amount = Number(tx.amount ?? tx.value ?? 0);
    return Number.isFinite(amount) ? Math.abs(amount) : 0;
  };

  const totalDeposited = allTransactionLedger.reduce((total, tx) => (
    getTransactionDirection(tx).sign === '+'
      ? total + getTransactionAmount(tx)
      : total
  ), 0);
  const totalSpent = allTransactionLedger.reduce((total, tx) => (
    getTransactionDirection(tx).sign === '-'
      ? total + getTransactionAmount(tx)
      : total
  ), 0);
  const transactionsForView = transactionFilter === 'hidden' ? hiddenTransactions : transactionLedger;
  const filteredTransactions = transactionsForView.filter((tx) => {
    const matchesFilter = transactionFilter === 'hidden'
      || transactionFilter === 'all'
      || getTransactionCategory(tx) === transactionFilter;
    const searchableText = [
      tx?.label,
      tx?.type,
      tx?.description,
      tx?.hash,
      tx?.reference,
      tx?.reference_id,
      tx?.reference_number,
      tx?.payment_reference,
      tx?.tx_ref,
      tx?.transaction_id,
    ].filter(Boolean).join(' ').toLowerCase();
    return matchesFilter && searchableText.includes(transactionSearch.trim().toLowerCase());
  });

  const getTransactionStatusClass = (status) => {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (normalizedStatus.includes('fail')) return 'border-rose-100 bg-rose-50 text-rose-700';
    if (normalizedStatus.includes('pend') || normalizedStatus.includes('process')) return 'border-amber-100 bg-amber-50 text-amber-700';
    return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  };

  const copyTransactionHash = async (hash) => {
    if (!hash || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedTransactionHash(hash);
      window.setTimeout(() => setCopiedTransactionHash(''), 2000);
    } catch (error) {
      console.error('Could not copy transaction hash:', error);
    }
  };

  const fetchBuyerDashboardData = async () => {
    if (!studentId) return;

    const token = getStudentSessionToken();
    if (!token) {
      setOrders([]);
      setHiddenOrdersCount(0);
      setOrdersLoading(false);
      setOrdersError('Your student session has expired. Please sign in again.');
      return;
    }
    setOrdersLoading(true);
    setOrdersError('');

    try {
      const [wishRes, cartRes, orderRes, hiddenOrderRes, payRes, hiddenPayRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/student/wishlist?student_id=${studentId}`),
        fetch(`${API_BASE_URL}/api/student/cart?student_id=${studentId}`, {
          cache: 'no-store',
          credentials: 'include',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }),
        fetch(`${API_BASE_URL}/api/student/orders?student_id=${encodeURIComponent(studentId)}`, {
          cache: 'no-store',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }),
        fetch(`${API_BASE_URL}/api/student/orders?student_id=${encodeURIComponent(studentId)}&hidden=true`, {
          cache: 'no-store',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }),
        fetch(`${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(studentId)}`, {
          cache: 'no-store',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }),
        fetch(`${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(studentId)}&hidden=true`, {
          cache: 'no-store',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }),
      ]);

      if (wishRes.ok) {
        const wishData = await wishRes.json();
        setWishlist(wishData);
        setWishlistBadgeCount(Array.isArray(wishData) ? wishData.length : Number(wishData?.wishlist_count ?? wishData?.wishlist_item_count ?? 0));
      }

      if (cartRes.ok) {
        const cartData = await cartRes.json();
        replaceCartItems(cartData.items || []);
      }

      if (orderRes.ok) {
        const orderData = await orderRes.json();
        updateOrdersAndBadge(Array.isArray(orderData) ? orderData : []);
      } else {
        const errorData = await orderRes.json().catch(() => ({}));
        setOrdersError(errorData.detail || 'Unable to load your orders.');
      }

      if (hiddenOrderRes.ok) {
        const hiddenOrderData = await hiddenOrderRes.json();
        setHiddenOrdersCount(Array.isArray(hiddenOrderData) ? hiddenOrderData.length : 0);
      }

      if (payRes.ok) {
        const payData = await payRes.json();
        const nextBalance = Number(payData?.balance ?? payData?.walletBalance ?? payData?.wallet_balance ?? 0);
        const normalizedBalance = Number.isFinite(nextBalance) ? nextBalance : 0;
        const normalizedTransactions = Array.isArray(payData?.transactions) ? payData.transactions : [];
        setHiddenTransactionsCount(Number(payData?.hidden_count || 0));

        setPaymentInfo({
          balance: normalizedBalance,
          heldBalance: Number(payData?.held_balance || 0),
          recentTx: payData?.recentTx || payData?.recent_tx || (normalizedTransactions[0] ? getTransactionSummaryText(normalizedTransactions[0]) : 'No transactions yet'),
          transactions: normalizedTransactions,
        });

        const balanceChanged = normalizedBalance !== walletBalanceRef.current;
        if (balanceChanged) {
          walletBalanceRef.current = normalizedBalance;
          setWalletBalance(normalizedBalance);
        }

        if (balanceChanged && onUserUpdate) {
          onUserUpdate((currentUser) => currentUser ? { ...currentUser, wallet_balance: normalizedBalance } : currentUser);
        }
      }

      if (hiddenPayRes.ok) {
        const hiddenPayData = await hiddenPayRes.json();
        const hiddenTransactionRows = Array.isArray(hiddenPayData?.transactions) ? hiddenPayData.transactions : [];
        setHiddenTransactions(hiddenTransactionRows);
        setHiddenTransactionsCount(Number(hiddenPayData?.hidden_count ?? hiddenTransactionRows.length));
      }
    } catch (err) {
      console.error('Error fetching buyer data:', err);
      setOrdersError('Unable to load your orders. Check your connection and try again.');
    } finally {
      setOrdersLoading(false);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    if (!orderId) return;
    const token = getStudentSessionToken();
    setOrderDetailsLoading(true);
    setOrderDetailsError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/orders/detail/${encodeURIComponent(orderId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load order details.');
      setSelectedOrder(data);
    } catch (error) {
      setOrderDetailsError(error.message || 'Unable to load order details.');
    } finally {
      setOrderDetailsLoading(false);
    }
  };

  const loadOrdersView = async (hidden) => {
    if (!studentId) return;
    const token = getStudentSessionToken();
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/orders?student_id=${encodeURIComponent(studentId)}&hidden=${hidden ? 'true' : 'false'}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load your orders.');
      const nextOrders = Array.isArray(data) ? data : [];
      if (hidden) {
        setOrders(nextOrders);
        setHiddenOrdersCount(nextOrders.length);
      } else {
        updateOrdersAndBadge(nextOrders);
      }
    } catch (error) {
      setOrdersError(error.message || 'Unable to load your orders.');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleOrderVisibility = async (order) => {
    if (!order?.id) return;
    const token = getStudentSessionToken();
    const isHidden = showHiddenOrders;
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/orders/${encodeURIComponent(order.id)}/${isHidden ? 'unhide' : 'hide'}`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Unable to ${isHidden ? 'restore' : 'hide'} this order.`);
      setOrders((previous) => previous.filter((item) => item.id !== order.id));
      setHiddenOrdersCount((previous) => Math.max(0, previous + (isHidden ? -1 : 1)));
      setReviewFeedback(isHidden ? 'Order restored to My Orders.' : 'Order hidden from My Orders.');
      notifySuccess(studentToast('orderHidden'), `student-order-visibility-${order.id}`);
    } catch (error) {
      setReviewFeedback(error.message || `Unable to ${isHidden ? 'restore' : 'hide'} this order.`);
      notifyError(error, `student-order-visibility-${order.id}`);
    }
  };

  const handleOrdersViewChange = async (hidden) => {
    setShowHiddenOrders(hidden);
    await loadOrdersView(hidden);
  };

  const loadHiddenTransactions = async () => {
    if (!studentId) return;
    const token = getStudentSessionToken();
    setHiddenTransactionsLoading(true);
    setTransactionVisibilityError('');
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(studentId)}&hidden=true`,
        { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load hidden transactions.');
      const rows = Array.isArray(data?.transactions) ? data.transactions : [];
      setHiddenTransactions(rows);
      setHiddenTransactionsCount(Number(data?.hidden_count ?? rows.length));
    } catch (error) {
      setTransactionVisibilityError(error.message || 'Unable to load hidden transactions.');
    } finally {
      setHiddenTransactionsLoading(false);
    }
  };

  const handleTransactionVisibility = async (transaction) => {
    if (!transaction?.id) return;
    const isHidden = transactionFilter === 'hidden';
    const actionId = transaction.id;
    const token = getStudentSessionToken();
    setTransactionVisibilityActionId(actionId);
    setTransactionVisibilityError('');
    const updateTransactionVisibilityState = (hidden) => {
      if (hidden) {
        setPaymentInfo((previous) => ({
          ...previous,
          transactions: (Array.isArray(previous.transactions) ? previous.transactions : []).filter((item) => item.id !== actionId),
        }));
        setHiddenTransactions((previous) => [{ ...transaction, is_hidden: true }, ...previous.filter((item) => item.id !== actionId)]);
        setHiddenTransactionsCount((previous) => previous + 1);
      } else {
        setHiddenTransactions((previous) => previous.filter((item) => item.id !== actionId));
        setPaymentInfo((previous) => ({
          ...previous,
          transactions: [
            { ...transaction, is_hidden: false },
            ...(Array.isArray(previous.transactions) ? previous.transactions : []).filter((item) => item.id !== actionId),
          ].slice(0, 20),
        }));
        setHiddenTransactionsCount((previous) => Math.max(0, previous - 1));
      }
    };
    updateTransactionVisibilityState(!isHidden);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/student/wallet/transactions/${encodeURIComponent(actionId)}/${isHidden ? 'unhide' : 'hide'}`,
        { method: 'PATCH', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Unable to ${isHidden ? 'restore' : 'hide'} this transaction.`);
      notifySuccess(
        isHidden ? 'Transaction restored to history.' : 'Transaction hidden from history.',
        `student-transaction-visibility-${actionId}`,
      );
    } catch (error) {
      updateTransactionVisibilityState(isHidden);
      setTransactionVisibilityError(error.message || `Unable to ${isHidden ? 'restore' : 'hide'} this transaction.`);
      notifyError(error, `student-transaction-visibility-${actionId}`);
    } finally {
      setTransactionVisibilityActionId(null);
    }
  };

  const isReceiptUnavailable = (orderId) => {
    const matchingOrders = orders.filter((item) => String(item.id) === String(orderId));
    if (String(selectedOrder?.id) === String(orderId)) matchingOrders.push(selectedOrder);
    return matchingOrders.some(isOrderRefunded);
  };

  const fetchPaymentReceipt = async (orderId) => {
    if (isReceiptUnavailable(orderId)) {
      throw new Error('Receipts are unavailable for refunded orders. See the refund confirmation in order details.');
    }
    const token = getStudentSessionToken();
    setPaymentReceiptState((previous) => ({ ...previous, [orderId]: { loading: true } }));
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/orders/${encodeURIComponent(orderId)}/receipt`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load the payment receipt.');
      setPaymentReceiptState((previous) => ({ ...previous, [orderId]: { data } }));
      return data;
    } catch (error) {
      setPaymentReceiptState((previous) => ({ ...previous, [orderId]: { error: error.message || 'Unable to load the payment receipt.' } }));
      throw error;
    }
  };

  useEffect(() => {
    if (!printingReceiptOrderId || !paymentReceiptState[printingReceiptOrderId]?.data) return undefined;

    const printWindow = printWindowRef.current;
    const receiptElement = document.getElementById('printable-receipt');
    if (!printWindow || printWindow.closed || !receiptElement) {
      printWindow?.close();
      printWindowRef.current = null;
      printStartedRef.current = false;
      setPrintingReceiptOrderId(null);
      return undefined;
    }
    if (printStartedRef.current) return undefined;
    printStartedRef.current = true;

    const printStyles = `
      <style>
        @page { size: A4; margin: 10mm; }
        html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
        #printable-receipt { display: block !important; visibility: visible !important; position: static !important; width: 100% !important; max-width: none !important; margin: 0 !important; box-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; break-inside: avoid; break-after: avoid; page-break-inside: avoid; }
      </style>`;
    printWindow.onafterprint = () => {
      printWindow.close();
      printWindowRef.current = null;
      printStartedRef.current = false;
      setPrintingReceiptOrderId(null);
    };
    const popupDocument = printWindow.document;
    popupDocument.open();
    popupDocument.write('<!doctype html><html><head><meta charset="utf-8"><title>UniXchange Payment Receipt</title></head><body></body></html>');
    popupDocument.close();

    const baseElement = popupDocument.createElement('base');
    baseElement.href = `${window.location.origin}/`;
    popupDocument.head.prepend(baseElement);

    const stylesheetLoads = [];
    Array.from(document.head.querySelectorAll('link[rel~="stylesheet" i], style')).forEach((sourceStyle) => {
      const copiedStyle = sourceStyle.cloneNode(sourceStyle.tagName === 'STYLE');
      if (sourceStyle.tagName === 'LINK') {
        copiedStyle.href = sourceStyle.href;
        stylesheetLoads.push(new Promise((resolve) => {
          copiedStyle.addEventListener('load', resolve, { once: true });
          copiedStyle.addEventListener('error', resolve, { once: true });
        }));
      }
      popupDocument.head.appendChild(copiedStyle);
    });

    popupDocument.body.innerHTML = receiptElement.outerHTML;
    popupDocument.head.insertAdjacentHTML('beforeend', printStyles);

    Promise.all(stylesheetLoads)
      .then(() => popupDocument.fonts?.ready)
      .then(() => {
        if (printWindow.closed) return;
        printWindow.focus();
        printWindow.print();
      });

    return undefined;
  }, [printingReceiptOrderId, paymentReceiptState]);

  const handleViewPaymentReceipt = async (orderId) => {
    if (isReceiptUnavailable(orderId)) return;
    if (!paymentReceiptState[orderId]?.data) await fetchPaymentReceipt(orderId);
  };

  const handleDownloadPaymentReceipt = async (orderId) => {
    if (isReceiptUnavailable(orderId)) return;
    const receipt = paymentReceiptState[orderId]?.data || await fetchPaymentReceipt(orderId);
    buildPaymentReceiptPdf(receipt).save(paymentReceiptPdfFilename(receipt.order_number));
  };

  const handlePrintPaymentReceipt = async (orderId) => {
    if (isReceiptUnavailable(orderId)) return;
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      setOrdersError('Allow pop-ups to print the receipt.');
      return;
    }
    printWindowRef.current = printWindow;
    printStartedRef.current = false;
    try {
      if (!paymentReceiptState[orderId]?.data) await fetchPaymentReceipt(orderId);
    } catch {
      printWindow.close();
      printWindowRef.current = null;
      printStartedRef.current = false;
      return;
    }
    setPrintingReceiptOrderId(orderId);
  };

  const updateOrderDashboardUrl = (orderId, tab) => {
    const nextUrl = new URL(buildOrderDashboardUrl(orderId, tab), window.location.origin);
    const currentUrl = new URL(window.location.href);
    ['orders_page', 'orders_search', 'orders_date_from', 'orders_date_to'].forEach((key) => {
      const value = currentUrl.searchParams.get(key);
      if (value) nextUrl.searchParams.set(key, value);
    });
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (currentHref !== nextHref) {
      window.history.pushState({ ...window.history.state, dashboardOrderId: String(orderId) }, '', nextHref);
    }
  };

  const handleDisputeNotification = async ({ order_id: orderId }) => {
    const token = getStudentSessionToken();
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/orders/detail/${encodeURIComponent(orderId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load dispute details.');
      const currentStudentId = String(user?.studentId || user?.student_id || '').trim().toLowerCase();
      if (String(data.buyer_id || '').trim().toLowerCase() === currentStudentId) {
        setSelectedOrder(data);
        setBuyerTab('orders');
        setActiveTab('buyer');
        updateOrderDashboardUrl(Number(orderId), 'buyer');
      } else {
        setPendingSellerOrderId(Number(orderId));
        setActiveTab('seller');
        updateOrderDashboardUrl(Number(orderId), 'seller');
      }
    } catch (error) {
      setSelectedOrder(null);
      setPendingSellerOrderId(null);
      setBuyerTab('orders');
      setActiveTab('buyer');
      setOrdersError('');
      setOrderNavigationMessage(error.message || 'Unable to load this order. Your orders are shown below.');
    }
  };

  const handleOrderNotification = async (orderId) => {
    const numericOrderId = Number(orderId);
    if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
      setBuyerTab('orders');
      setActiveTab('buyer');
      setOrderNavigationMessage('This order link has an invalid order id. Your orders are shown below.');
      return;
    }
    setSelectedOrder(null);
    setOrderNavigationMessage('');
    const token = getStudentSessionToken();
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/orders/detail/${encodeURIComponent(numericOrderId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load order details.');
      const currentStudentId = String(user?.studentId || user?.student_id || '').trim().toLowerCase();
      if (String(data.buyer_id || '').trim().toLowerCase() === currentStudentId) {
        setSelectedOrder(data);
        setBuyerTab('orders');
        setActiveTab('buyer');
        updateOrderDashboardUrl(numericOrderId, 'buyer');
      } else {
        setPendingSellerOrderId(numericOrderId);
        setActiveTab('seller');
        updateOrderDashboardUrl(numericOrderId, 'seller');
      }
    } catch (error) {
      setSelectedOrder(null);
      setPendingSellerOrderId(null);
      setBuyerTab('orders');
      setActiveTab('buyer');
      setOrderNavigationMessage(error.message || 'Unable to load this order. Your orders are shown below.');
    }
  };

  useEffect(() => {
    if (initialOrderNavigationHandledRef.current) return;
    const orderLink = parseOrderDashboardLink(window.location.href);
    if (!orderLink || orderLink.section !== 'orders') return;
    initialOrderNavigationHandledRef.current = true;
    if (orderLink.tab === 'seller') {
      setActiveTab('seller');
      setPendingSellerOrderId(orderLink.orderId);
      return;
    }
    if (orderLink.tab === 'buyer') setBuyerTab('orders');
    if (!orderLink.orderId) {
      setBuyerTab('orders');
      setActiveTab('buyer');
      setOrderNavigationMessage(orderLink.hasOrderParameter
        ? 'This order link has an invalid order id. Your orders are shown below.'
        : 'This link does not include an order id. Your orders are shown below.');
      return;
    }
    void handleOrderNotification(orderLink.orderId);
    // This runs once for the order link present when the dashboard mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const syncOrderFromHistory = () => {
      const orderLink = parseOrderDashboardLink(window.location.href);
      if (!orderLink || orderLink.section !== 'orders') return;
      if (orderLink.tab === 'seller') {
        setActiveTab('seller');
        setPendingSellerOrderId(orderLink.orderId);
        return;
      }
      if (orderLink.tab === 'buyer') setBuyerTab('orders');
      setActiveTab(orderLink.tab);
      if (!orderLink.orderId) {
        setBuyerTab('orders');
        setActiveTab('buyer');
        setOrderNavigationMessage(orderLink.hasOrderParameter
          ? 'This order link has an invalid order id. Your orders are shown below.'
          : 'This link does not include an order id. Your orders are shown below.');
        return;
      }
      void handleOrderNotification(orderLink.orderId);
    };

    window.addEventListener('popstate', syncOrderFromHistory);
    return () => window.removeEventListener('popstate', syncOrderFromHistory);
    // The history handler always reads the current location; the order loader is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || paymentVerificationStartedRef.current) return;

    const callbackUrl = new URL(window.location.href);
    let transactionReference = callbackUrl.searchParams.get('trx_ref')
      || callbackUrl.searchParams.get('tx_ref')
      || callbackUrl.searchParams.get('ref_id');
    const returnedSuccessfully = ['success', 'successful', 'completed'].includes(
      String(callbackUrl.searchParams.get('status') || '').trim().toLowerCase(),
    );
    if ((!transactionReference && !returnedSuccessfully) || !user?.studentId) return;
    const token = getStudentSessionToken();
    if (!token) return;

    paymentVerificationStartedRef.current = true;
    if (transactionReference) depositAutoChecksRef.current.add(transactionReference);
    setActiveTab('buyer');
    setBuyerTab('payments');
    let isMounted = true;
    let verificationTimeoutId;

    const refreshWalletLedger = async () => {
      if (!user?.studentId) return;
      const response = await fetch(`${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(user.studentId)}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const nextBalance = Number(data?.balance ?? data?.walletBalance ?? data?.wallet_balance ?? 0);
      const normalizedTransactions = Array.isArray(data?.transactions) ? data.transactions : [];
      if (!isMounted) return;
      if (Number.isFinite(nextBalance)) {
        walletBalanceRef.current = nextBalance;
        setWalletBalance(nextBalance);
      }
      setPaymentInfo((previousPaymentInfo) => ({
        ...previousPaymentInfo,
        balance: Number.isFinite(nextBalance) ? nextBalance : previousPaymentInfo.balance,
        heldBalance: Number(data?.held_balance ?? previousPaymentInfo.heldBalance ?? 0),
        recentTx: data?.recentTx || data?.recent_tx || previousPaymentInfo.recentTx,
        transactions: normalizedTransactions,
      }));
    };

    const verifyReturnedPayment = async () => {
      let status = 'Pending';

      setPaymentVerificationState('confirming');
      if (!transactionReference && returnedSuccessfully) {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(user.studentId)}`,
            { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } },
          );
          const data = await response.json().catch(() => ({}));
          const recentDeposit = (Array.isArray(data?.transactions) ? data.transactions : []).find((item) => {
            const transactionStatus = String(item?.status || '').trim().toLowerCase();
            const transactionType = `${item?.type || ''} ${item?.label || ''}`.toLowerCase();
            const createdAtValue = String(item?.created_at || '');
            const timestamp = Date.parse(
              createdAtValue && !/(Z|[+-]\d{2}:?\d{2})$/i.test(createdAtValue)
                ? `${createdAtValue}Z`
                : createdAtValue,
            );
            return transactionType.includes('deposit')
              && ['pending', 'processing', 'successful', 'completed'].includes(transactionStatus)
              && Number.isFinite(timestamp)
              && Date.now() - timestamp >= 0
              && Date.now() - timestamp <= 5 * 60 * 1000;
          });
          transactionReference = recentDeposit?.hash || recentDeposit?.tx_ref || '';
        } catch (error) {
          console.error('Unable to find the returned wallet deposit:', error);
        }
      }

      if (!transactionReference) {
        if (isMounted) setPaymentVerificationState('pending_timeout');
        return;
      }

      depositAutoChecksRef.current.add(transactionReference);
      for (let attempt = 0; isMounted && attempt < 5 && status === 'Pending'; attempt += 1) {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/payment/verify/${encodeURIComponent(transactionReference)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const data = await response.json().catch(() => ({}));
          status = String(data?.status || '').trim().toLowerCase() === 'successful'
            ? 'Successful'
            : String(data?.status || '').trim().toLowerCase() === 'failed'
              ? 'Failed'
              : 'Pending';

          const isProductPayment = data?.transaction_type === 'Product Purchase' || data?.order_id !== undefined;
          if (!isProductPayment) await refreshWalletLedger();

          if (response.ok && status === 'Successful') {
            if (isProductPayment) {
              if (data?.order?.id !== undefined) {
                setOrders((currentOrders) => {
                  const existingOrder = currentOrders.some(
                    (order) => String(order.id) === String(data.order.id),
                  );
                  return existingOrder
                    ? currentOrders.map((order) => (
                      String(order.id) === String(data.order.id) ? data.order : order
                    ))
                    : [data.order, ...currentOrders];
                });
              }
              await fetchBuyerDashboardData();
              if (!isMounted) break;
              setBuyerTab('orders');
              setPaymentVerificationState('successful');
              notifySuccess(
                `Product payment confirmed${data.order_id ? ` for order #${data.order_id}` : ''}.`,
                `student-product-payment-confirmed-${transactionReference}`,
              );
              callbackUrl.searchParams.delete('trx_ref');
              callbackUrl.searchParams.delete('tx_ref');
              callbackUrl.searchParams.delete('status');
              window.history.replaceState(
                {},
                document.title,
                `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`,
              );
              break;
            }

            const verifiedBalance = Number(data?.wallet_balance ?? data?.walletBalance ?? data?.balance);
            if (Number.isFinite(verifiedBalance)) {
              walletBalanceRef.current = verifiedBalance;
              setWalletBalance(verifiedBalance);
              setPaymentInfo((previousPaymentInfo) => ({
                ...previousPaymentInfo,
                balance: verifiedBalance,
              }));
              if (onUserUpdate) {
                onUserUpdate((currentUser) => currentUser
                  ? { ...currentUser, wallet_balance: verifiedBalance }
                  : currentUser);
              }
            }

            setPaymentInfo((previousPaymentInfo) => ({
              ...previousPaymentInfo,
              transactions: (Array.isArray(previousPaymentInfo.transactions) ? previousPaymentInfo.transactions : [])
                .map((transaction) => [transaction?.hash, transaction?.tx_ref, transaction?.reference]
                  .some((reference) => String(reference || '') === transactionReference)
                  ? { ...transaction, status: 'Successful' }
                  : transaction),
            }));
            notifySuccess(
              'Deposit confirmed! Your wallet balance has been updated.',
              `student-deposit-confirmed-${transactionReference}`,
            );

            await fetchBuyerDashboardData();
            if (isMounted) setPaymentVerificationState('successful');

            callbackUrl.searchParams.delete('trx_ref');
            callbackUrl.searchParams.delete('tx_ref');
            callbackUrl.searchParams.delete('status');
            window.history.replaceState(
              {},
              document.title,
              `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`,
            );
          } else if (!response.ok || status === 'Failed') {
            if (isMounted) {
              setPaymentVerificationState('failed');
              setDepositError(data?.detail || 'We could not confirm your payment. Please try again.');
            }
            notifyError({ detail: data?.detail || studentToast('paymentFailed') }, 'student-payment-failed');
            break;
          } else if (attempt < 4) {
            if (isMounted) setPaymentVerificationState('pending');
            await new Promise((resolve) => {
              verificationTimeoutId = window.setTimeout(resolve, 4000);
            });
          }
        } catch (error) {
          console.error('Returned payment verification failed:', error);
          if (attempt < 4 && isMounted) {
            setPaymentVerificationState('pending');
            await new Promise((resolve) => {
              verificationTimeoutId = window.setTimeout(resolve, 4000);
            });
          } else if (isMounted) {
            setPaymentVerificationState('pending_timeout');
          }
        }
      }

      if (isMounted && status === 'Pending') {
        setPaymentVerificationState('pending_timeout');
      }
    };

    verifyReturnedPayment();
    return () => {
      isMounted = false;
      window.clearTimeout(verificationTimeoutId);
    };
    // The dashboard refresh function is intentionally excluded because it is recreated on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getStudentSessionToken, user?.studentId]);

  const sellerStatusSummary = (() => {
    if (!myListings.length) {
      return { label: 'Pending', tone: 'amber', details: 'No listings posted yet' };
    }

    const statuses = myListings.map((item) => String(item.status || 'Pending').toLowerCase());
    if (statuses.some((status) => status.includes('flag') || status.includes('reject'))) {
      return { label: 'Flagged', tone: 'rose', details: `${statuses.filter((status) => status.includes('flag') || status.includes('reject')).length} listing(s) flagged` };
    }
    if (statuses.some((status) => status.includes('pending'))) {
      return { label: 'Pending', tone: 'amber', details: `${statuses.filter((status) => status.includes('pending')).length} listing(s) awaiting review` };
    }
    return { label: 'Approved', tone: 'emerald', details: `${statuses.length} listing(s) approved` };
  })();

  const fetchProducts = useCallback(async ({ search, category, subcategory, limit, department } = {}) => {
    setSearchLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (subcategory) params.set('subcategory', subcategory);
      if (limit) params.set('limit', String(limit));
      if (department) params.set('department', department);
      const url = `${API_BASE_URL}/api/products${params.toString() ? `?${params.toString()}` : ''}`;
      const token = getStudentSessionToken();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load products');
      const productData = await res.json();
      setSearchResults(filterPublicProducts(productData, user));
    } catch (err) {
      console.error('Error loading products:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [getStudentSessionToken, user]);

  const fetchSellerDashboardData = async () => {
    if (!user?.studentId) {
      setMyListings([]);
      setSellerDashboardData((previous) => ({ ...previous, my_listings: [], received_orders: [] }));
      return;
    }

    const token = getStudentSessionToken();
    if (!token) {
      notifyError(
        new Error('Your student session is missing. Please sign in again.'),
        'student-seller-dashboard-load',
      );
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/seller/dashboard-data?student_id=${encodeURIComponent(user.studentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to load seller dashboard data');
      }
      const data = await response.json();
      const listings = Array.isArray(data.my_listings) ? data.my_listings : [];
      const orders = Array.isArray(data.received_orders) ? data.received_orders : [];
      const payoutTracker = payoutStatusTrackerRef.current;
      if (payoutTracker.studentId !== String(user.studentId)) {
        let notifiedEventIds = new Set();
        try {
          const savedEventIds = JSON.parse(
            window.sessionStorage.getItem(`campaceNotifiedPayoutEvents:${user.studentId}`) || '[]',
          );
          if (Array.isArray(savedEventIds)) notifiedEventIds = new Set(savedEventIds.map(String));
        } catch {
          // Storage may be unavailable; in-memory deduplication still applies.
        }
        payoutTracker.studentId = String(user.studentId);
        payoutTracker.lastStatusByPayoutId = new Map();
        payoutTracker.notifiedEventIds = notifiedEventIds;
      }
      orders.forEach((order) => {
        const payoutId = String(order.payout_id ?? order.id ?? order.order_id ?? '');
        if (!payoutId) return;
        const currentStatus = String(order.payout_status || (order.is_funds_released ? 'Released' : 'Escrow Hold'))
          .trim()
          .toLowerCase();
        const previousStatus = payoutTracker.lastStatusByPayoutId.get(payoutId);
        const eventId = `payout-${payoutId}-${currentStatus}`;
        if (
          previousStatus !== undefined
          && previousStatus !== currentStatus
          && currentStatus === 'released'
          && String(order.status || '').trim().toLowerCase() === 'completed'
          && !payoutTracker.notifiedEventIds.has(eventId)
        ) {
          const netAmount = Number(order.net_amount);
          if (Number.isFinite(netAmount)) {
            const message = studentToast('orderPayoutReleased')
              .replace('{orderId}', String(order.order_id ?? order.id))
              .replace('{netAmount}', netAmount.toLocaleString(undefined, { maximumFractionDigits: 2 }));
            payoutTracker.notifiedEventIds.add(eventId);
            try {
              window.sessionStorage.setItem(
                `campaceNotifiedPayoutEvents:${user.studentId}`,
                JSON.stringify([...payoutTracker.notifiedEventIds]),
              );
            } catch {
              // Keep the event deduplicated for this mount if storage is unavailable.
            }
            notifySuccess(message, eventId);
          }
        }
        payoutTracker.lastStatusByPayoutId.set(payoutId, currentStatus);
      });
      const stats = data.stats || {};
      const alerts = data.alerts || {};
      setSellerDashboardData({ stats, alerts, performance: data.performance || {}, my_listings: listings, received_orders: orders });
      setMyListings(listings);
      setSellerData({
        totalListings: Number(stats.total_listings) || 0,
        receivedOrders: Number(stats.received_orders) || 0,
        totalRevenue: Number(stats.completed_revenue) || 0,
        incomingOrders: orders,
        activeListings: listings,
        account_status: data.account_status || 'Pending',
      });
    } catch (err) {
      console.error('Error fetching seller dashboard data:', err);
      notifyError(err, 'student-seller-dashboard-load');
    }
  };

  useEffect(() => {
    if (activeTab === 'profile') {
      setActiveTab('settings');
      setSettingsTab('account');
    }
  }, [activeTab]);

  const resetSearchFilters = () => {
    setSearchCategory('');
    setSearchSubcategory('');
    setSearchQuery('');
  };

  const studentId = user?.studentId || user?.student_id || user?.username || user?.email || '';

  useEffect(() => {
    if (!studentId) return;

    const fetchFreshProfile = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/student/profile?student_id=${encodeURIComponent(studentId)}`);
        if (!response.ok) return;

        const data = await response.json();
        const freshUser = data?.user;
        if (!freshUser) return;

        if (onUserUpdate) {
          onUserUpdate((currentUser) => currentUser ? { ...currentUser, ...freshUser } : currentUser);
        }
        setProfileForm((previous) => ({
          ...previous,
          name: freshUser.name || '',
          studentId: freshUser.studentId || studentId,
          email: freshUser.email || '',
          phone: freshUser.phone || '',
          college: freshUser.college || '',
          department: freshUser.department || '',
        }));
      } catch (err) {
        console.error('Error fetching fresh student profile:', err);
      }
    };

    fetchFreshProfile();
  }, [studentId, onUserUpdate]);

  useEffect(() => {
    const fetchModalDropdownData = async () => {
      try {
        const token = getStudentSessionToken();
        const response = await fetch(`${API_BASE_URL}/api/categories`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return;

        const catData = await response.json();
        setCategories(catData);
        setDbCategories(catData);
      } catch (err) {
        console.error('Error fetching dropdown data:', err);
      }
    };

    fetchModalDropdownData();
  }, [getStudentSessionToken]);

  useEffect(() => {
    const fetchMarketplaceSettings = async () => {
      try {
        const settings = await getAdminSettings();
        const configuredSize = settings?.marketplace?.maxImageSize;
        if (configuredSize) {
          const nextSize = String(configuredSize);
          setMaxImageSize((current) => current === nextSize ? current : nextSize);
        }
        const configuredImageCount = Number(settings?.marketplace?.maxImagesPerProduct);
        if (Number.isFinite(configuredImageCount) && configuredImageCount >= 0) {
          setMaxImagesPerProduct((current) => current === configuredImageCount ? current : configuredImageCount);
        }
      } catch (err) {
        console.error('Error fetching marketplace settings:', err);
      }
    };

    fetchMarketplaceSettings();
  }, []);

  useEffect(() => {
    if (!studentId || activeTab !== 'notifications') return;

    let cancelled = false;
    let requestInFlight = false;
    const fetchNotificationsData = async () => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await fetch(`${API_BASE_URL}/api/student/notifications?student_id=${encodeURIComponent(studentId)}`, {
          headers: { Authorization: `Bearer ${getStudentSessionToken()}` },
        });
        if (!response.ok) return;

        const notifData = await response.json();
        const notificationItems = Array.isArray(notifData)
          ? notifData
          : notifData.notifications || notifData.allNotifications || [];
        const normalizedNotifications = notificationItems.map((notification) => ({
          ...notification,
          read: Boolean(notification.read ?? notification.is_read),
          type: notification.type || notification.category || 'system',
        }));
        if (!cancelled) {
          setNotifications((previousNotifications) => (
            JSON.stringify(previousNotifications) === JSON.stringify(normalizedNotifications)
              ? previousNotifications
              : normalizedNotifications
          ));
        }
      } catch (err) {
        if (!cancelled) console.error('Error fetching notifications:', err);
      } finally {
        requestInFlight = false;
      }
    };

    void fetchNotificationsData();
    const refreshId = window.setInterval(fetchNotificationsData, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
    };
  }, [activeTab, studentId, getStudentSessionToken]);

  const handleMarkNotificationRead = async (notificationId) => {
    if (!user?.studentId) return;

    const previousNotifications = notifications;
    const unreadBeforeUpdate = previousNotifications.filter((notification) => String(notification.id) === String(notificationId) && !notification.read).length;

    setNotifications((previousNotificationsState) => previousNotificationsState.map((notification) => (
      String(notification.id) === String(notificationId)
        ? { ...notification, read: true }
        : notification
    )));

    if (unreadBeforeUpdate > 0) {
      setUnreadNotificationCount((count) => Math.max(0, count - unreadBeforeUpdate));
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/student/notifications/mark-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getStudentSessionToken()}`,
        },
        body: JSON.stringify({ student_id: user.studentId, notification_id: notificationId || undefined }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to mark notification as read.');
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
      setNotifications(previousNotifications);
      if (unreadBeforeUpdate > 0) {
        setUnreadNotificationCount((count) => count + unreadBeforeUpdate);
      }
      notifyError(err, `student-notification-read-${notificationId || 'all'}`);
    }
  };

  const handleDeleteNotification = async (id) => {
    const notificationToDelete = notifications.find((notification) => String(notification.id) === String(id));
    const wasUnread = shouldReduceUnreadNotificationCount(notificationToDelete);
    const previousNotifications = notifications;

    setNotifications((previousNotificationsState) => previousNotificationsState.filter((notification) => String(notification.id) !== String(id)));
    if (wasUnread) {
      setUnreadNotificationCount((count) => Math.max(0, count - 1));
    }

    const toastId = `student-notification-delete-${id}`;

    try {
      const response = await fetch(`${API_BASE_URL}/api/student/notifications/${id}?student_id=${encodeURIComponent(studentId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getStudentSessionToken()}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete notification.');
      }

      toast.custom((toastItem) => (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/25">
          <span className="min-w-0 flex-1">{studentToast('notificationsDeleted')}</span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(toastItem.id);
              setNotifications(previousNotifications);
              if (wasUnread) {
                setUnreadNotificationCount((count) => count + 1);
              }
            }}
            className="shrink-0 font-bold underline underline-offset-2 text-white"
          >
            Undo
          </button>
        </div>
      ), { id: toastId, duration: 5000 });
    } catch (err) {
      console.error('Error deleting notification:', err);
      setNotifications(previousNotifications);
      if (wasUnread) {
        setUnreadNotificationCount((count) => count + 1);
      }
      notifyError(err, toastId);
    }
  };

  useEffect(() => {
    const fetchRecentActivity = async () => {
      if (!studentId) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/student/recent-activity?student_id=${encodeURIComponent(studentId)}`);
        if (!response.ok) return;

        const activityData = await response.json();
        setRecentCampusActivity(Array.isArray(activityData) ? activityData : (activityData.items || []));
      } catch (err) {
        console.error('Error fetching recent activity:', err);
      }
    };

    if (user?.avatarUrl) {
      const normalizedAvatarUrl = user.avatarUrl.includes('?')
        ? user.avatarUrl
        : `${user.avatarUrl}?t=${Date.now()}`;

      setAvatarUrl((prev) => (prev === normalizedAvatarUrl ? prev : normalizedAvatarUrl));
    } else {
      setAvatarUrl('');
    }

    fetchRecentActivity();
  }, [studentId, user?.avatarUrl, user?.department]);

  useEffect(() => {
    let cancelled = false;
    if (!studentId) return () => { cancelled = true; };

    const fetchRecommendations = async () => {
      try {
        const token = getStudentSessionToken();
        const response = await fetch(`${API_BASE_URL}/api/student/recommendations?student_id=${encodeURIComponent(studentId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('Failed to load recommendations');

        const recommendationData = await response.json();
        const recommendations = Array.isArray(recommendationData)
          ? recommendationData
          : recommendationData?.recommendations || recommendationData?.items || [];
        if (!cancelled) {
          setRecommendedProducts(filterPublicProducts(recommendations, user));
          setRecommendationsStudentId(studentId);
        }
      } catch {
        if (!cancelled) {
          setRecommendedProducts([]);
          setRecommendationsStudentId(studentId);
        }
      }
    };

    fetchRecommendations();
    return () => { cancelled = true; };
  }, [studentId, getStudentSessionToken, user]);

  const loadSearchDefaults = useCallback(async () => {
    if (activeTab !== 'buyer' || buyerTab !== 'search') return;
    await fetchProducts({ limit: BUYER_HUB_PAGE_SIZE, department: user?.department });
  }, [activeTab, buyerTab, fetchProducts, user?.department]);

  useEffect(() => {
    if (activeTab !== 'buyer' || buyerTab !== 'search') return;
    loadSearchDefaults();
  }, [activeTab, buyerTab, loadSearchDefaults]);

  // Load personalized recommendations for AI Advisor tab
  useEffect(() => {
    if (activeTab !== 'ai-advisor') return;
    if (!user?.department) return;

    const loadAiRecommendations = async () => {
      try {
        await fetchProducts({ limit: BUYER_HUB_PAGE_SIZE, department: user?.department });
      } catch (err) {
        console.error('Error loading AI advisor recommendations:', err);
      }
    };

    loadAiRecommendations();
  }, [activeTab, fetchProducts, user?.department]);

  useEffect(() => {
    const requestedTab = getConversationIdFromUrl() ? 'messages' : initialTab === 'profile' ? 'settings' : initialTab;
    if (requestedTab) {
      setActiveTab((currentTab) => currentTab === requestedTab ? currentTab : requestedTab);
      if (requestedTab === 'seller') setDashboardMode('seller');
      if (requestedTab === 'buyer') setDashboardMode('buyer');
    }
  }, [initialTab]);
  useEffect(() => {
    if (activeTab === 'seller' && dashboardMode !== 'seller') {
      setDashboardMode('seller');
      onTabChange?.('seller', 'seller');
    } else if (activeTab === 'buyer' && dashboardMode !== 'buyer') {
      setDashboardMode('buyer');
      onTabChange?.('buyer', 'buyer', buyerTab);
    }
  }, [activeTab, buyerTab, dashboardMode, onTabChange]);

  useEffect(() => {
    if (activeTab === 'messages' || !getConversationIdFromUrl()) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('conversation');
    window.history.replaceState(window.history.state, '', url);
  }, [activeTab]);

  useEffect(() => {
    const syncSelectedConversation = () => {
      const conversationId = getConversationIdFromUrl();
      if (conversationId) {
        shouldAutoScrollRef.current = true;
        setActiveConversationId(conversationId);
        setMobileChatView('chat');
        setActiveTab('messages');
      } else {
        setMobileChatView('list');
      }
    };

    window.addEventListener('popstate', syncSelectedConversation);
    return () => window.removeEventListener('popstate', syncSelectedConversation);
  }, []);

  const lastSyncedTabRef = useRef(null);

  useEffect(() => {
    if (onTabChange && activeTab !== lastSyncedTabRef.current) {
      lastSyncedTabRef.current = activeTab;
      onTabChange(activeTab);
    }
    // The parent recreates onTabChange; activeTab is the only value that controls this sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const sessionToken = getStudentSessionToken();
    if (!user?.studentId || !sessionToken) return;

    let isMounted = true;
    let unreadRequestInFlight = false;
    const currentStudentId = user.studentId;

    const fetchUnreadCounts = async () => {
      if (!isMounted || unreadRequestInFlight) return;
      unreadRequestInFlight = true;
      try {
        const messageResponse = await fetch(
          `${API_BASE_URL}/api/student/messages/unread-count?student_id=${encodeURIComponent(currentStudentId)}`,
          {
            credentials: 'include',
            headers: { Authorization: `Bearer ${sessionToken}` },
          },
        );
        if (!messageResponse.ok) return;
        const messageData = messageResponse.ok ? await messageResponse.json() : {};
        const parsedMessageCount = Number(messageData.unreadCount ?? messageData.unread_count ?? 0);
        const totalUnreadMessages = Number.isFinite(parsedMessageCount) ? parsedMessageCount : 0;

        if (isMounted) {
          setUnreadMessageCount((current) => current === totalUnreadMessages ? current : totalUnreadMessages);
        }
      } catch (err) {
        console.error('Error fetching unread sidebar counts:', err);
      } finally {
        unreadRequestInFlight = false;
      }
    };

    const fetchWalletBalance = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(user.studentId)}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const nextBalance = Number(data.balance ?? data.walletBalance ?? data.wallet_balance ?? 0);
        const normalizedBalance = Number.isFinite(nextBalance) ? nextBalance : 0;
        const normalizedTransactions = Array.isArray(data?.transactions) ? data.transactions : [];

        if (isMounted) {
          const balanceChanged = normalizedBalance !== walletBalanceRef.current;
          if (balanceChanged) {
            walletBalanceRef.current = normalizedBalance;
            setWalletBalance((current) => current === normalizedBalance ? current : normalizedBalance);
          }
          setPaymentInfo((prev) => {
            const nextPaymentInfo = {
              balance: normalizedBalance,
              heldBalance: Number(data?.held_balance ?? prev?.heldBalance ?? 0),
              recentTx: data?.recentTx || data?.recent_tx || (normalizedTransactions[0] ? getTransactionSummaryText(normalizedTransactions[0]) : prev?.recentTx || 'No transactions yet'),
              transactions: normalizedTransactions,
            };
            return Object.keys(nextPaymentInfo).every((key) => Object.is(prev?.[key], nextPaymentInfo[key]))
              ? prev
              : nextPaymentInfo;
          });

          if (balanceChanged && onUserUpdate) {
            onUserUpdate((currentUser) => currentUser ? { ...currentUser, wallet_balance: normalizedBalance } : currentUser);
          }
        }
      } catch (err) {
        console.error('Error fetching wallet balance:', err);
      }
    };

    fetchUnreadCounts();
    fetchWalletBalance();
    const unreadIntervalId = window.setInterval(fetchUnreadCounts, 30000);

    const handleRefreshOnFocus = () => {
      fetchWalletBalance();
    };

    window.addEventListener('focus', handleRefreshOnFocus);

    return () => {
      isMounted = false;
      window.clearInterval(unreadIntervalId);
      window.removeEventListener('focus', handleRefreshOnFocus);
    };
    // onUserUpdate and getTransactionSummaryText are intentionally excluded from this
    // student-scoped fetch to prevent parent callback identity changes from refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getStudentSessionToken, user?.studentId]);

  useEffect(() => {
    if (!studentId || !['buyer', 'seller'].includes(activeTab)) return undefined;

    let intervalId = null;
    let isActive = true;
    const refreshActiveDashboard = async () => {
      if (!isActive || document.visibilityState !== 'visible' || dashboardRefreshInFlightRef.current) return;
      dashboardRefreshInFlightRef.current = true;
      try {
        if (activeTab === 'buyer') {
          await fetchBuyerDashboardData();
          if (selectedOrder?.id) await fetchOrderDetails(selectedOrder.id);
        } else {
          await fetchSellerDashboardData();
        }
      } finally {
        dashboardRefreshInFlightRef.current = false;
      }
    };
    const syncPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (document.visibilityState !== 'visible') return;
      void refreshActiveDashboard();
      intervalId = window.setInterval(refreshActiveDashboard, 30000);
    };

    document.addEventListener('visibilitychange', syncPolling);
    syncPolling();
    return () => {
      isActive = false;
      if (intervalId !== null) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', syncPolling);
    };
    // Dashboard fetch functions are recreated on render; scope refresh to the active tab and selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, studentId, selectedOrder?.id]);

  // 2. ተማሪው ቅሬታውን ለአስተዳዳሪው የሚልክበት አሠራር (Submit Support Ticket)
  const handleSupportSubmit = async (e) => {
    e.preventDefault();
    setSupportMsg('');
    if (!supportIssue.trim()) return;

    try {
      const formData = new FormData();
      formData.append('subject', supportSubject.trim() || supportCategory);
      formData.append('category', supportCategory);
      formData.append('message', supportIssue.trim());
      if (supportEvidenceImage) formData.append('attachment', supportEvidenceImage);
      const res = await fetch(`${API_BASE_URL}/support/tickets`, {
        method: 'POST',
        headers: {
          ...(user?.access_token || user?.accessToken || user?.token
            ? { Authorization: `Bearer ${user.access_token || user.accessToken || user.token}` }
            : {}),
        },
        body: formData
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setSupportSubject('');
        setSupportIssue('');
        setSupportCategory('General Inquiry');
        setSupportEvidenceImage(null);
        setSupportMsg(`Your support ticket ${data.ticket_reference || ''} has been submitted to the Admin! 🎉`);
        notifySuccess(studentToast('supportSubmitted'), 'student-support-submit');
        setTimeout(() => setShowSupportModal(false), 2000);
      } else {
        setSupportMsg('Failed to submit support ticket.');
        const data = await res.json().catch(() => ({}));
        notifyError(data, 'student-support-submit');
      }
    } catch (err) {
      setSupportMsg('Connection error. Please try again.');
      notifyError(err, 'student-support-submit');
    }
  };

  const handleAvatarUploadSubmit = async (e) => {
    e.preventDefault();
    if (!avatarFile) {
      setAvatarUploadMessage('Please choose an image file first.');
      return;
    }

    setAvatarUploading(true);
    setAvatarUploadMessage('');

    const formData = new FormData();
    formData.append('student_id', user.studentId);
    formData.append('image', avatarFile);

    try {
      const res = await fetch(`${API_BASE_URL}/api/student/upload-avatar`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        setAvatarUploadMessage(errorBody?.detail || 'Upload failed. Please try again.');
        notifyError(errorBody || new Error('Upload failed. Please try again.'), 'student-avatar-upload');
        return;
      }

      // Read the returned JSON and update the avatar URL with a cache-busting timestamp
      const data = await res.json().catch(() => null);
      const returnedUrl = data?.imageUrl || data?.url || '';
      if (returnedUrl) {
        const sep = returnedUrl.includes('?') ? '&' : '?';
        const urlWithTs = `${returnedUrl}${sep}t=${new Date().getTime()}`;
        setAvatarUrl(urlWithTs);

        if (onUserUpdate) {
          onUserUpdate((currentUser) => {
            const updatedUser = { ...(currentUser || user), avatarUrl: urlWithTs };

            if (typeof window !== 'undefined') {
              const saved = window.localStorage.getItem('campaceSession');
              const session = saved ? JSON.parse(saved) : {};
              window.localStorage.setItem('campaceSession', JSON.stringify({
                ...session,
                user: updatedUser,
              }));
            }

            return updatedUser;
          });
        }
      }
      setAvatarUploadMessage('Avatar uploaded successfully.');
      notifySuccess(studentToast('avatarUploaded'), 'student-avatar-upload');
    } catch (err) {
      console.error('Avatar upload error:', err);
      setAvatarUploadMessage('Upload failed. Please try again.');
      notifyError(err, 'student-avatar-upload');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleProfileFieldChange = (field, value) => {
    setProfileForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'college' ? { department: '' } : {})
    }));
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileMessage('');

    if (!/^0\d{9}$/.test(profileForm.phone)) {
      setProfileMessage('Please enter a valid phone number (e.g., 0962714305).');
      return;
    }

    const token = user?.access_token || '';
    if (!token) {
      setProfileMessage('Your authenticated session is missing. Please sign in again.');
      return;
    }

    setProfileSaving(true);

    try {
      const payload = {
        student_id: profileForm.studentId,
        name: profileForm.name,
        phone: profileForm.phone,
        college: profileForm.college,
        department: profileForm.department,
      };

      const res = await fetch(`${API_BASE_URL}/api/student/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to save profile.');
      }

      const updatedUser = {
        ...user,
        ...data.user,
        access_token: data.access_token || user.access_token,
        name: data.user.name,
        studentId: data.user.studentId,
        student_id: data.user.student_id || data.user.studentId,
        phone: data.user.phone,
        college: data.user.college,
        department: data.user.department,
      };

      setProfileForm((previous) => ({ ...previous, studentId: data.user.studentId || previous.studentId }));
      onUserUpdate(updatedUser);
      setProfileMessage('Profile updated successfully.');
      notifySuccess(studentToast('profileSaved'), 'student-profile-save');

      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem('campaceSession');
        const session = saved ? JSON.parse(saved) : {};
        window.localStorage.setItem('campaceSession', JSON.stringify({
          ...session,
          user: updatedUser,
        }));
      }
    } catch (err) {
      console.error('Profile update failed:', err);
      setProfileMessage(err.message || 'Could not save profile.');
      notifyError(err, 'student-profile-save');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSearchSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    await fetchProducts({
      search: searchQuery,
      category: searchCategory,
      subcategory: searchSubcategory,
      limit: BUYER_HUB_PAGE_SIZE,
    });
    setBuyerTab('search');
  };

  const handleAddToWishlist = async (productId) => {
    setWishlistMessage('');
    setCartMessage('');

    const effectiveStudentId = getEffectiveStudentId();
    if (!effectiveStudentId) {
      setWishlistMessage('Student identity is unavailable. Please log in again.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/student/wishlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getStudentSessionToken()}`,
        },
        body: JSON.stringify({
          student_id: user?.studentId || user?.student_id || effectiveStudentId,
          product_id: parseInt(productId, 10)
        })
      });

      if (!res.ok) {
        const message = translateProductOwnershipError(await getErrorString(res));
        setWishlistMessage(message);
        notifyError({ detail: message }, `student-wishlist-add-${productId}`);
        return;
      }

      const data = await res.json().catch(() => ({}));
      const baseProduct =
        searchResults.find((item) => String(item.id) === String(productId)) ||
        recommendedProducts.find((item) => String(item.id) === String(productId)) ||
        null;

      const newWishlistItem = {
        id: data.id ?? Date.now(),
        student_id: effectiveStudentId,
        product_id: productId,
        created_at: data.created_at ?? new Date().toISOString(),
        title: baseProduct?.title || 'Product',
        price: baseProduct?.price ?? 0,
        description: baseProduct?.description || '',
        image: baseProduct?.image || '',
        category: baseProduct?.category || '',
        subcategory: baseProduct?.subcategory || '',
        seller: baseProduct?.seller || '',
        status: baseProduct?.status || 'Active',
      };

      setWishlist((prev) => {
        const alreadyExists = prev.some((item) => String(item.product_id ?? item.id) === String(productId));
        return alreadyExists ? prev : [...prev, newWishlistItem];
      });
      setWishlistBadgeCount((prev) => Math.max(prev, wishlist.length + 1));
      setWishlistMessage('Added to wishlist.');
      notifySuccess(studentToast('wishlistAdded'), `student-wishlist-add-${productId}`);
      setBuyerTab('wishlist');
    } catch (err) {
      console.error('Error adding to wishlist:', err);
      setWishlistMessage('Connection error. Please try again.');
      notifyError(err, `student-wishlist-add-${productId}`);
    }
  };

  const handleAddToCartFromSearch = async (productId) => {
    setCartMessage('');
    setWishlistMessage('');

    const safePayload = getSafeCartPayload(productId);
    if (!safePayload.student_id) {
      setCartMessage('Student identity is unavailable. Please log in again.');
      return;
    }
    if (safePayload.product_id === null || !Number.isFinite(safePayload.product_id)) {
      setCartMessage('Invalid product selection. Please try again.');
      return;
    }

    const productKey = String(safePayload.product_id);
    if (cartAddInFlightRef.current.has(productKey)) return;
    if (cart.some((item) => String(item.product_id) === productKey)) return;

    const selectedProduct = searchResults.find((item) => String(item.id) === String(safePayload.product_id));
    const availableStock = Number(selectedProduct?.stock);
    const existingCartQuantity = Number(cart.find((item) => String(item.product_id) === productKey)?.quantity || 0);
    if (Number.isFinite(availableStock) && availableStock <= existingCartQuantity) {
      setCartMessage(`Only ${availableStock} available. Your cart already has ${existingCartQuantity}.`);
      return;
    }

    cartAddInFlightRef.current.add(productKey);
    setAddingCartProductIds((previous) => [...previous, productKey]);
    try {
      const res = await fetch(`${API_BASE_URL}/api/student/cart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getStudentSessionToken()}`,
        },
        body: JSON.stringify(safePayload)
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const nextWishlistCount = Number(data.wishlist_count ?? data.wishlist_item_count ?? wishlistCount);
        setWishlistBadgeCount(Number.isFinite(nextWishlistCount) ? nextWishlistCount : wishlistCount);
        if (data.moved_from_wishlist) {
          setWishlist((previous) => previous.filter(
            (item) => String(item.product_id ?? item.id) !== productKey,
          ));
        }
        setCart((previous) => [
          ...previous.filter((item) => String(item.product_id) !== productKey),
          {
            ...selectedProduct,
            ...data.item,
            product_id: data.item?.product_id ?? safePayload.product_id,
            quantity: data.item?.quantity ?? 1,
          },
        ]);
        setCartMessage('Added to cart.');
        notifySuccess(studentToast('cartAdded'), `student-cart-add-${safePayload.product_id}`);
      } else {
        const message = translateProductOwnershipError(await getErrorString(res));
        setCartMessage(message);
        notifyError({ detail: message }, `student-cart-add-${safePayload.product_id}`);
      }
    } catch (err) {
      console.error('Error adding to cart:', err);
      setCartMessage('Connection error. Please try again.');
      notifyError(err, `student-cart-add-${safePayload.product_id}`);
    } finally {
      cartAddInFlightRef.current.delete(productKey);
      setAddingCartProductIds((previous) => previous.filter((id) => id !== productKey));
    }
  };

  const handleRemoveFromWishlist = async (itemId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/student/wishlist/${itemId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setWishlist((prev) => prev.filter((item) => item.id !== itemId));
        notifySuccess(studentToast('wishlistRemoved'), `student-wishlist-remove-${itemId}`);
      } else {
        notifyError(await getErrorString(res), `student-wishlist-remove-${itemId}`);
      }
    } catch (err) {
      console.error('Error removing wishlist item:', err);
      notifyError(err, `student-wishlist-remove-${itemId}`);
    }
  };

  const handleRemoveFromCart = async (itemId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/student/cart/${itemId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setCart((prev) => prev.filter((item) => item.id !== itemId));
        notifySuccess(studentToast('cartRemoved'), `student-cart-remove-${itemId}`);
      } else {
        notifyError(await getErrorString(res), `student-cart-remove-${itemId}`);
      }
    } catch (err) {
      console.error('Error removing cart item:', err);
      notifyError(err, `student-cart-remove-${itemId}`);
    }
  };

  const handleUpdateCartQuantity = async (itemId, quantity) => {
    const nextQuantity = Number(quantity);
    if (!Number.isInteger(nextQuantity) || nextQuantity < 1) return;
    try {
      const session = JSON.parse(window.localStorage.getItem('campaceSession') || '{}');
      const token = session.access_token || session.user?.access_token || '';
      const response = await fetch(`${API_BASE_URL}/api/student/cart/${itemId}/quantity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ quantity: nextQuantity }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCartMessage(data.detail || 'Unable to update cart quantity.');
        return;
      }
      setCart((previous) => previous.map((item) => item.id === itemId ? { ...item, quantity: data.item?.quantity ?? nextQuantity } : item));
      setCartMessage('Cart quantity updated.');
      notifySuccess(studentToast('cartUpdated'), `student-cart-update-${itemId}`);
    } catch (error) {
      setCartMessage('Connection error. Please try again.');
      notifyError(error, `student-cart-update-${itemId}`);
    }
  };

  const handleSubmitReview = async (orderIdOverride = reviewOrderId) => {
    const targetOrderId = Number(orderIdOverride ?? reviewOrderId);
    if (!targetOrderId || !reviewComment.trim()) {
      setReviewFeedback('Please choose an order and add a comment.');
      return;
    }
    if (isSubmittingReview) return;

    setIsSubmittingReview(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/student/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: user?.studentId || user?.student_id || getEffectiveStudentId(),
          order_id: targetOrderId,
          rating: reviewRating,
          comment: reviewComment,
        }),
      });
      if (res.ok) {
        setReviewFeedback('Review submitted. Thank you!');
        notifySuccess(studentToast('reviewSubmitted'), `student-review-${targetOrderId}`);
        setOrders((prev) => prev.map((order) => order.id === targetOrderId ? { ...order, reviewed: true, payment_status: 'Successful' } : order));
        setReviewOrderId(null);
        setReviewComment('');
        setReviewRating(5);
      } else {
        const message = await getErrorString(res);
        setReviewFeedback(message);
        notifyError(message, `student-review-${targetOrderId}`);
      }
    } catch (err) {
      console.error('Error submitting review:', err);
      setReviewFeedback('Connection error. Please try again.');
      notifyError(err, `student-review-${targetOrderId}`);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleSubmitDispute = async (event) => {
    event.preventDefault();
    const targetOrderId = Number(disputeOrderId);
    const reason = disputeReason.trim();
    const description = disputeDescription.trim();
    if (!targetOrderId || !reason || !description || isSubmittingDispute) return;

    const currentOrder = orders.find((order) => Number(order.id) === targetOrderId);
    if (!isDisputeEligibleOrder(currentOrder)) {
      const message = 'You can report a problem within 24 hours after payment is completed.';
      setDisputeFeedback(message);
      notifyInfo(message);
      return;
    }

    setIsSubmittingDispute(true);
    setDisputeFeedback('');
    try {
      const token = user?.access_token || user?.accessToken || '';
      const formData = new FormData();
      formData.append('reason', reason);
      formData.append('description', description);
      (disputeEvidenceFiles || []).forEach((file) => {
        formData.append('evidence_images', file);
      });

      const response = await fetch(`${API_BASE_URL}/api/student/orders/${targetOrderId}/dispute`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const message = await getErrorString(response);
        setDisputeFeedback(message);
        notifyError(message, `student-dispute-${targetOrderId}`);
        return;
      }
      const result = await response.json().catch(() => ({}));

      setOrders((previous) => previous.map((order) => (
        Number(order.id) === targetOrderId
          ? { ...order, status: 'Disputed', fulfillment_status: 'Disputed', dispute_reason: reason, dispute_status: 'OPEN', dispute: result.dispute }
          : order
      )));
      await fetchOrderDetails(targetOrderId);
      setDisputeOrderId(null);
      setDisputeReason('');
      setDisputeDescription('');
      setDisputeEvidenceFiles([]);
      setDisputeFeedback('Dispute submitted. Status: Open.');
      notifySuccess(studentToast('disputeSubmitted'), `student-dispute-${targetOrderId}`);
    } catch (error) {
      console.error('Error raising dispute:', error);
      setDisputeFeedback('Connection error. Please try again.');
      notifyError(error, `student-dispute-${targetOrderId}`);
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  function markConversationRead(partnerId) {
    const normalizedPartnerId = String(partnerId || '').trim().replace(/^conv-/, '');
    if (!normalizedPartnerId || !user?.studentId) return;

    const remainingUnread = conversationsList.reduce((total, conversation) => {
      const conversationPartnerId = String(
        conversation.studentId
        || conversation.student_id
        || String(conversation.id || '').replace(/^conv-/, '')
      );
      return conversationPartnerId === normalizedPartnerId
        ? total
        : total + Number(conversation.unread || 0);
    }, 0);

    setConversationsList((previousConversations) => previousConversations.map((conversation) => {
      const conversationPartnerId = String(
        conversation.studentId
        || conversation.student_id
        || String(conversation.id || '').replace(/^conv-/, '')
      );
      return conversationPartnerId === normalizedPartnerId
        ? { ...conversation, unread: 0 }
        : conversation;
    }));
    setUnreadCount(remainingUnread);
    setUnreadMessageCount(remainingUnread);

    const token = getStudentSessionToken();
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/student/messages/mark-read`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sender_id: normalizedPartnerId }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to mark conversation as read.');
        }
      } catch (error) {
        console.error('Error marking student conversation as read:', error);
      }
    })();

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'mark_read',
        sender_id: normalizedPartnerId,
      }));
    }
  }
  markConversationReadRef.current = markConversationRead;

  function selectConversation(conversationId) {
    const selectedConversation = conversationsList.find(
      (conversation) => conversation.id === conversationId
    );
    markConversationRead(
      selectedConversation?.studentId
      || String(conversationId || '').replace(/^conv-/, '')
    );
    const url = new URL(window.location.href);
    const currentConversationId = url.searchParams.get('conversation');
    url.searchParams.set('conversation', conversationId);
    const historyState = { ...window.history.state, dashboardConversation: conversationId };
    if (currentConversationId) {
      window.history.replaceState(historyState, '', url);
    } else {
      window.history.pushState(historyState, '', url);
    }
    shouldAutoScrollRef.current = true;
    setActiveConversationId(conversationId);
    setMobileChatView('chat');
  }

  const openSellerOrder = (orderId) => {
    const listUrl = new URL(window.location.href);
    listUrl.searchParams.set('tab', 'seller');
    listUrl.searchParams.set('section', 'orders');
    listUrl.searchParams.delete('order');
    const listHistoryState = { ...window.history.state };
    delete listHistoryState.dashboardOrderId;
    window.history.replaceState(
      listHistoryState,
      '',
      `${listUrl.pathname}${listUrl.search}${listUrl.hash}`,
    );
    setActiveTab('seller');
    setPendingSellerOrderId(Number(orderId));
    updateOrderDashboardUrl(orderId, 'seller');
  };

  const backToSellerOrders = () => {
    setPendingSellerOrderId(null);
    setActiveTab('seller');
    if (window.history.state?.dashboardOrderId) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'seller');
    url.searchParams.set('section', 'orders');
    url.searchParams.delete('order');
    window.history.replaceState(window.history.state, '', url);
  };

  const openSellerChat = (conversationId, buyer = {}) => {
    const partnerId = String(conversationId || '').replace(/^conv-/, '');
    markConversationRead(partnerId);
    sellerChatParticipantsRef.current[conversationId] = buyer;
    setConversationsList((previous) => (
      previous.some((conversation) => conversation.id === conversationId)
        ? previous
        : [...previous, {
          id: conversationId,
          studentId: partnerId,
          name: buyer.name || 'Student',
          department: buyer.department || '',
          unread: 0,
          messages: [],
        }]
    ));
    const url = new URL(window.location.href);
    url.searchParams.delete('order');
    url.searchParams.delete('section');
    url.searchParams.set('tab', 'messages');
    url.searchParams.set('conversation', conversationId);
    window.history.pushState(
      { ...window.history.state, dashboardConversation: conversationId },
      '',
      url,
    );
    shouldAutoScrollRef.current = true;
    setActiveConversationId(conversationId);
    setMobileChatView('chat');
    setActiveTab('messages');
  };

  function showConversationList() {
    setMobileChatView('list');
    if (!getConversationIdFromUrl()) return;
    if (window.history.state?.dashboardConversation) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('conversation');
    window.history.replaceState(window.history.state, '', url);
  }

  const handleChatInitiate = (sellerId, sellerName) => {
    const normalizedSellerId = String(sellerId || '').trim();
    if (!normalizedSellerId) return;

    const existingConversation = conversationsList.find((conversation) => (
      String(conversation.studentId || conversation.student_id || '').trim() === normalizedSellerId
    ));
    if (existingConversation) {
      selectConversation(existingConversation.id);
    } else {
      const newConversation = {
        id: `conv-${normalizedSellerId}`,
        studentId: normalizedSellerId,
        name: sellerName || normalizedSellerId,
        status: 'offline',
        unread: 0,
        lastMessage: 'Start a conversation with this seller.',
        timestamp: 'now',
        product: null,
        messages: [],
      };
      setConversationsList((previousConversations) => [newConversation, ...previousConversations]);
      selectConversation(newConversation.id);
      setActiveChatMessages([]);
    }
    setActiveTab('messages');
  };

  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    setDepositError('');
    const amount = Number(depositAmount);

    if (!amount || amount <= 0) {
      setDepositError('Please enter a valid deposit amount.');
      return;
    }

    if (amount > 1000000) {
      setDepositError('Amount cannot exceed 1,000,000 ETB.');
      return;
    }

    if (!user?.studentId) {
      setDepositError('Student ID is missing. Please log in again.');
      return;
    }

    setDepositLoading(true);
    try {
      const payload = {
        student_id: user.studentId,
        amount
      };

      if (user.email) {
        payload.email = user.email;
      }

      const res = await fetch(`${API_BASE_URL}/api/payment/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getStudentSessionToken() ? { Authorization: 'Bearer ' + getStudentSessionToken() } : {}),
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        const responseDetail = data?.detail;
        const detail = typeof responseDetail === 'string'
          ? responseDetail
          : responseDetail?.message;
        const correlationId = responseDetail?.correlation_id;
        const message = detail || 'Payment service is temporarily unavailable. Please try again shortly.';
        const error = new Error(
          correlationId ? `${message} (Reference: ${correlationId})` : message
        );
        error.status = res.status;
        error.code = responseDetail?.code;
        error.correlationId = correlationId;
        throw error;
      }

      if (data.checkout_url) {
        notifyInfo('Wallet top-up is awaiting Chapa confirmation.', 'student-payment-initialize');
        window.location.href = data.checkout_url;
        return;
      }

      if (data.transaction_id) {
        setDepositError(data.message || 'A matching deposit is already being processed.');
        return;
      }

      throw new Error('No checkout URL returned from payment gateway.');
    } catch (err) {
      console.error('Deposit initialization failed:', err);
      setDepositError(getErrorMessage(err));
    } finally {
      setDepositLoading(false);
    }
  };

  const handleWithdrawSubmit = async (e, payoutAccountOverride = payoutAccount) => {
    e.preventDefault();
    if (withdrawSubmitInFlightRef.current) return;
    setWithdrawError('');
    setWithdrawAttemptsLeft(null);
    setWithdrawRetryAfterSeconds(null);
    const amount = Number(withdrawAmount);

    if (!amount || amount < 100) {
      setWithdrawError('Withdrawal amount must be at least 100 ETB.');
      return;
    }

    if (amount > Number(currentWalletBalance || 0)) {
      setWithdrawError('Withdrawal amount cannot exceed your current wallet balance.');
      return;
    }

    if (withdrawProviderUnavailable && payoutAccountOverride?.id) {
      setWithdrawError(`${payoutAccountOverride.provider_name || 'This payout provider'} is temporarily unavailable for withdrawals. Please update your payout method to continue.`);
      return;
    }

    if (activeWithdrawal) {
      setWithdrawError('You have a payout currently processing. You can request a new withdrawal once it completes.');
      return;
    }

    if (!user?.studentId) {
      setWithdrawError('Student ID is missing. Please log in again.');
      return;
    }
    if (!/^\d{4}$/.test(withdrawPin)) {
      setWithdrawError('Enter your 4-digit Wallet PIN to authorize this withdrawal.');
      return;
    }

    // Guard synchronously: React's disabled-state render may not occur before
    // a rapid second submit event reaches this handler.
    withdrawSubmitInFlightRef.current = true;
    setWithdrawLoading(true);
    try {
      const idempotencyKey = withdrawIdempotencyKeyRef.current
        || window.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      withdrawIdempotencyKeyRef.current = idempotencyKey;
      const payload = {
        amount,
        payout_account_id: payoutAccountOverride?.id || null,
        pin: withdrawPin,
      };

      const token = getStudentSessionToken();
      const res = await fetch(`${API_BASE_URL}/api/student/wallet/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data?.detail?.code === 'PAYOUT_ACCOUNT_REQUIRED') {
          setPayoutSetupOpen(true);
          setPayoutSetupError('');
          return;
        }
        if (Number.isInteger(data?.detail?.attempts_left)) {
          setWithdrawAttemptsLeft(data.detail.attempts_left);
        }
        if (Number.isFinite(data?.detail?.retry_after_seconds)) {
          setWithdrawRetryAfterSeconds(data.detail.retry_after_seconds);
        }
        if (res.status === 503) {
          setWithdrawProviderUnavailable(true);
          throw new Error(`${payoutAccountOverride?.provider_name || 'This payout provider'} is temporarily unavailable for withdrawals. Please update your payout method to continue.`);
        }
        const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
        throw new Error(getErrorMessage({ detail: detail || data?.message }));
      }

      if (data?.success !== true || data?.persisted !== true || !data?.transaction_id) {
        throw new Error(data?.detail || data?.message || 'The server did not confirm that the withdrawal was saved.');
      }

      // Confirm the committed ledger row and balance from the read endpoint;
      // do not close the form or report success from an optimistic response.
      const confirmationResponse = await fetch(
        `${API_BASE_URL}/api/student/payments?student_id=${encodeURIComponent(studentId)}`,
        { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const confirmationData = await confirmationResponse.json().catch(() => ({}));
      if (!confirmationResponse.ok) {
        throw new Error(confirmationData?.detail || 'Unable to confirm the saved withdrawal.');
      }
      const confirmedBalance = Number(confirmationData?.balance);
      const committedTransaction = Array.isArray(confirmationData?.transactions)
        ? confirmationData.transactions.find((transaction) => transaction?.hash === data.transaction_id)
        : null;
      const responseBalance = Number(data.wallet_balance);
      if (!committedTransaction || !Number.isFinite(confirmedBalance) || !Number.isFinite(responseBalance)
        || Math.abs(confirmedBalance - responseBalance) >= 0.01) {
        throw new Error('The withdrawal could not be verified in the wallet ledger. Please refresh before trying again.');
      }

      withdrawIdempotencyKeyRef.current = null;
      walletBalanceRef.current = confirmedBalance;
      setWalletBalance(confirmedBalance);
      setPaymentInfo((previousPaymentInfo) => ({
        ...previousPaymentInfo,
        balance: confirmedBalance,
        heldBalance: Number(confirmationData?.held_balance || 0),
        recentTx: data.message || 'Withdrawal request recorded.',
        transactions: confirmationData.transactions,
      }));
      await fetchBuyerDashboardData();
      setShowWithdrawModal(false);
      setWithdrawAmount('');
      setWithdrawPin('');
      if (String(data.status || '').toLowerCase() === 'successful') {
        notifySuccess(studentToast('withdrawalSubmitted'), 'student-withdrawal-submit');
      } else {
        notifyInfo(data.message || 'Withdrawal request recorded and awaiting payout confirmation.', 'student-withdrawal-submit');
      }
    } catch (err) {
      console.error('Withdrawal failed:', err);
      setWithdrawError(getErrorMessage(err));
      notifyError(err, 'student-withdrawal-submit');
    } finally {
      setWithdrawPin('');
      withdrawSubmitInFlightRef.current = false;
      setWithdrawLoading(false);
    }
  };

  const refreshWithdrawalStatus = async () => {
    const token = getStudentSessionToken();
    if (!token) return;
    setWithdrawalStatusLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/wallet/withdrawals/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Unable to refresh payout status.');
      setActiveWithdrawal(data?.active_payout || null);
      setWithdrawError(data?.active_payout?.status === 'pending_approval'
        ? 'Your withdrawal is held while an administrator approves it. You can request another withdrawal after it is resolved.'
        : data?.active_payout
          ? 'You have a payout currently processing. You can request a new withdrawal once it completes.'
          : '');
    } catch (error) {
      console.error('Payout status refresh failed:', error);
      setWithdrawError(error.message || 'Unable to refresh payout status.');
    } finally {
      setWithdrawalStatusLoading(false);
    }
  };

  const handlePayoutStatusCheck = async (transaction) => {
    setPayoutStatusCheckId(transaction.id || transaction.hash);
    try {
      await refreshWithdrawalStatus();
      await fetchBuyerDashboardData();
    } finally {
      setPayoutStatusCheckId(null);
    }
  };

  const verifyDepositByReference = async (transactionReference, isActive = () => true) => {
    const token = getStudentSessionToken();
    const response = await fetch(
      `${API_BASE_URL}/api/payment/verify/${encodeURIComponent(transactionReference)}`,
      { headers: token ? { Authorization: 'Bearer ' + token } : {} },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
      throw new Error(getErrorMessage({ detail }));
    }

    const normalizedStatus = String(data?.status || '').trim().toLowerCase();
    const status = ['successful', 'success', 'completed'].includes(normalizedStatus)
      ? 'successful'
      : normalizedStatus.includes('fail')
        ? 'failed'
        : 'pending';

    if (status === 'successful' && isActive()) {
      const verifiedBalance = Number(data?.wallet_balance ?? data?.walletBalance ?? data?.balance);
      setPaymentInfo((previousPaymentInfo) => ({
        ...previousPaymentInfo,
        balance: Number.isFinite(verifiedBalance) ? verifiedBalance : previousPaymentInfo.balance,
        transactions: (Array.isArray(previousPaymentInfo.transactions) ? previousPaymentInfo.transactions : [])
          .map((transaction) => [transaction?.hash, transaction?.tx_ref, transaction?.reference]
            .some((reference) => String(reference || '') === transactionReference)
            ? { ...transaction, status: 'Successful' }
            : transaction),
      }));
      if (Number.isFinite(verifiedBalance)) {
        walletBalanceRef.current = verifiedBalance;
        setWalletBalance(verifiedBalance);
        if (onUserUpdate) {
          onUserUpdate((currentUser) => currentUser
            ? { ...currentUser, wallet_balance: verifiedBalance }
            : currentUser);
        }
      }
      notifySuccess(
        'Deposit confirmed! Your wallet balance has been updated.',
        `student-deposit-confirmed-${transactionReference}`,
      );
    }

    return { status, data };
  };
  depositVerificationHandlerRef.current = verifyDepositByReference;

  const handleDepositStatusCheck = async (transaction) => {
    setPayoutStatusCheckId(transaction.id || transaction.hash);
    try {
      const token = getStudentSessionToken();
      const response = await fetch(`${API_BASE_URL}/api/payment/verify/${encodeURIComponent(transaction.hash)}`, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
        throw new Error(getErrorMessage({ detail }));
      }
      await fetchBuyerDashboardData();
      setWithdrawError(data?.status === 'Successful'
        ? `${transaction.amount || 0} ETB deposit confirmed and added to your wallet.`
        : 'Chapa has not confirmed this deposit yet.');
      if (String(data?.status || '').toLowerCase() === 'successful') {
        notifySuccess(studentToast('paymentVerified'), `student-payment-check-${transaction.hash}`);
      } else {
        notifyInfo(studentToast('paymentPending'), `student-payment-check-${transaction.hash}`);
      }
    } catch (error) {
      console.error('Deposit status check failed:', error);
      setWithdrawError(getErrorMessage(error));
      notifyError(error, `student-payment-check-${transaction.hash}`);
    } finally {
      setPayoutStatusCheckId(null);
    }
  };

  useEffect(() => {
    const transactions = Array.isArray(paymentInfo?.transactions) ? paymentInfo.transactions : [];
    const recentPendingDeposits = transactions.filter((transaction) => {
      const transactionId = String(transaction?.hash || transaction?.tx_ref || '');
      const transactionDescription = `${transaction?.type || ''} ${transaction?.label || ''}`.toLowerCase();
      const status = String(transaction?.status || '').trim().toLowerCase();
      const createdAtValue = String(transaction?.created_at || '');
      const createdAt = Date.parse(
        createdAtValue && !/(Z|[+-]\d{2}:?\d{2})$/i.test(createdAtValue)
          ? `${createdAtValue}Z`
          : createdAtValue,
      );
      const age = Date.now() - createdAt;
      return transactionId
        && transactionDescription.includes('deposit')
        && ['pending', 'processing'].includes(status)
        && Number.isFinite(createdAt)
        && age >= 0
        && age <= 5 * 60 * 1000
        && !depositAutoChecksRef.current.has(transactionId);
    });

    recentPendingDeposits.forEach((transaction) => {
      const transactionId = String(transaction.hash || transaction.tx_ref);
      depositAutoChecksRef.current.add(transactionId);
      let isActive = true;
      let timeoutId;
      const stopCheck = () => {
        isActive = false;
        window.clearTimeout(timeoutId);
        depositAutoChecksRef.current.delete(transactionId);
      };
      depositAutoCheckCleanupRef.current.add(stopCheck);
      const checkStatus = async () => {
        try {
          for (let attempt = 0; isActive && attempt < 5; attempt += 1) {
            try {
              const result = await depositVerificationHandlerRef.current(transactionId, () => isActive);
              if (result.status !== 'pending') return;
            } catch (error) {
              console.error('Automatic deposit verification failed:', error);
            }
            if (attempt < 4 && isActive) {
              await new Promise((resolve) => {
                timeoutId = window.setTimeout(resolve, 4000);
              });
            }
          }
        } finally {
          depositAutoCheckCleanupRef.current.delete(stopCheck);
        }
      };
      void checkStatus();
    });
  }, [paymentInfo?.transactions]);

  useEffect(() => () => {
    depositAutoCheckCleanupRef.current.forEach((stopCheck) => stopCheck());
    depositAutoCheckCleanupRef.current.clear();
  }, []);

  const refreshPayoutAccount = async () => {
    const token = getStudentSessionToken();
    if (!token) {
      setPayoutAccount(null);
      setWithdrawProviderUnavailable(false);
      return null;
    }

    setPayoutAccountLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/seller/payout-account`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || 'Unable to load payout account.');
      const account = data?.account || null;
      setPayoutAccount(account);
      setWithdrawProviderUnavailable(Boolean(account && account.provider_is_available === false));
      setWithdrawError(account?.provider_is_available === false
        ? `${account.provider_name || 'This payout provider'} is temporarily unavailable for withdrawals. Please update your payout method to continue.`
        : '');
      return account;
    } catch (error) {
      setPayoutAccount(null);
      setWithdrawProviderUnavailable(false);
      console.error('Payout account fetch failed:', error);
      return null;
    } finally {
      setPayoutAccountLoading(false);
    }
  };

  useEffect(() => {
    if (!showWithdrawModal || !payoutSetupOpen || payoutAccount || payoutSetupBanks.length) return undefined;
    const controller = new AbortController();
    setPayoutSetupBanksLoading(true);
    setPayoutSetupBanksError('');
    fetch(`${API_BASE_URL}/api/banks`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
          throw new Error(getErrorMessage({ detail }));
        }
        const banks = Array.isArray(data) ? data : data?.banks;
        if (!Array.isArray(banks)) throw new Error(t('walletPayout.setupLoadError'));
        setPayoutSetupBanks(banks);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setPayoutSetupBanksError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPayoutSetupBanksLoading(false);
      });
    return () => controller.abort();
  }, [payoutAccount, payoutSetupBanks.length, payoutSetupOpen, payoutSetupRetryCount, showWithdrawModal, t]);

  const visiblePayoutSetupProviders = getEssentialPayoutProviders(payoutSetupBanks, payoutSetupType);
  const payoutSetupNameNeedsAcknowledgement = payoutNameNeedsAcknowledgement(
    payoutSetupAccountName,
    user?.full_name || user?.fullName || user?.name,
  );
  const payoutSetupValid = visiblePayoutSetupProviders.some((bank) => bank.code === payoutSetupBankCode)
    && isPayoutSetupValid({
      payoutType: payoutSetupType,
      providerCode: payoutSetupBankCode,
      holderName: payoutSetupAccountName,
      expectedHolderName: user?.full_name || user?.fullName || user?.name,
      accountNumber: payoutSetupAccountNumber,
      nameMismatchAcknowledged: payoutSetupNameMismatchAcknowledged,
    });

  const handlePayoutSetupSubmit = async () => {
    if (payoutSetupInFlightRef.current) return;
    payoutSetupInFlightRef.current = true;
    setPayoutSetupLoading(true);
    setPayoutSetupError('');
    try {
      const token = getStudentSessionToken();
      if (!token) throw new Error(t('walletPayout.authRequired'));
      if (!verifiedStudent) throw new Error(t('walletPayout.verifiedRequired'));
      const registeredName = String(user?.full_name || user?.fullName || user?.name || '').trim();
      const businessName = String(
        user?.business_name
        || user?.businessName
        || user?.shop_name
        || user?.shopName
        || user?.store_name
        || user?.storeName
        || registeredName,
      ).trim();
      const accountName = payoutSetupAccountName.trim() || registeredName;
      if (!payoutSetupBankCode || !accountName || !payoutSetupAccountNumber.trim()) {
        throw new Error(t('walletPayout.setupFieldsRequired'));
      }
      if (!isValidPayoutAccountNumber(payoutSetupType, payoutSetupBankCode, payoutSetupAccountNumber)) {
        throw new Error(payoutSetupType === 'mobile_wallet'
          ? t('walletPayout.mobileNumberInvalid')
          : t('walletPayout.accountNumberInvalid'));
      }

      const response = await fetch(`${API_BASE_URL}/api/student/seller/setup-payout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_name: businessName,
          payout_type: payoutSetupType,
          bank_code: payoutSetupBankCode,
          account_name: accountName,
          account_number: payoutSetupAccountNumber.trim(),
          name_mismatch_acknowledged: payoutSetupNameNeedsAcknowledgement && payoutSetupNameMismatchAcknowledged,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
        throw new Error(getErrorMessage({ detail }));
      }

      const account = data?.account;
      if (!account?.id) throw new Error(t('walletPayout.setupFailed'));
      setPayoutAccount(account);
      setWithdrawProviderUnavailable(account.provider_is_available === false);
      setPayoutSetupAccountNumber('');
      setPayoutSetupOpen(false);
      notifySuccess(data.message || t('studentToast.payoutAccountSaved'), 'student-payout-account-setup');
      await handleWithdrawSubmit({ preventDefault: () => { } }, account);
    } catch (error) {
      setPayoutSetupError(getErrorMessage(error));
      notifyError(error, 'student-payout-account-setup');
    } finally {
      payoutSetupInFlightRef.current = false;
      setPayoutSetupLoading(false);
    }
  };

  const handlePayoutAccountUpdated = async () => {
    const account = await refreshPayoutAccount();
    if (returnToWithdrawAfterPayoutSetup && account) {
      setReturnToWithdrawAfterPayoutSetup(false);
      setShowWithdrawModal(true);
    }
  };

  useEffect(() => {
    if (!showWithdrawModal) return undefined;
    refreshPayoutAccount();
    refreshWithdrawalStatus();
    return undefined;
    // The refresh functions are recreated on render; modal visibility and student identity scope this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWithdrawModal, user?.studentId]);

  useEffect(() => {
    if (!showDepositModal) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !depositLoading) setShowDepositModal(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [depositLoading, showDepositModal]);

  useEffect(() => {
    if (!user?.studentId) return undefined;
    refreshWithdrawalStatus();
    return undefined;
    // The student identity scopes this one-time silent refresh; the helper is recreated on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.studentId]);

  const isWishlistItemAvailable = (item) => {
    const statusValue = String(item?.status || '').trim().toLowerCase();
    return statusValue === 'approved' || statusValue === 'available';
  };

  const handleFindSimilar = (item) => {
    const query = `Find similar ${item?.category || 'campus'} items for ${item?.title || 'this product'} with a similar price range and good quality.`;
    setAiInput(query);
    setActiveTab('ai-advisor');
  };

  const handleMoveToCart = async (wishlistItemId, productId) => {
    const safePayload = getSafeCartPayload(productId);
    if (!safePayload.student_id) {
      return;
    }
    if (safePayload.product_id === null || !Number.isFinite(safePayload.product_id)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/student/cart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getStudentSessionToken()}`,
        },
        body: JSON.stringify(safePayload)
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const nextWishlistCount = Number(data.wishlist_count ?? data.wishlist_item_count ?? wishlistCount);
        setWishlistBadgeCount(Number.isFinite(nextWishlistCount) ? nextWishlistCount : wishlistCount);
        const wishlistItem = wishlist.find((item) => item.id === wishlistItemId);
        if (wishlistItem) {
          setCart((previous) => [
            ...previous.filter((item) => String(item.product_id) !== String(safePayload.product_id)),
            {
              ...wishlistItem,
              ...data.item,
              product_id: data.item?.product_id ?? safePayload.product_id,
              quantity: data.item?.quantity ?? 1,
            },
          ]);
        }

        const deleteRes = await fetch(`${API_BASE_URL}/api/student/wishlist/${wishlistItemId}`, { method: 'DELETE' });
        if (deleteRes.ok) {
          setWishlist((prev) => prev.filter((item) => item.id !== wishlistItemId));
          notifySuccess(studentToast('cartAdded'), `student-move-to-cart-${wishlistItemId}`);
        } else {
          notifyError(await getErrorString(deleteRes), `student-move-to-cart-${wishlistItemId}`);
        }
        setBuyerTab('cart');
      } else {
        notifyError({ detail: data.detail || data.message || 'Unable to move item to cart.' }, `student-move-to-cart-${wishlistItemId}`);
      }
    } catch (err) {
      console.error("Error moving item to cart:", err);
      notifyError(err, `student-move-to-cart-${wishlistItemId}`);
    }
  };

  const handleMoveAllToCart = async () => {
    const availableItems = wishlist.filter((item) => isWishlistItemAvailable(item));
    if (!availableItems.length) return;

    for (const item of availableItems) {
      await handleMoveToCart(item.id, item.product_id);
    }
  };

  const resetProductForm = useCallback(() => {
    setProductForm({
      name: '', title: '', category: '', subcategory: '', price: '', quantity: '1',
      condition: 'New', pickupLocation: '', pickupHours: '08:00-17:00', imageNotes: [], description: '', image: null
    });
    setEditingProduct(null);
    setExistingProductImages([]);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const actionRequested = url.searchParams.get('action') === 'create-listing'
      || url.searchParams.get('tab') === 'add_product'
      || dashboardLink?.sellerDestination === 'add_product';
    const requestReceived = openProductComposerRequest > handledComposerRequestRef.current;
    if (!actionRequested && !requestReceived) return;

    handledComposerRequestRef.current = openProductComposerRequest;
    resetProductForm();
    setShowProductModal(true);
    setDashboardMode('seller');
    setActiveSellerDestination('add_product');
    if (actionRequested) {
      url.searchParams.delete('action');
      window.history.replaceState(window.history.state, '', url);
    }
  }, [dashboardLink?.sellerDestination, openProductComposerRequest, resetProductForm]);

  const findSellerProduct = useCallback((productOrId) => {
    const productId = typeof productOrId === 'object' ? productOrId?.id : productOrId;
    return [...(sellerDashboardData?.my_listings || []), ...(myListings || [])]
      .find((item) => String(item.id) === String(productId)) ||
      (typeof productOrId === 'object' ? productOrId : null);
  }, [sellerDashboardData?.my_listings, myListings]);

  const handleEditProduct = useCallback((productOrId) => {
    const product = findSellerProduct(productOrId);
    if (!product?.id) return;
    setEditingProduct(product);
    setExistingProductImages(getProductImages(product.image));
    setProductForm({
      name: product.title || product.name || '',
      title: product.title || product.name || '',
      category: product.category || '',
      subcategory: product.subcategory || '',
      price: product.price || '',
      quantity: String(product.stock ?? product.quantity ?? 1),
      condition: product.condition || 'New',
      pickupLocation: product.pickup_location || product.pickup_point || product.handover_location || product.location || product.pickupLocation || '',
      pickupHours: product.pickup_hours || '08:00-17:00',
      imageNotes: Array.isArray(product.image_notes) ? product.image_notes : [],
      description: product.description || '',
      image: []
    });
    setProductError('');
    setProductSuccessMsg('');
    setShowProductModal(true);
  }, [findSellerProduct]);

  const lastInitialProductEditRef = useRef(null);
  useEffect(() => {
    if (!initialProductToEdit?.id || String(lastInitialProductEditRef.current) === String(initialProductToEdit.id)) return;
    lastInitialProductEditRef.current = initialProductToEdit.id;
    setActiveTab('seller');
    onTabChange?.('seller');
    handleEditProduct(initialProductToEdit);
    onInitialProductEditHandled?.();
  }, [initialProductToEdit, handleEditProduct, onInitialProductEditHandled, onTabChange]);

  const updateSellerProduct = async (productOrId, updates, imageChanges = null) => {
    const product = findSellerProduct(productOrId);
    if (!product?.id) throw new Error('The selected product could not be found.');
    const response = await fetch(`${API_BASE_URL}/api/student/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStudentSessionToken()}` },
      body: JSON.stringify({ student_id: user?.studentId || '', ...updates })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.detail || 'Could not update product.');
    }
    let updatedProduct = data.product;
    if (imageChanges) {
      const imageFormData = new FormData();
      imageFormData.append('existing_images', JSON.stringify(imageChanges.existingImages || []));
      (imageChanges.newImages || []).forEach((image) => imageFormData.append('images', image));
      const imageResponse = await fetch(`${API_BASE_URL}/api/student/products/${product.id}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getStudentSessionToken()}` },
        body: imageFormData,
      });
      const imageData = await imageResponse.json().catch(() => ({}));
      if (!imageResponse.ok) throw new Error(imageData?.detail || 'Could not update product images.');
      updatedProduct = imageData.product || updatedProduct;
    }
    if (updatedProduct) {
      setMyListings((previous) => previous.map((item) => (
        String(item.id) === String(product.id) ? { ...item, ...updatedProduct } : item
      )));
      setSellerDashboardData((previous) => ({
        ...previous,
        my_listings: (previous.my_listings || []).map((item) => (
          String(item.id) === String(product.id) ? { ...item, ...updatedProduct } : item
        )),
      }));
    }
    await fetchSellerDashboardData();
    if (updatedProduct) {
      setMyListings((previous) => previous.map((item) => (
        String(item.id) === String(product.id) ? { ...item, ...updatedProduct } : item
      )));
      setSellerDashboardData((previous) => ({
        ...previous,
        my_listings: (previous.my_listings || []).map((item) => (
          String(item.id) === String(product.id) ? { ...item, ...updatedProduct } : item
        )),
      }));
    }
    return updatedProduct;
  };

  const handleDeleteProduct = async (productOrId) => {
    const product = findSellerProduct(productOrId);
    if (!product?.id) throw new Error('The selected product could not be found.');
    try {
      const response = await fetch(`${API_BASE_URL}/api/student/products/${product.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getStudentSessionToken()}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Could not delete product.');
      setSearchResults((previous) => previous.filter((item) => String(item.id) !== String(product.id)));
      setMyListings((previous) => previous.filter((item) => String(item.id) !== String(product.id)));
      setSellerDashboardData((previous) => ({
        ...previous,
        my_listings: (previous.my_listings || []).filter((item) => String(item.id) !== String(product.id)),
      }));
      await fetchSellerDashboardData();
      setMyListings((previous) => previous.filter((item) => String(item.id) !== String(product.id)));
      setSellerDashboardData((previous) => ({
        ...previous,
        my_listings: (previous.my_listings || []).filter((item) => String(item.id) !== String(product.id)),
      }));
      return result;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Could not delete product.', { cause: error });
    }
  };

  const handleTogglePause = async (productOrId) => {
    const product = findSellerProduct(productOrId);
    if (!product?.id) throw new Error('The selected product could not be found.');
    try {
      const status = String(product.status || '').toLowerCase();
      return await updateSellerProduct(product.id, { status: status === 'paused' || status === 'sold' ? 'Approved' : 'Paused' });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Could not update product status.', { cause: error });
    }
  };

  const handleMarkAsSold = async (productOrId) => {
    const product = findSellerProduct(productOrId);
    if (!product?.id) throw new Error('The selected product could not be found.');
    try {
      return await updateSellerProduct(product.id, { status: 'Sold' });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Could not mark product as sold.', { cause: error });
    }
  };

  // 5. አዲስ ምርት (እቃ) መለጠፊያ (Post Product Handler)
  const handleAddProductSubmit = async (e) => {
    e.preventDefault();
    setProductError('');
    setProductSuccessMsg('');

    const itemName = (productForm.name || productForm.title || '').trim();
    const selectedImages = Array.isArray(productForm.image) ? productForm.image : (productForm.image ? [productForm.image] : []);
    const priceValue = Number(String(productForm.price || '').replace(/[^0-9.]/g, ''));
    const stockValue = Number(productForm.quantity);
    if (!itemName) {
      setProductError('Product title is required.');
      return;
    }
    if (!productForm.category) {
      setProductError('Category is required.');
      return;
    }
    if (!String(productForm.price || '').trim() || !Number.isFinite(priceValue) || priceValue < 0) {
      setProductError('Price must be a valid non-negative number.');
      return;
    }
    if (!Number.isInteger(stockValue) || stockValue < 0 || (!editingProduct && stockValue < 1)) {
      setProductError('Stock must be a valid non-negative whole number.');
      return;
    }
    if (!editingProduct && selectedImages.length === 0) {
      setProductError('Add at least one product image.');
      return;
    }

    if (!editingProduct && selectedImages.length > maxImagesPerProduct) {
      setProductError(`You can upload a maximum of ${maxImagesPerProduct} images per product.`);
      return;
    }

    setProductSubmitting(true);

    try {
      if (editingProduct) {
        await updateSellerProduct(editingProduct, {
          title: itemName,
          category: productForm.category,
          subcategory: productForm.subcategory || null,
          price: String(productForm.price),
          description: productForm.description || null,
          quantity: Number(productForm.quantity || 1),
          condition: productForm.condition || 'New',
          pickup_location: productForm.pickupLocation || '',
          pickup_hours: productForm.pickupHours || '08:00-17:00',
          negotiable: false,
          image_notes: productForm.imageNotes || [],
        }, {
          existingImages: existingProductImages,
          newImages: selectedImages,
        });
        setProductSuccessMsg('Product updated successfully.');
        notifySuccess(studentToast('productUpdated'), `student-product-update-${editingProduct.id}`);
        setTimeout(() => {
          setShowProductModal(false);
          setProductSuccessMsg('');
          resetProductForm();
        }, 800);
        return;
      }

      const formData = new FormData();
      formData.append('name', itemName);
      formData.append('title', String(productForm.title || productForm.name || '').trim());
      formData.append('category', productForm.category);
      formData.append('subcategory', productForm.subcategory || '');
      formData.append('price', String(productForm.price));
      formData.append('quantity', String(productForm.quantity || 1));
      formData.append('condition', productForm.condition || 'New');
      formData.append('pickup_location', productForm.pickupLocation || '');
      formData.append('pickup_hours', productForm.pickupHours || '08:00-17:00');
      formData.append('negotiable', 'false');
      formData.append('image_notes', JSON.stringify(productForm.imageNotes || []));
      formData.append('description', productForm.description || '');
      formData.append('student_id', user?.studentId || '');
      formData.append('status', 'Pending');
      selectedImages.forEach((image) => {
        formData.append('images', image);
      });

      const response = await fetch(`${API_BASE_URL}/api/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getStudentSessionToken()}` },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        setProductError(errorData?.detail || 'Could not post product.');
        return;
      }

      setProductSuccessMsg('Product submitted successfully and is awaiting admin approval.');
      notifySuccess(studentToast('productListed'), 'student-product-list');
      resetProductForm();
      await fetchSellerDashboardData();

      setTimeout(() => {
        setShowProductModal(false);
        setProductSuccessMsg('');
      }, 1800);
    } catch (err) {
      console.error('Error submitting new product:', err);
      setProductError('Connection error. Please try again.');
      notifyError(err, editingProduct ? `student-product-update-${editingProduct.id}` : 'student-product-list');
    } finally {
      setProductSubmitting(false);
    }
  };

  const handleProductImageSelect = (e) => {
    const selectedImages = Array.from(e.target.files || []);
    if (!selectedImages.length) {
      setProductForm((prev) => ({ ...prev, image: [] }));
      return;
    }

    if (existingProductImages.length + selectedImages.length > maxImagesPerProduct) {
      setProductError(`You can upload a maximum of ${maxImagesPerProduct} images per product.`);
      e.target.value = '';
      setProductForm((prev) => ({ ...prev, image: [] }));
      return;
    }

    const maxImageSizeBytes = parseImageSizeBytes(maxImageSize);
    const oversizedImage = selectedImages.find((image) => image.size > maxImageSizeBytes);
    if (oversizedImage) {
      setProductError(`Image size must not exceed ${maxImageSize}.`);
      e.target.value = '';
      setProductForm((prev) => ({ ...prev, image: [] }));
      return;
    }

    setProductError('');
    setProductForm((prev) => ({ ...prev, image: selectedImages, imageNotes: selectedImages.map((_, index) => prev.imageNotes[index] || '') }));
  };

  const parseInlineProductCards = (text) => {
    if (!text) return [];
    const regex = /\[PRODUCT:(\d+):([^\]]+):([^\]]+)\]/g;
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      const [, id, title, price] = match;
      matches.push({
        id: Number(id),
        title: title.trim(),
        price: price.trim(),
        raw: match[0],
      });
    }

    return matches;
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      aiScrollRef.current?.scrollTo({
        top: aiScrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [chatHistory, isTyping]);

  const handleAiSend = async (messageText = aiInput) => {
    const trimmed = String(messageText || '').trim();
    if (!trimmed || isTyping) return;

    setIsTyping(true);
    setChatHistory((prev) => [...prev, { role: 'user', text: trimmed }]);
    setAiInput('');
    const abortController = new AbortController();
    aiAbortControllerRef.current = abortController;

    try {
      // Send to Academic Defense AI Advisor endpoint
      const payload = {
        message: trimmed,
        student_id: user?.studentId,
        department: user?.department,
        context: 'academic_defense'
      };
      const sessionToken = getStudentSessionToken();

      const res = await fetch(`${API_BASE_URL}/api/ai/advisor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
        },
        body: JSON.stringify(payload),
        signal: abortController.signal
      });

      const data = await res.json();

      if (res.ok && data.reply) {
        // AI response with optional product recommendations
        setChatHistory((prev) => [...prev, {
          role: 'assistant',
          text: data.reply,
          provider: data.provider || 'AI Advisor'
        }]);

        // If advisor included recommendations, update recommended products
        if (data.recommendations && Array.isArray(data.recommendations)) {
          setRecommendedProducts(data.recommendations);
        }
        notifySuccess(studentToast('aiResponseReady'), 'student-ai-advisor');
      } else {
        const errorMsg = data.detail || data.error || 'Sorry, I could not answer that right now.';
        setChatHistory((prev) => [...prev, { role: 'assistant', text: errorMsg, isError: true }]);
        notifyError({ detail: errorMsg }, 'student-ai-advisor');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setChatHistory((prev) => [...prev, { role: 'assistant', text: '⚠️ AI Generation stopped by the user.' }]);
        return;
      }
      console.error('AI advisor error:', err);
      setChatHistory((prev) => [...prev, {
        role: 'assistant',
        text: `Connection error. Please try again in a moment. Ensure the backend server is running at ${API_BASE_URL}`,
        isError: true
      }]);
      notifyError(err, 'student-ai-advisor');
    } finally {
      if (aiAbortControllerRef.current === abortController) {
        aiAbortControllerRef.current = null;
      }
      setIsTyping(false);
    }
  };

  const handleStopAiGeneration = () => {
    aiAbortControllerRef.current?.abort();
  };

  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const [productDetails, setProductDetails] = useState({});
  const productFetchesRef = useRef(new Set());

  // Fetch conversations list from backend
  useEffect(() => {
    if (!user?.studentId) return undefined;

    const fetchConversations = async () => {
      setConversationsLoaded(false);
      setConversationLoadError('');
      if (initialMessagesProductId) {
        setConversationsList([]);
        setActiveConversationId('');
        setActiveChatMessages([]);
      }
      try {
        const token = getStudentSessionToken();
        const url = initialMessagesProductId
          ? `${API_BASE_URL}/api/student/products/${encodeURIComponent(initialMessagesProductId)}/inquiries`
          : `${API_BASE_URL}/api/student/messages/conversations?student_id=${encodeURIComponent(user.studentId)}`;
        const res = await fetch(url, {
          headers: initialMessagesProductId && token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to load conversations.');
        }
        if (data.conversations && Array.isArray(data.conversations)) {
          const requestedConversationId = getConversationIdFromUrl();
          const restoredConversation = data.conversations.find((conversation) => String(conversation.id) === String(requestedConversationId));
          const requestedParticipant = sellerChatParticipantsRef.current[requestedConversationId];
          const syntheticConversation = !initialMessagesProductId && requestedConversationId && !restoredConversation
            ? {
              id: requestedConversationId,
              studentId: String(requestedConversationId).replace(/^conv-/, ''),
              name: requestedParticipant?.name || 'Student',
              department: requestedParticipant?.department || '',
              unread: 0,
              messages: [],
            }
            : null;
          const selectedConversation = restoredConversation || syntheticConversation || data.conversations[0] || null;
          setConversationsList(syntheticConversation
            ? [...data.conversations, syntheticConversation]
            : data.conversations);
          setActiveConversationId(selectedConversation?.id || '');
          setActiveChatMessages(selectedConversation?.messages || []);
          setMobileChatView(initialMessagesProductId && selectedConversation ? 'chat' : requestedConversationId ? 'chat' : 'list');
        }
      } catch (error) {
        console.error('Error fetching conversations:', error);
        setConversationsList([]);
        setActiveConversationId('');
        setMobileChatView('list');
        if (initialMessagesProductId) setConversationLoadError(error.message || 'Failed to load product inquiries.');
        if (getConversationIdFromUrl()) {
          const url = new URL(window.location.href);
          url.searchParams.delete('conversation');
          window.history.replaceState(window.history.state, '', url);
        }
      } finally {
        setConversationsLoaded(true);
      }
    };

    fetchConversations();
    return undefined;
  }, [user?.studentId, initialMessagesProductId, getStudentSessionToken]);

  useEffect(() => {
    const nextUnreadCount = conversationsList.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0);
    setUnreadCount(nextUnreadCount);
    setUnreadMessageCount(nextUnreadCount);
  }, [conversationsList]);

  // Fetch chat history when conversation is selected
  useEffect(() => {
    if (!conversationsLoaded || !user?.studentId || !activeConversationId) return;

    const selectedConversation = conversationsList.find((conversation) => conversation.id === activeConversationId) || conversationsList[0];
    if (!selectedConversation || !selectedConversation.studentId) return;

    const fetchChatHistory = async () => {
      setActiveChatMessages([]);
      try {
        const res = await fetch(`${API_BASE_URL}/api/student/messages/chat-history?sender_id=${user.studentId}&receiver_id=${selectedConversation.studentId}`);
        if (res.ok) {
          const data = await res.json();
          const messages = Array.isArray(data) ? data : data.messages;
          if (Array.isArray(messages)) {
            const formattedMessages = messages.map((msg) => ({
              id: msg.id,
              sender_id: msg.sender_id,
              receiver_id: msg.receiver_id,
              sender: msg.sender_id === user.studentId ? 'me' : 'them',
              text: msg.message_text,
              attachment_url: msg.attachment_url,
              attachment_type: msg.attachment_type,
              reply_to_id: msg.reply_to_id,
              created_at: msg.created_at,
              productId: msg.product_id,
              is_read: Boolean(msg.is_read),
              edited: Boolean(msg.edited),
              edited_at: msg.edited_at,
            }));
            setActiveChatMessages(formattedMessages);
          }
        }
      } catch (error) {
        console.error('Error fetching chat history:', error);
      }
    };

    fetchChatHistory();
  }, [activeConversationId, user?.studentId, conversationsList, conversationsLoaded]);

  useEffect(() => {
    if (!conversationsLoaded || !activeConversationId || activeTab !== 'messages') return;
    const desktopChatIsVisible = window.matchMedia('(min-width: 1024px)').matches;
    if (mobileChatView !== 'chat' && !desktopChatIsVisible) return;
    markConversationReadRef.current?.(
      String(activeConversationId).replace(/^conv-/, '')
    );
  }, [
    activeConversationId,
    activeTab,
    conversationsLoaded,
    mobileChatView,
  ]);

  useEffect(() => {
    const desktopChatIsVisible = window.matchMedia('(min-width: 1024px)').matches;
    if (activeTab !== 'messages' || (mobileChatView !== 'chat' && !desktopChatIsVisible)) return undefined;
    shouldAutoScrollRef.current = true;
    const frame = window.requestAnimationFrame(() => scrollMessagesToLatest());
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversationId, mobileChatView, activeTab]);

  useEffect(() => {
    if (suppressNextMessageAutoScrollRef.current) {
      suppressNextMessageAutoScrollRef.current = false;
      return undefined;
    }
    if (!shouldAutoScrollRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => scrollMessagesToLatest());
    return () => window.cancelAnimationFrame(frame);
  }, [activeChatMessages]);

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Are you sure you want to delete this message?')) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/student/messages/${messageId}?student_id=${encodeURIComponent(user.studentId)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to delete message');
      }

      setActiveChatMessages((previousMessages) => previousMessages.filter((message) => message.id !== messageId));
      notifySuccess(studentToast('messageDeleted'), `student-message-delete-${messageId}`);
    } catch (error) {
      console.error('Error deleting message:', error);
      notifyError(error, `student-message-delete-${messageId}`);
    }
  };

  const handleStartEditMessage = (message) => {
    setEditingMessageId(message.id);
    setEditingMessageContent(message.text || '');
  };

  const handleCancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageContent('');
  };

  const handleSaveEditMessage = async (message) => {
    const content = editingMessageContent.trim();
    if (!content || content === message.text || content.length > MAX_CHAT_MESSAGE_LENGTH) return;

    const previousText = message.text;
    const conversationPreview = conversationsList.find((conversation) => conversation.id === activeConversationId)?.lastMessage;
    const isLatestMessage = String(activeChatMessages.at(-1)?.id) === String(message.id);
    suppressNextMessageAutoScrollRef.current = true;
    setActiveChatMessages((previousMessages) => previousMessages.map((item) => (
      String(item.id) === String(message.id)
        ? { ...item, text: content, edited: true, edited_at: new Date().toISOString() }
        : item
    )));
    if (isLatestMessage) {
      setConversationsList((previousConversations) => previousConversations.map((conversation) => (
        conversation.id === activeConversationId ? { ...conversation, lastMessage: content } : conversation
      )));
    }
    handleCancelEditMessage();

    try {
      const response = await fetch(`${API_BASE_URL}/api/student/messages/${message.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getStudentSessionToken()}`,
        },
        body: JSON.stringify({ content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Failed to edit message.');

      suppressNextMessageAutoScrollRef.current = true;
      setActiveChatMessages((previousMessages) => previousMessages.map((item) => (
        String(item.id) === String(message.id)
          ? { ...item, text: data.content || data.message_text || content, edited: true, edited_at: data.editedAt || data.edited_at }
          : item
      )));
      if (data.is_latest) {
        setConversationsList((previousConversations) => previousConversations.map((conversation) => (
          conversation.id === data.conversationId ? { ...conversation, lastMessage: content } : conversation
        )));
      }
    } catch (error) {
      suppressNextMessageAutoScrollRef.current = true;
      setActiveChatMessages((previousMessages) => previousMessages.map((item) => (
        String(item.id) === String(message.id) ? { ...item, text: previousText, edited: Boolean(message.edited), edited_at: message.edited_at } : item
      )));
      if (isLatestMessage) {
        setConversationsList((previousConversations) => previousConversations.map((conversation) => (
          conversation.id === activeConversationId && conversation.lastMessage === content
            ? { ...conversation, lastMessage: conversationPreview }
            : conversation
        )));
      }
      notifyError(error, `student-message-edit-${message.id}`);
    }
  };

  const handleReplyClick = (message) => {
    setReplyToMessage(message);
  };

  const handleForwardClick = (message) => {
    const forwardedText = message.text && message.text !== '[Attachment]'
      ? `Forwarded message: ${message.text}`
      : 'Forwarded attachment';
    setTypingInput(forwardedText);
  };

  // Fetch product details for messages with product attachments
  useEffect(() => {
    const productIdsToFetch = new Set();
    activeChatMessages.forEach((msg) => {
      if (msg.productId && !productDetails[msg.productId] && !productFetchesRef.current.has(msg.productId)) {
        productIdsToFetch.add(msg.productId);
      }
    });

    if (productIdsToFetch.size === 0) return;

    const productIds = Array.from(productIdsToFetch);
    const params = new URLSearchParams();
    productIds.forEach((productId) => {
      productFetchesRef.current.add(productId);
      params.append('product_ids', String(productId));
    });

    fetch(`${API_BASE_URL}/api/products?${params}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to fetch chat products: ${response.status}`);
        return response.json();
      })
      .then((products) => {
        const availableProducts = new Map((Array.isArray(products) ? products : []).map((product) => [String(product.id), product]));
        setProductDetails((prev) => {
          const next = { ...prev };
          productIds.forEach((productId) => {
            next[productId] = availableProducts.get(String(productId)) || { unavailable: true };
          });
          return next;
        });
      })
      .catch((error) => console.error('Error fetching chat products:', error))
      .finally(() => productIds.forEach((productId) => productFetchesRef.current.delete(productId)));
  }, [activeChatMessages, productDetails]);

  const activeConversation = conversationsList.find((conversation) => conversation.id === activeConversationId) || conversationsList[0] || null;
  const isActiveConversationBlocked = Boolean(activeConversation?.blocked_by_me || activeConversation?.blocked_me);
  const filteredConversations = conversationsList.filter((conversation) => {
    if (initialMessagesProductId && !conversationsLoaded) return false;
    return String(conversation.name || '').toLowerCase().includes(conversationSearch.trim().toLowerCase());
  });
  const visibleChatMessages = initialMessagesProductId && !conversationsLoaded
    ? []
    : initialMessagesProductId
      ? activeChatMessages.filter((message) => String(message.productId) === String(initialMessagesProductId))
      : activeChatMessages;

  useEffect(() => {
    activePeerIdRef.current = String(activeConversation?.studentId || String(activeConversationId || '').replace(/^conv-/, ''));
    setPeerIsTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  }, [activeConversation, activeConversationId]);

  useEffect(() => {
    if (!user?.studentId || typeof window === 'undefined') return undefined;

    const socket = new WebSocket(`${WS_BASE_URL}/api/student/chat/ws/${user.studentId}`);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('Student chat WebSocket connected:', user.studentId);
    };

    socket.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        const incoming = packet?.data || packet;
        const eventType = incoming?.type || incoming?.event;
        if (eventType === 'message_blocked') {
          const blockedPartnerId = String(incoming.receiver_id || activePeerIdRef.current);
          setConversationsList((previousConversations) => previousConversations.map((conversation) => {
            const conversationStudentId = String(
              conversation.studentId || conversation.student_id || String(conversation.id || '').replace(/^conv-/, '')
            );
            return conversationStudentId === blockedPartnerId
              ? {
                ...conversation,
                blocked_by_me: Boolean(incoming.blocked_by_me),
                blocked_me: Boolean(incoming.blocked_me),
              }
              : conversation;
          }));
          notifyError(incoming.error || "You can't send messages in this conversation.", 'student-chat-blocked');
          return;
        }
        if (eventType === 'online_status') {
          const presenceStudentId = String(incoming.student_id || '');
          const presenceStatus = incoming.status === 'online' ? 'online' : 'offline';
          if (presenceStudentId) {
            setConversationsList((previousConversations) => previousConversations.map((conversation) => {
              const conversationStudentId = String(
                conversation.studentId || conversation.student_id || String(conversation.id || '').replace(/^conv-/, '')
              );
              return conversationStudentId === presenceStudentId
                ? { ...conversation, status: presenceStatus }
                : conversation;
            }));
          }
          return;
        }
        if (eventType === 'typing' || eventType === 'user_typing') {
          const typingSenderId = String(incoming.sender_id || incoming.user_id || incoming.student_id || '');
          if (typingSenderId && typingSenderId === activePeerIdRef.current) {
            const isTypingFromPeer = incoming.is_typing !== false && incoming.typing !== false;
            setPeerIsTyping(isTypingFromPeer);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            if (isTypingFromPeer) {
              typingTimeoutRef.current = setTimeout(() => setPeerIsTyping(false), 3000);
            }
          }
          return;
        }
        if (eventType === 'read_receipt_updated') {
          const readerId = String(incoming.reader_id || '');
          if (readerId) {
            setActiveChatMessages((previousMessages) => previousMessages.map((message) => (
              String(message.sender_id) === String(user.studentId)
                && String(message.receiver_id) === readerId
                ? { ...message, is_read: true }
                : message
            )));
          }
          return;
        }
        if (eventType === 'message_edited') {
          const editedConversationId = String(incoming.conversationId || '');
          const editedMessageId = String(incoming.id || '');
          if (editedConversationId === String(activeConversationId)) {
            suppressNextMessageAutoScrollRef.current = true;
            setActiveChatMessages((previousMessages) => previousMessages.map((message) => (
              String(message.id) === editedMessageId
                ? { ...message, text: incoming.content, edited: true, edited_at: incoming.editedAt }
                : message
            )));
          }
          if (incoming.is_latest) {
            setConversationsList((previousConversations) => previousConversations.map((conversation) => (
              conversation.id === editedConversationId ? { ...conversation, lastMessage: incoming.content } : conversation
            )));
          }
          return;
        }
        const message = incoming?.type === 'incoming_message' ? incoming : null;
        if (!message) return;

        const counterpartId = message.sender_id === user.studentId ? message.receiver_id : message.sender_id;
        const counterpartConversationId = `conv-${counterpartId}`;
        const isIncomingToCurrentUser = String(message.receiver_id) === String(user.studentId);
        const isActiveConversation = String(counterpartId) === activePeerIdRef.current;
        const isChatVisible = activeTabRef.current === 'messages'
          && (
            mobileChatViewRef.current === 'chat'
            || window.matchMedia('(min-width: 1024px)').matches
          );
        const markIncomingAsRead = isIncomingToCurrentUser
          && isActiveConversation
          && isChatVisible;

        // Append message to active chat if this is the current conversation
        if (activeConversationId === counterpartConversationId || isActiveConversation) {
          if (String(message.sender_id) === String(user.studentId)) {
            shouldAutoScrollRef.current = true;
          } else {
            updateAutoScrollPreference();
          }
          setActiveChatMessages((prev) => [
            ...prev,
            {
              id: message.id,
              sender_id: message.sender_id,
              receiver_id: message.receiver_id,
              sender: message.sender_id === user.studentId ? 'me' : 'them',
              text: message.message_text,
              attachment_url: message.attachment_url,
              attachment_type: message.attachment_type,
              reply_to_id: message.reply_to_id,
              created_at: message.created_at,
              productId: message.product_id,
              is_read: Boolean(message.is_read),
              edited: Boolean(message.edited),
              edited_at: message.edited_at,
            }
          ]);
        }
        if (markIncomingAsRead) {
          markConversationReadRef.current?.(counterpartId);
        }

        // Update conversation list
        setConversationsList((prev) => {
          const conversationIndex = prev.findIndex(
            (conversation) =>
              conversation.studentId === counterpartId ||
              conversation.id === counterpartId ||
              conversation.id === counterpartConversationId
          );

          if (conversationIndex === -1) {
            return prev;
          }

          return prev.map((item, index) => {
            if (index !== conversationIndex) return item;
            return {
              ...item,
              lastMessage: message.message_text,
              timestamp: 'just now',
              unread: isIncomingToCurrentUser && !markIncomingAsRead
                ? Number(item.unread || 0) + 1
                : 0,
            };
          });
        });
      } catch (error) {
        console.warn('Unable to parse student chat socket payload:', error);
      }
    };

    socket.onerror = (error) => {
      console.error('Student chat socket error:', error);
    };

    socket.onclose = () => {
      console.log('Student chat WebSocket disconnected');
    };

    window.__campusSocket = socket;

    return () => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      delete window.__campusSocket;
    };
  }, [user?.studentId, activeConversationId]);

  const sendWsMessage = (payload) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(payload));
    return true;
  };

  const sendChatMessage = () => {
    const safeMessage = typingInput.trim();
    if (!safeMessage || !activeConversation || isActiveConversationBlocked) return;

    const receiverId = activeConversation.studentId || (String(activeConversation.id || '').replace(/^conv-/, '') || null);
    if (!receiverId) {
      console.warn('No receiver id available for this chat conversation.');
      return;
    }

    const now = new Date();
    const newMessage = {
      id: `msg-${Date.now()}`,
      sender_id: user?.studentId,
      receiver_id: receiverId,
      sender: 'me',
      text: safeMessage,
      created_at: now.toISOString(),
      productId: activeConversation?.product?.id || null,
      reply_to_id: replyToMessage?.id || null,
    };

    shouldAutoScrollRef.current = true;
    setActiveChatMessages((prev) => [...prev, newMessage]);
    setTypingInput('');
    setReplyToMessage(null);
    setConversationsList((prev) => prev.map((conversation) =>
      conversation.id === activeConversation.id
        ? { ...conversation, unread: 0, lastMessage: safeMessage, timestamp: 'just now' }
        : conversation
    ));

    const payload = {
      receiver_id: receiverId,
      message_text: safeMessage,
      product_id: activeConversation?.product?.id ?? null,
      reply_to_id: replyToMessage?.id ?? null,
    };

    if (!sendWsMessage(payload)) {
      console.log('WebSocket transmit fallback:', payload);
    }
  };

  const uploadChatAttachment = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/api/student/chat/upload-attachment`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || 'Could not upload attachment.');
    }
    return response.json();
  };

  const sendChatAttachment = async (file) => {
    if (!file || !activeConversation || isActiveConversationBlocked) return;
    const receiverId = activeConversation.studentId || (String(activeConversation.id || '').replace(/^conv-/, '') || null);
    if (!receiverId || socketRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      const uploaded = await uploadChatAttachment(file);
      shouldAutoScrollRef.current = true;
      socketRef.current.send(JSON.stringify({
        receiver_id: receiverId,
        message_text: '',
        attachment_url: uploaded.attachment_url,
        attachment_type: uploaded.attachment_type,
      }));
      notifySuccess(studentToast('attachmentUploaded'), 'student-chat-attachment');
    } catch (error) {
      console.error('Chat attachment upload failed:', error);
      notifyError(error, 'student-chat-attachment');
    }
  };

  const handleFileAttachmentSelect = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await sendChatAttachment(file);
  };

  const handleStartVoiceRecording = async () => {
    if (isVoiceRecording || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const voiceBlob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const extension = recorder.mimeType.includes('ogg') ? 'ogg' : 'webm';
        await sendChatAttachment(new File([voiceBlob], `voice-note-${Date.now()}.${extension}`, { type: voiceBlob.type }));
        mediaRecorderRef.current = null;
      };
      recorder.start();
      setIsVoiceRecording(true);
    } catch (error) {
      console.error('Unable to start voice recording:', error);
    }
  };

  const handleStopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsVoiceRecording(false);
    }
  };

  const handleViewProductFromChat = (productId) => {
    if (!productId) return;
    setActiveTab('buyer');
    setBuyerTab('search');
    onNavigate?.('product-details', { productId });
  };

  const handleViewProductFromSellerHub = (productId) => {
    if (!productId) return;
    setActiveTab('seller');
    onNavigate?.('product-details', { productId, returnTo: 'seller-hub' });
  };

  const canPayProductFromChat = (product) => {
    const buyerId = String(user?.studentId || user?.student_id || '').trim().toLowerCase();
    const sellerId = String(product?.seller_id || '').trim().toLowerCase();
    return Boolean(buyerId && sellerId && buyerId !== sellerId && Number(product?.stock ?? 1) > 0);
  };

  const handlePayProductFromChat = (productId) => {
    if (!productId) return;
    setActiveTab('buyer');
    setBuyerTab('search');
    onNavigate?.('product-details', { productId, action: 'pay' });
  };

  const handleProductCardKeyDown = (event, productId) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleViewProductFromChat(productId);
    }
  };

  const handleRecommendationClick = async (productId) => {
    if (!productId || !user?.studentId) return;
    try {
      await fetch(`${API_BASE_URL}/api/ai/log-click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: user.studentId, product_id: productId }),
      });
    } catch (error) {
      console.error('Failed to log recommendation click:', error);
    }
    handleViewProductFromChat(productId);
  };

  const handleBlockUser = async (partnerId) => {
    const normalizedPartnerId = String(partnerId || '').trim();
    if (!normalizedPartnerId || isUpdatingConversationBlock) return;
    const shouldBlock = typeof window === 'undefined' || window.confirm(t('messages.confirmBlock'));
    if (!shouldBlock) return;

    const token = getStudentSessionToken();
    if (!token) {
      notifyError(new Error('Your session has expired. Please sign in again.'), 'student-chat-block');
      return;
    }

    setIsUpdatingConversationBlock(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/messages/block/${encodeURIComponent(normalizedPartnerId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to block this user.');

      setConversationsList((previousConversations) => previousConversations.map((conversation) => {
        const conversationStudentId = String(
          conversation.studentId || conversation.student_id || String(conversation.id || '').replace(/^conv-/, '')
        );
        return conversationStudentId === normalizedPartnerId
          ? {
            ...conversation,
            blocked_by_me: Boolean(data.blocked_by_me),
            blocked_me: Boolean(data.blocked_me),
          }
          : conversation;
      }));
      setTypingInput('');
      notifySuccess(studentToast('userBlocked'), 'student-chat-block');
    } catch (error) {
      console.error('Unable to block chat user:', error);
      notifyError(error, 'student-chat-block');
    } finally {
      setIsUpdatingConversationBlock(false);
    }
  };

  const handleUnblockUser = async (partnerId) => {
    const normalizedPartnerId = String(partnerId || '').trim();
    if (!normalizedPartnerId || isUpdatingConversationBlock) return;
    const token = getStudentSessionToken();
    if (!token) {
      notifyError(new Error('Your session has expired. Please sign in again.'), 'student-chat-unblock');
      return;
    }

    setIsUpdatingConversationBlock(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/messages/block/${encodeURIComponent(normalizedPartnerId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to unblock this user.');

      setConversationsList((previousConversations) => previousConversations.map((conversation) => {
        const conversationStudentId = String(
          conversation.studentId || conversation.student_id || String(conversation.id || '').replace(/^conv-/, '')
        );
        return conversationStudentId === normalizedPartnerId
          ? {
            ...conversation,
            blocked_by_me: Boolean(data.blocked_by_me),
            blocked_me: Boolean(data.blocked_me),
          }
          : conversation;
      }));
      notifySuccess(studentToast('userUnblocked'), 'student-chat-unblock');
    } catch (error) {
      console.error('Unable to unblock chat user:', error);
      notifyError(error, 'student-chat-unblock');
    } finally {
      setIsUpdatingConversationBlock(false);
    }
  };

  const handleReportSubmit = async (event) => {
    event.preventDefault();
    const reason = reportReason.trim();
    const partnerId = activeConversation?.studentId || String(activeConversation?.id || '').replace(/^conv-/, '');
    if (!reason || !partnerId || !user?.studentId) return;

    setIsSubmittingReport(true);
    setReportStatus('');
    try {
      const formData = new FormData();
      formData.append('student_id', user.studentId);
      formData.append('student_name', user.name || '');
      formData.append('email', user.email || '');
      formData.append('category', 'Fraud Report');
      formData.append('seller_id', partnerId);
      formData.append('issue', `Report against ${partnerId}: ${reason}`);
      const res = await fetch(`${API_BASE_URL}/api/student/report`, {
        method: 'POST',
        headers: {
          ...(user?.access_token || user?.accessToken || user?.token
            ? { Authorization: `Bearer ${user.access_token || user.accessToken || user.token}` }
            : {}),
        },
        body: formData
      });

      if (!res.ok) {
        throw new Error('Report request failed');
      }

      setReportReason('');
      setReportStatus('Your complaint was submitted for Admin review.');
      notifySuccess(studentToast('reportSubmitted'), 'student-report-submit');
      setTimeout(() => {
        setShowReportModal(false);
        setReportStatus('');
      }, 1500);
    } catch (error) {
      console.error('Unable to submit chat report:', error);
      setReportStatus('Unable to submit the complaint. Please try again.');
      notifyError(error, 'student-report-submit');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleChatMenuAction = async (action) => {
    setShowChatDropdown(false);

    if (action === 'profile') {
      setShowProfileDetailsModal(true);
      return;
    }

    if (action === 'product') {
      if (activeConversation?.product?.id) {
        handleViewProductFromChat(activeConversation.product.id);
      } else {
        setReportStatus('No product is attached to this conversation.');
      }
      return;
    }

    if (action === 'report') {
      setReportReason('');
      setReportStatus('');
      setShowReportModal(true);
      return;
    }

    if (action === 'block' || action === 'unblock') {
      const partnerId = activeConversation?.studentId || activeConversation?.student_id || String(activeConversation?.id || '').replace(/^conv-/, '');
      if (action === 'block') {
        await handleBlockUser(partnerId);
      } else {
        await handleUnblockUser(partnerId);
      }
    }

    if (action === 'delete') {
      if (activeConversation?.id) {
        const remainingConversations = conversationsList.filter((conversation) => conversation.id !== activeConversation.id);
        setConversationsList(remainingConversations);
        setActiveConversationId(remainingConversations[0]?.id || '');
        showConversationList();
      }
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!user?.studentId || safeNotifications.length === 0) return;

    setIsMarkingRead(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/student/notifications/mark-all-read?student_id=${encodeURIComponent(user.studentId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getStudentSessionToken()}` },
      });

      if (res.ok) {
        setNotifications((prev) => prev.map((notification) => ({
          ...notification,
          read: true
        })));
        notifySuccess(studentToast('notificationsRead'), 'student-notifications-read');
      } else {
        const data = await res.json().catch(() => ({}));
        notifyError(data, 'student-notifications-read');
      }
    } catch (err) {
      console.error('Error marking notifications read:', err);
      notifyError(err, 'student-notifications-read');
    } finally {
      setIsMarkingRead(false);
    }
  };

  const modeNavigationItems = dashboardMode === 'buyer'
    ? [
      { key: 'marketplace', label: 'Browse products', icon: '🛒', tab: 'buyer', buyerSection: 'search', mode: 'buyer' },
      { key: 'orders', label: 'My Orders', icon: '📦', badge: orderCount, tab: 'buyer', buyerSection: 'orders', mode: 'buyer' },
      { key: 'wishlist', label: 'Wishlist', icon: '♡', badge: wishlistCount, tab: 'buyer', buyerSection: 'wishlist', mode: 'buyer' },
      { key: 'cart', label: 'Cart', icon: '🛍️', badge: cartItemCount, tab: 'buyer', buyerSection: 'cart', mode: 'buyer' },
      { key: 'payments', label: 'Payments & Transactions', icon: '💳', tab: 'buyer', buyerSection: 'payments', mode: 'buyer' },
      { key: 'reports-support', label: 'Support & Reports', icon: '🛟', tab: 'buyer', buyerSection: 'reports-support', mode: 'buyer' },
    ]
    : [
      { key: 'add-product', label: 'Post New Item', icon: '＋', tab: 'seller', sellerDestination: 'add_product', mode: 'seller' },
      { key: 'my-listings', label: 'My Listings', icon: '🏷️', tab: 'seller', sellerDestination: 'listings', mode: 'seller' },
      { key: 'customer-orders', label: 'Customer Orders', icon: '📦', tab: 'seller', sellerDestination: 'orders', mode: 'seller' },
      { key: 'sales-analytics', label: 'Sales Analytics', icon: '📈', tab: 'seller', sellerDestination: 'analytics', mode: 'seller' },
    ];
  const sharedNavigationItems = [
    { key: 'messages', label: 'Messages', icon: '💬', badge: conversationsLoaded ? unreadCount : unreadMessageCount, mode: dashboardMode },
    { key: 'settings', label: 'Settings', icon: '⚙️', mode: dashboardMode },
  ];
  const handleStudentSidebarNavigation = (item) => {
    if (activeTab === 'settings' && isNotificationPrefsDirty && item.key !== 'settings' && !window.confirm(t('studentToast.discardUnsavedPreferences'))) return;
    const nextMode = item.mode || dashboardMode;
    setDashboardMode(nextMode);
    if (item.sellerDestination) {
      setActiveSellerDestination(item.sellerDestination);
      if (item.sellerDestination === 'add_product') {
        resetProductForm();
        setShowProductModal(true);
      } else if (item.sellerDestination !== 'wallet') {
        setSellerNavigationRequest((request) => ({ destination: item.sellerDestination, id: request.id + 1 }));
      }
    } else if (item.buyerSection) {
      setBuyerTab(item.buyerSection);
      if (item.buyerSection === 'orders') {
        ordersBadgeAcknowledgedRef.current = true;
        setNewOrdersCount(0);
      }
    }
    if (item.settingsSection) setSettingsTab(item.settingsSection);
    if (item.key === 'settings') setActiveSellerDestination('overview');
    setActiveTab(item.tab || item.key);
    setIsSidebarOpen(false);
    onTabChange?.(item.tab || item.key, nextMode, item.buyerSection || null);
  };

  return (
    <div className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-100 text-slate-900 ${activeTab === 'messages' ? 'overflow-hidden' : ''}`}>
      <div className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row lg:items-stretch lg:px-0 ${activeTab === 'messages' ? 'h-full overflow-hidden' : ''}`}>

        {/* 1. የግራ የጎን መቆጣጠሪያ ፓነል (Responsive Collapsible Student Sidebar) */}
        <aside id="student-mobile-navigation" data-open={isSidebarOpen} className={`student-mobile-sidebar fixed top-[var(--header-h)] bottom-0 left-0 z-40 flex h-[calc(100dvh-var(--header-h))] w-72 shrink-0 flex-col justify-between overflow-hidden rounded-none rounded-r-2xl bg-[#1a1a2e] p-3 text-white shadow-2xl transition-[width,transform] duration-200 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:sticky lg:top-0 lg:h-full lg:min-h-0 lg:self-start lg:overflow-visible lg:translate-x-0 lg:shadow-none
          ${isSidebarCollapsed ? 'lg:w-20 lg:min-w-0 lg:px-2 lg:py-4' : 'lg:w-72 lg:px-3 lg:py-4'}
        `}>
          <div className={`mb-8 flex shrink-0 items-start justify-between ${isSidebarCollapsed ? 'lg:flex-col lg:items-center lg:gap-3' : ''}`}>
            <div className={`${isSidebarCollapsed ? 'w-full text-center' : ''}`}>
              <div className="flex items-center gap-2">
                <p className={`whitespace-nowrap overflow-hidden text-[10px] uppercase tracking-[0.24em] text-slate-400 font-bold border-b-2 border-white/80 w-fit pb-1 ${isSidebarCollapsed || !areSidebarLabelsVisible ? 'lg:hidden' : 'block'}`}>{dashboardMode === 'seller' ? 'Seller Dashboard' : 'Buyer Dashboard'}</p>
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                  className={`group hidden h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 text-lg font-bold text-slate-200 transition-all duration-300 hover:scale-105 hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:inline-flex ${isSidebarCollapsed ? 'lg:mx-auto [anchor-name:--student-sidebar-toggle]' : 'ml-auto'}`}
                  title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                  <span className="transition-transform duration-300" aria-hidden="true">{isSidebarCollapsed ? '→' : '←'}</span>
                  {isSidebarCollapsed && (
                    <span className="fixed z-50 hidden whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xl group-hover:block group-focus-visible:block [position-anchor:--student-sidebar-toggle] [position-area:right] [margin-left:0.5rem]">
                      Expand sidebar
                    </span>
                  )}
                </button>
              </div>
              <span className={`mt-3 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${verifiedStudent ? 'border border-emerald-400/40 bg-emerald-500/10 text-emerald-300' : 'border border-amber-400/40 bg-amber-500/10 text-amber-300'}`}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${verifiedStudent ? 'bg-emerald-500' : 'bg-amber-500'}`}>{verifiedStudent ? '✓' : '!'}</span>
                <span className={isSidebarCollapsed ? 'lg:sr-only' : 'whitespace-nowrap overflow-hidden'}>{verifiedStudent ? 'Verified Student' : 'Unverified Profile'}</span>
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-lg p-1.5 text-slate-300 transition-all duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:hidden"
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsSidebarOpen(false);
              onNavigate?.(dashboardMode === 'seller' ? '/dashboard?mode=buyer' : '/dashboard?mode=seller');
            }}
            className={`mb-4 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold text-white shadow-md transition lg:hidden ${dashboardMode === 'seller' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-sky-500 hover:bg-sky-600'}`}
          >
            {dashboardMode === 'seller' ? '🛒 Switch to Buying' : '+ Sell an Item'}
          </button>
          <nav className={`student-sidebar-menu flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto overflow-x-hidden pb-4 [scrollbar-width:thin] ${isSidebarCollapsed ? 'lg:items-center' : ''}`}>
            {[...modeNavigationItems, ...sharedNavigationItems].map((item) => {
              const isActive = item.sellerDestination
                ? (item.sellerDestination === 'wallet'
                  ? activeTab === 'settings' && activeSellerDestination === 'wallet'
                  : activeTab === 'seller' && activeSellerDestination === item.sellerDestination)
                : item.buyerSection
                  ? activeTab === 'buyer' && buyerTab === item.buyerSection
                  : item.key === 'settings'
                    ? activeTab === 'settings'
                    : activeTab === (item.tab || item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleStudentSidebarNavigation(item)}
                  data-dashboard-target={item.key}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  className={`sidebar-nav-item group relative flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${isActive ? 'active' : ''} ${isSidebarCollapsed ? `lg:justify-center lg:px-2 ${STUDENT_SIDEBAR_TOOLTIP_ANCHORS[item.key]}` : ''}`}
                  title={item.label}
                >
                  <span className={`flex min-w-0 flex-1 items-center gap-3 ${isSidebarCollapsed ? 'lg:justify-center lg:gap-0' : ''}`}>
                    <span className="shrink-0" aria-hidden="true">{item.icon}</span>
                    <span className={`${isSidebarCollapsed || !areSidebarLabelsVisible ? 'lg:hidden' : ''} whitespace-nowrap overflow-hidden`}>{item.label}</span>
                    {item.badge > 0 && (
                      <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950 ring-2 ring-[#111c3a] ${isSidebarCollapsed ? 'lg:absolute lg:right-1 lg:top-1 lg:h-2 lg:min-w-0 lg:p-0 lg:text-transparent' : ''}`}>
                        {item.badge}
                      </span>
                    )}
                  </span>
                  {isSidebarCollapsed && (
                    <span className={`fixed z-50 hidden whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xl group-hover:block group-focus-visible:block [position-area:right] [margin-left:0.5rem] ${STUDENT_SIDEBAR_TOOLTIP_POSITIONS[item.key]}`}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

        </aside>

        {/* በሞባይል ስልኮች ላይ የጎን ማውጫው ሲከፈት በስተጀርባ የሚመጣ ጥቁር ጥላ (Mobile Overlay Backdrop) */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          />
        )}

        {/* 2. የቀኝ ዋና ይዘት ማሳያ ሰሌዳ (Main Content Panel) */}
        <main ref={dashboardContentRef} className={`student-dashboard-content min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain ${activeTab === 'messages' ? 'overflow-hidden p-0' : 'px-6 py-6 sm:px-10'}`}>
          {/* ፖፕአፕ የድጋፍ ፎርም (Support Modal) */}
          {showSupportModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="relative bg-white rounded-[28px] p-6 max-w-md w-full shadow-2xl border border-slate-100">
                <h3 className="text-xl font-bold text-slate-900 border-b pb-2 mb-4">Request Support / Report Issue</h3>

                {supportMsg && (
                  <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-800">
                    {supportMsg}
                  </div>
                )}

                <form onSubmit={handleSupportSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Full Name</label>
                    <input type="text" disabled value={user?.name || ''} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Student ID</label>
                    <input type="text" disabled value={user?.studentId || ''} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Inquiry Type</label>
                    <select value={supportCategory} onChange={(e) => setSupportCategory(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-sky-500 focus:bg-white focus:outline-none transition">
                      <option>General Inquiry</option>
                      <option>Login Issue</option>
                      <option>Payment Problem</option>
                      <option>Fraud Report</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Subject</label>
                    <input
                      type="text"
                      maxLength={200}
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      placeholder="Briefly summarize your request"
                      className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-sky-500 focus:bg-white focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Describe your issue or complaint</label>
                    <textarea
                      rows="4"
                      value={supportIssue}
                      onChange={(e) => setSupportIssue(e.target.value)}
                      placeholder="Detail your complaint here..."
                      className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-sky-500 focus:bg-white focus:outline-none transition"
                    ></textarea>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Evidence image <span className="font-normal text-slate-400">(optional)</span></label>
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setSupportEvidenceImage(e.target.files?.[0] || null)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" />
                  </div>

                  <div className="flex gap-3">
                    <button type="submit" className="btn-primary flex-1 rounded-full py-3 font-semibold transition cursor-pointer">
                      Submit Ticket
                    </button>
                    <button type="button" onClick={() => setShowSupportModal(false)} className="flex-1 rounded-full border border-slate-200 bg-white py-3 font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <section className={`mx-auto grid min-h-0 w-full max-w-[1600px] min-w-0 grid-cols-[minmax(0,1fr)] gap-6 animate-fade-in [&>*]:min-w-0 [&>*]:max-w-full ${activeTab === 'messages' ? 'h-full flex-1' : ''}`}>
            {/* 1. ገጽ 1፦ የዳሽቦርዱ መግቢያ (Home Tab) */}
            {activeTab === 'home' && (
              <div data-dashboard-view="home" className="min-w-0 space-y-6">

                <div className={`grid min-w-0 max-w-full gap-6 ${recommendationsStudentId === studentId && recommendedProducts.length ? 'xl:grid-cols-[1.35fr_0.65fr]' : 'xl:grid-cols-1'}`}>
                  {recommendationsStudentId === studentId && recommendedProducts.length > 0 && (
                    <div className="min-w-0 max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-700 dark:bg-slate-900">
                      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2">
                        <h3 className="min-w-0 break-words text-xl font-bold text-slate-900 dark:text-white">AI Recommendations</h3>
                        <span className="max-w-full whitespace-nowrap rounded-full bg-sky-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700 dark:bg-sky-950 dark:text-sky-200 sm:tracking-[0.2em]">Department Match</span>
                      </div>

                      <div className="-mx-2 flex min-w-0 max-w-full snap-x snap-mandatory touch-pan-x gap-3 overflow-x-auto px-2 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4">
                        {recommendedProducts.map((item) => {
                          const fallbackImage = getRecommendationPlaceholder(item.category);
                          const displayImage = getRecommendationImage(item.image) || fallbackImage;

                          return (
                            <div key={item.id} className="flex w-[75%] min-w-0 max-w-full shrink-0 snap-start flex-col rounded-[24px] border border-slate-200 bg-slate-50 p-3 transition hover:-translate-y-0.5 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 md:w-auto md:shrink md:snap-none">
                              <div className="mb-3 aspect-square w-full max-w-full overflow-hidden rounded-[18px] bg-slate-200 dark:bg-slate-700">
                                <img
                                  src={resolveImageUrl(displayImage)}
                                  alt={item.title || 'Recommended marketplace product'}
                                  onError={(event) => {
                                    event.currentTarget.onerror = null;
                                    event.currentTarget.src = fallbackImage;
                                  }}
                                  className="h-full w-full max-w-full object-cover"
                                />
                              </div>
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <span className="max-w-[70%] truncate rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                                  {item.category || 'Recommended'}
                                </span>
                                <span className="hidden shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-300 md:inline">{item.match || 'High match'}</span>
                              </div>
                              <h4 className="mt-2 line-clamp-2 break-words text-sm font-bold text-slate-900 dark:text-white">{item.title}</h4>
                              <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{item.description || 'Popular campus item tailored to your department.'}</p>
                              <div className="mt-auto pt-3">
                                <span className="text-sm font-bold text-slate-950 dark:text-white">{formatETB(item.price)}</span>
                                <button type="button" onClick={() => handleRecommendationClick(item.id)} className="mt-2 w-full whitespace-normal break-words rounded-full bg-sky-400 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500">View Details →</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="min-w-0 max-w-full space-y-6">
                    {/* Quick Actions */}
                    <div className="min-w-0 max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                      <h3 className="mb-4 break-words border-b pb-2 text-xl font-bold text-slate-900">Quick Actions</h3>
                      <div className="space-y-2">
                        <button onClick={() => setActiveTab('buyer')} className="w-full whitespace-normal break-words text-left rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition cursor-pointer">Continue browsing marketplace</button>
                        <button onClick={() => setActiveTab('buyer')} className="w-full whitespace-normal break-words text-left rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition cursor-pointer">Check seller orders</button>
                      </div>
                    </div>

                    {/* Recent Campus Activity */}
                    <div className="min-w-0 max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                      <h3 className="mb-4 break-words border-b pb-2 text-xl font-bold text-slate-900">Recent UniXchange Activity</h3>
                      <div className="space-y-3">
                        {recentCampusActivity.length ? (
                          recentCampusActivity.map((item, index) => (
                            <div key={`${item.title || 'activity'}-${index}`} className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-slate-50 p-3">
                              <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0 max-w-full break-words text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{item.time || 'Now'}</span>
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"></span>
                              </div>
                              <p className="min-w-0 max-w-full break-words text-sm font-semibold text-slate-900">{item.title || item.action || 'Marketplace update'}</p>
                              <p className="mt-1 min-w-0 max-w-full break-words text-xs text-slate-600">{item.description || item.detail || 'Fresh student marketplace activity.'}</p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                            New products are being listed across campus.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* My Seller Status */}
                    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="text-xl font-bold text-slate-900 border-b pb-2 mb-4">My Seller Status</h3>
                      <div className={`rounded-[24px] border p-4 ${sellerStatusSummary.tone === 'amber' ? 'border-amber-200 bg-amber-50' : sellerStatusSummary.tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${sellerStatusSummary.tone === 'amber' ? 'bg-amber-100 text-amber-700' : sellerStatusSummary.tone === 'rose' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {sellerStatusSummary.label}
                          </span>
                          <span className="text-xl font-black text-slate-900">{myListings.length}</span>
                        </div>
                        <p className="mt-3 text-sm text-slate-700">{sellerStatusSummary.details}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. ገጽ 2፦ የገዢዎች መቆጣጠሪያ ሰሌዳ (Buyer Hub) */}
            {activeTab === 'buyer' && selectedOrder && (
              <>
                {disputeFeedback && <p className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${disputeFeedback.startsWith('Dispute submitted') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{disputeFeedback}</p>}
                <OrderDetailsView
                  order={selectedOrder}
                  role="buyer"
                  loading={orderDetailsLoading}
                  error={orderDetailsError}
                  onBack={() => setSelectedOrder(null)}
                  onRefresh={() => fetchOrderDetails(selectedOrder.id)}
                  onViewSellerProfile={(sellerId) => {
                    if (sellerId && sellerId !== selectedOrder.seller_name) {
                      onNavigate?.('seller-profile', { sellerId });
                    }
                  }}
                  onRaiseDispute={(order) => {
                    if (!isDisputeEligibleOrder(order)) {
                      const message = 'You can report a problem within 24 hours after payment is completed.';
                      setDisputeFeedback(message);
                      notifyInfo(message);
                      return;
                    }

                    setDisputeOrderId(order.id);
                    setDisputeReason('');
                    setDisputeDescription('');
                    setDisputeEvidenceFiles([]);
                    setDisputeFeedback('');
                  }}
                  paymentReceipt={paymentReceiptState[selectedOrder.id]?.data}
                  supportEmail={receiptSupportEmail}
                  paymentReceiptLoading={paymentReceiptState[selectedOrder.id]?.loading}
                  paymentReceiptError={paymentReceiptState[selectedOrder.id]?.error}
                  onViewReceipt={handleViewPaymentReceipt}
                  onDownloadReceipt={handleDownloadPaymentReceipt}
                  onPrintReceipt={handlePrintPaymentReceipt}
                />
              </>
            )}

            {activeTab === 'buyer' && selectedOrder && disputeOrderId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="dispute-modal-title">
                <form onSubmit={handleSubmitDispute} className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">Order dispute</p>
                      <h4 id="dispute-modal-title" className="mt-2 text-2xl font-bold text-slate-900">Report a problem with this payment</h4>
                    </div>
                    <button type="button" onClick={() => { setDisputeOrderId(null); setDisputeEvidenceFiles([]); }} className="rounded-full border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-50">Close</button>
                  </div>
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    "You can report an issue within 24 hours after payment. The seller's received amount will be frozen while an admin reviews it."
                  </div>
                  <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="dispute-reason">Reason</label>
                  <select id="dispute-reason" required value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-rose-400 focus:bg-white">
                    <option value="">Select a reason</option>
                    {disputeReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </select>
                  <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="dispute-description">Description/details</label>
                  <textarea id="dispute-description" required rows="5" value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} placeholder="Describe the issue with this order..." className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none focus:border-rose-400 focus:bg-white" />
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-slate-700">Evidence images</label>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={(event) => setDisputeEvidenceFiles(Array.from(event.target.files || []))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-700"
                    />
                    {disputeEvidenceFiles.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {disputeEvidenceFiles.map((file, index) => (
                          <div key={`${file.name}-${index}`} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                            <img src={URL.createObjectURL(file)} alt={`Dispute evidence preview ${index + 1}`} className="h-20 w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setDisputeEvidenceFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                              className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-[10px] font-bold text-white"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {disputeFeedback && <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{disputeFeedback}</p>}
                  <p className="mt-2 text-xs text-slate-500">An Admin will review the case before the funds are refunded or released.</p>
                  <div className="mt-5 flex justify-end gap-3">
                    <button type="button" onClick={() => { setDisputeOrderId(null); setDisputeEvidenceFiles([]); }} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                    <button type="submit" disabled={isSubmittingDispute || !disputeReason.trim() || !disputeDescription.trim()} className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{isSubmittingDispute ? 'Submitting...' : 'Submit Dispute'}</button>
                  </div>
                </form>
              </div>
            )}

            {activeTab === 'buyer' && !selectedOrder && (
              <div data-dashboard-view="buyer" className="min-w-0 w-full max-w-full space-y-6 [&>*]:min-w-0 [&>*]:max-w-full">
                {buyerTab === 'search' && (
                  <div className="min-w-0 w-full max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="min-w-0">
                      <div className="min-w-0">
                        <h3 className="text-xl font-bold text-slate-900">Search & Browse Marketplace</h3>
                        <p className="text-sm text-slate-500 mt-1">Find student listings by name, category, or subcategory.</p>
                      </div>
                    </div>

                    <form onSubmit={handleSearchSubmit} className="mt-6 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
                      <div className="min-w-0">
                        <label className="block text-sm font-semibold text-slate-700">Search</label>
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search for textbooks, phones, bags..."
                          className="mt-2 block min-w-0 w-full max-w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none transition"
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="block text-sm font-semibold text-slate-700">Category</label>
                        <select
                          value={searchCategory}
                          onChange={(e) => {
                            setSearchCategory(e.target.value);
                            setSearchSubcategory('');
                          }}
                          className="mt-2 block min-w-0 w-full max-w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none transition"
                        >
                          <option value="">All categories</option>
                          {categories.map((cat) => (
                            <option key={cat.id || cat.name} value={cat.name}>{cat.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0">
                        <label className="block text-sm font-semibold text-slate-700">Subcategory</label>
                        <select
                          value={searchSubcategory}
                          onChange={(e) => setSearchSubcategory(e.target.value)}
                          disabled={!searchCategory}
                          className="mt-2 block min-w-0 w-full max-w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none transition disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">All subcategories</option>
                          {categories.find((cat) => cat.name === searchCategory)?.items?.map((sub) => (
                            <option key={sub.name} value={sub.name}>{sub.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col justify-end gap-3 sm:flex-row sm:justify-end lg:col-span-3">
                        <button type="submit" className="btn-primary inline-flex h-11 w-full min-w-[120px] items-center justify-center rounded-2xl px-5 text-sm font-semibold shadow-sm transition cursor-pointer sm:w-auto">Search</button>
                        <button type="button" onClick={() => { resetSearchFilters(); fetchProducts({ limit: BUYER_HUB_PAGE_SIZE }); }} className="inline-flex h-11 w-full min-w-[120px] items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer sm:w-auto">Reset</button>
                      </div>
                    </form>

                    <div className="mt-6 min-w-0 max-w-full overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                      {wishlistMessage && <p className="text-sm text-emerald-700">{wishlistMessage}</p>}
                      {cartMessage && <p className="text-sm text-emerald-700">{cartMessage}</p>}
                      {searchLoading ? (
                        <p className="text-sm text-slate-500">Searching listings…</p>
                      ) : searchResults.length === 0 ? (
                        <p className="text-sm text-slate-500">No products match your search yet. Try a different keyword or category.</p>
                      ) : (
                        <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                          {searchResults.map((item) => {
                            const productId = String(item.id);
                            const buyerStudentId = String(user?.studentId || user?.student_id || '').trim();
                            const isInWishlist = wishlist.some(
                              (wishlistItem) => String(wishlistItem.product_id ?? wishlistItem.id) === productId,
                            );
                            const isOwnProduct = Boolean(
                              buyerStudentId
                              && buyerStudentId.toLowerCase()
                              === String(item.seller_id || item.seller || '').trim().toLowerCase(),
                            );
                            const isOutOfStock = Number.isFinite(Number(item.stock)) && Number(item.stock) <= 0;
                            const isInCart = cart.some((cartItem) => String(cartItem.product_id) === productId);
                            const cartReady = !buyerStudentId || (
                              cartStudentId === buyerStudentId && !cartLoading && !cartError
                            );

                            return (
                              <BuyerHubProductCard
                                key={item.id}
                                item={item}
                                priceLabel={formatETB(normalizePrice(item.price))}
                                isOwnProduct={isOwnProduct}
                                isOutOfStock={isOutOfStock}
                                isInCart={isInCart}
                                isInWishlist={isInWishlist}
                                cartReady={cartReady}
                                cartError={Boolean(buyerStudentId && cartError)}
                                isAddingToCart={addingCartProductIds.includes(productId)}
                                onViewProduct={() => handleViewProductFromChat(item.id)}
                                onKeyDown={(event) => handleProductCardKeyDown(event, item.id)}
                                onAddToCart={() => handleAddToCartFromSearch(item.id)}
                                onPay={() => handlePayProductFromChat(item.id)}
                                onAddToWishlist={() => handleAddToWishlist(item.id)}
                                onEdit={() => handleEditProduct(item)}
                                onDelete={() => handleDeleteProduct(item)}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Sub-tab 2: Wishlist */}
                {buyerTab === 'wishlist' && (
                  <div className="min-w-0 max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-slate-900 border-b pb-2 mb-4">Your Wishlist</h3>
                        <p className="text-sm text-slate-500">Keep a shortlist of items to discuss with sellers before meeting to pay.</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {wishlist.length > 1 && (
                          <button
                            type="button"
                            onClick={handleMoveAllToCart}
                            className="btn-primary rounded-full px-4 py-2.5 text-xs font-semibold transition"
                          >
                            Move All to Cart
                          </button>
                        )}
                        {wishlistMessage && <p className="rounded-full bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{wishlistMessage}</p>}
                      </div>
                    </div>

                    {wishlist.length === 0 ? (
                      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-sky-100 text-3xl">💡</div>
                        <p className="mt-5 text-lg font-semibold text-slate-900">Your wishlist is empty</p>
                        <p className="mt-2 text-sm text-slate-500">Save items you like and review them before meeting the seller to pay.</p>
                      </div>
                    ) : (
                      <div className="mt-6 space-y-4">
                        {wishlist.map((item) => {
                          const available = isWishlistItemAvailable(item);
                          const itemPrice = formatETB(normalizePrice(item.price));

                          return (
                            <div key={item.id} onClick={() => handleViewProductFromChat(item.product_id)} onKeyDown={(event) => handleProductCardKeyDown(event, item.product_id)} role="button" tabIndex={0} className="cursor-pointer rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm transition hover:shadow-md">
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                <div className="flex items-center gap-4">
                                  <img
                                    src={resolveImageUrl(item.image)}
                                    alt={item.title}
                                    className="h-16 w-16 rounded-full object-cover ring-2 ring-white shadow-sm"
                                    onError={(e) => {
                                      e.currentTarget.onerror = null;
                                      e.currentTarget.src = IMAGE_PLACEHOLDER;
                                    }}
                                  />
                                  <div className="min-w-0">
                                    <h4 className="truncate text-base font-bold text-slate-900">{item.title}</h4>
                                    <p className="mt-1 text-sm font-semibold text-slate-700">{itemPrice}</p>
                                    {item.category && (
                                      <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                                        {item.category}{item.subcategory ? ` • ${item.subcategory}` : ''}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="ml-auto flex flex-col items-end gap-3">
                                  <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${available ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                                    {available ? '🟢 Available' : '🔴 Sold / Unavailable'}
                                  </span>

                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={(event) => { event.stopPropagation(); handleMoveToCart(item.id, item.product_id); }}
                                      disabled={!available}
                                      className={`rounded-full px-4 py-2 text-xs font-semibold transition ${available ? 'btn-primary' : 'cursor-not-allowed bg-slate-200 text-slate-500'}`}
                                    >
                                      Move to Cart
                                    </button>

                                    {!available && (
                                      <button
                                        type="button"
                                        onClick={(event) => { event.stopPropagation(); handleFindSimilar(item); }}
                                        className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition"
                                      >
                                        Find Similar
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={(event) => { event.stopPropagation(); handleRemoveFromWishlist(item.id); }}
                                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                  </div>
                )}

                {/* Sub-tab 2: Cart */}
                {buyerTab === 'cart' && (
                  <div className="min-w-0 max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-slate-900 border-b pb-2 mb-4">Your Shopping Cart</h3>
                        <p className="text-sm text-slate-500">Review saved items and remove anything you no longer need.</p>
                      </div>
                      {cartMessage && <p className="rounded-full bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{cartMessage}</p>}
                    </div>

                    {cart.length === 0 ? (
                      <div className="space-y-4">
                        <p className="text-sm text-slate-400 text-center py-6">Your cart is empty.</p>
                      </div>
                    ) : (
                      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
                        <div className="space-y-4">
                          {cart.map((item) => {
                            const quantity = Number(item.quantity || 1);
                            const lineTotal = normalizePrice(item.price) * quantity;
                            const fallbackImage = 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80';
                            const backendOrigin = `${API_BASE_URL}`;
                            let displayImage = fallbackImage;
                            const imageValue = typeof item.image === 'string' ? item.image.trim() : '';
                            let imageSource = imageValue;

                            if (imageValue) {
                              if (imageValue.startsWith('[') && imageValue.endsWith(']')) {
                                try {
                                  const parsedImages = JSON.parse(imageValue);
                                  imageSource = Array.isArray(parsedImages) && parsedImages.length > 0
                                    ? String(parsedImages[0]).trim()
                                    : '';
                                } catch {
                                  imageSource = '';
                                }
                              }

                              if (imageSource) {
                                displayImage = imageSource.startsWith('http')
                                  ? imageSource
                                  : `${backendOrigin}${imageSource.startsWith('/') ? '' : '/'}${imageSource}`;
                              }
                            }

                            return (
                              <div key={item.id} onClick={() => handleViewProductFromChat(item.product_id)} onKeyDown={(event) => handleProductCardKeyDown(event, item.product_id)} role="button" tabIndex={0} className="grid cursor-pointer gap-4 rounded-[28px] border border-slate-200 bg-slate-50 p-4 shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
                                <img
                                  src={resolveImageUrl(displayImage)}
                                  alt={item.title}
                                  className="h-20 w-20 rounded-full object-cover ring-2 ring-white shadow-sm"
                                  onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = fallbackImage;
                                  }}
                                />

                                <div className="min-w-0">
                                  <h4 className="truncate text-base font-semibold text-slate-900">{item.title}</h4>
                                  <p className="mt-1 text-sm text-slate-500">Seller: {item.seller || 'Campus Seller'}</p>
                                  <p className="mt-3 text-sm font-medium text-slate-500">Price: {formatETB(normalizePrice(item.price))}</p>
                                  <div className="mt-3 flex items-center gap-3">
                                    <span className="text-sm font-semibold text-slate-600">Quantity</span>
                                    <button type="button" onClick={(event) => { event.stopPropagation(); handleUpdateCartQuantity(item.id, quantity - 1); }} disabled={quantity <= 1} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Decrease ${item.title} quantity`}>-</button>
                                    <span className="min-w-6 text-center font-bold text-slate-900">{quantity}</span>
                                    <button type="button" onClick={(event) => { event.stopPropagation(); handleUpdateCartQuantity(item.id, quantity + 1); }} disabled={quantity >= Number(item.stock ?? 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Increase ${item.title} quantity`}>+</button>
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-3">
                                  <span className="text-lg font-bold text-slate-900">{formatETB(lineTotal)}</span>
                                  <button
                                    onClick={(event) => { event.stopPropagation(); handleRemoveFromCart(item.id); }}
                                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5">
                          <p className="text-sm font-bold text-emerald-900">Payments happen on the product page after you inspect the item with the seller.</p>
                          <p className="mt-2 text-sm text-emerald-800">No order or charge is created from your cart.</p>
                          <button type="button" onClick={() => { setBuyerTab('search'); setActiveTab('buyer'); }} className="mt-4 rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800">Browse products</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-tab 3: My Orders */}
                {buyerTab === 'orders' && (
                  <div className="min-w-0 max-w-full rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="border-b border-slate-200 pb-2 text-xl font-bold text-slate-900">Your Orders</h3>
                        <p className="mt-3 text-sm text-slate-500">Review completed purchases and report a problem within the payment window.</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button type="button" onClick={() => handleOrdersViewChange(false)} className={`rounded-full px-4 py-2 text-sm font-bold ${!showHiddenOrders ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}>All Orders</button>
                        <button type="button" onClick={() => handleOrdersViewChange(true)} className={`rounded-full px-4 py-2 text-sm font-bold ${showHiddenOrders ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}>Hidden Orders ({hiddenOrdersCount})</button>
                        {reviewFeedback && <p className="rounded-full bg-sky-50 px-4 py-2 text-sm text-sky-700">{reviewFeedback}</p>}
                        {disputeFeedback && <p className="rounded-full bg-rose-50 px-4 py-2 text-sm text-rose-700">{disputeFeedback}</p>}
                      </div>
                    </div>

                    {orderNavigationMessage && <p role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">{orderNavigationMessage}</p>}

                    {ordersLoading ? (
                      <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-600">Loading your orders...</div>
                    ) : ordersError ? (
                      <div role="alert" className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-center text-sm font-semibold text-rose-700">
                        <p>{ordersError}</p>
                        <button
                          type="button"
                          onClick={() => loadOrdersView(showHiddenOrders)}
                          className="mt-4 rounded-full border border-rose-300 bg-white px-5 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100"
                        >
                          Retry
                        </button>
                      </div>
                    ) : orders.length === 0 ? (
                      <div className="rounded-[28px] border border-dashed border-emerald-200 bg-emerald-50 p-8 text-center">
                        <p className="text-lg font-semibold text-slate-900">{showHiddenOrders ? 'No hidden orders' : 'No orders yet'}</p>
                        <p className="mt-2 text-sm text-slate-600">{showHiddenOrders ? 'Orders you hide will appear here.' : 'Your purchases will appear here once you place an order.'}</p>
                        {!showHiddenOrders && <button
                          type="button"
                          onClick={() => {
                            setBuyerTab('search');
                            setActiveTab('buyer');
                          }}
                          className="btn-primary mt-5 inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold shadow-sm transition"
                        >
                          Browse Marketplace
                        </button>}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {orders.map((order) => {
                          const orderStatus = normalizeOrderStatus(order.fulfillment_status || order.status || 'Processing');
                          const orderStatusLabel = orderStatus === 'Pending' ? 'Legacy order' : orderStatus;
                          const paymentStatus = normalizePaymentStatus(order.payment_status || order.paymentStatus || order.pay_status || 'Pending');
                          const sellerId = order.seller_id || order.sellerId || order.seller;
                          const sellerName = order.seller_name || order.sellerName || order.seller || 'Campus Seller';
                          const refunded = isOrderRefunded(order);

                          return (
                            <div key={order.id} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  {order.image && <img src={resolveImageUrl(order.image)} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="mb-3 h-16 w-16 rounded-xl object-cover" />}
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Order #{order.id}</p>
                                  <h4 className="mt-2 text-xl font-bold text-slate-900">{order.title || order.product_title || 'Campus Purchase'}</h4>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${orderStatus === 'Disputed' || refunded ? 'bg-rose-100 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>{orderStatusLabel}</span>
                                  <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${refunded ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{paymentStatus}</span>
                                  <button type="button" onClick={() => { setSelectedOrder({ id: order.id }); fetchOrderDetails(order.id); }} className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">View Order</button>
                                  <button type="button" onClick={() => handleOrderVisibility(order)} className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">{showHiddenOrders ? 'Unhide' : 'Hide'}</button>
                                </div>
                              </div>

                              {refunded && (
                                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                                  <p className="font-black">Refund confirmation</p>
                                  <p className="mt-1 font-bold">{formatETB(order.refund_amount ?? order.total_paid ?? (Number(order.price || 0) * Number(order.quantity || 1) + Number(order.fees || 0)))} refunded to your wallet.</p>
                                  <p className="mt-1">Refunded on: {order.refund_date ? new Date(order.refund_date).toLocaleString() : 'Date unavailable'}</p>
                                  <p className="mt-1 break-all">Refund reference: {order.refund_reference || `REFUND-${order.id}`}</p>
                                </div>
                              )}

                              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Price</p>
                                  <p className="mt-2 text-xl font-bold text-slate-900">{formatETB(normalizePrice(order.price))}</p>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Seller</p>
                                  <button
                                    type="button"
                                    onClick={() => handleChatInitiate(sellerId, sellerName)}
                                    className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-200"
                                  >
                                    {sellerName}
                                  </button>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Fulfillment Status</p>
                                  <p className="mt-2 text-base font-bold text-slate-900">{orderStatusLabel}</p>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payment Status</p>
                                  <p className="mt-2 text-base font-bold text-slate-900">{paymentStatus}</p>
                                </div>
                              </div>

                              {orderStatus === 'Completed' && (
                                <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xl font-bold text-white" aria-hidden="true">✓</span>
                                  <p className="text-base font-bold">Verified Transaction</p>
                                </div>
                              )}

                              {orderStatus === 'Disputed' && (
                                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                                  <p className="text-sm font-semibold text-rose-800">An Admin is reviewing this case.</p>
                                  <p className="mt-1 text-sm text-rose-700">The seller's received amount is frozen until resolution.</p>
                                </div>
                              )}

                              {orderStatus === 'Completed' && (
                                <div className="mt-6 rounded-[24px] border border-emerald-200 bg-emerald-50 p-4">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <h5 className="text-lg font-bold text-slate-900">Rate this purchase</h5>
                                    {order.reviewed ? (
                                      <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700">Reviewed</span>
                                    ) : (
                                      <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Awaiting review</span>
                                    )}
                                  </div>

                                  {!order.reviewed ? (
                                    <div className="mt-4 space-y-4">
                                      <div className="flex items-center gap-3">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                          <button
                                            key={`${order.id}-star-${star}`}
                                            type="button"
                                            onClick={() => setReviewRating(star)}
                                            className={`text-2xl transition ${star <= reviewRating ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}`}
                                            aria-label={`Rate ${star} out of 5`}
                                          >
                                            ★
                                          </button>
                                        ))}
                                        <span className="text-sm font-semibold text-slate-700">{reviewRating}/5</span>
                                      </div>

                                      <textarea
                                        rows="3"
                                        value={reviewComment}
                                        onChange={(e) => setReviewComment(e.target.value)}
                                        placeholder="Tell us about the item quality, seller experience, and pickup process..."
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none"
                                      />

                                      <button
                                        type="button"
                                        onClick={() => handleSubmitReview(order.id)}
                                        disabled={isSubmittingReview}
                                        className="btn-primary inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition"
                                      >
                                        {isSubmittingReview ? 'Submitting...' : 'Submit Review'}
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="mt-4 text-sm text-emerald-700">Your review has already been submitted for this order.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {buyerTab === 'reports-support' && (
                  <ReportsInbox
                    accessToken={getStudentSessionToken()}
                    onInvalidReportLink={onDashboardLinkInvalid}
                  />
                )}

                {/* Sub-tab 4: Payments */}
                {buyerTab === 'payments' && (
                  <div className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                          <Wallet size={22} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wallet Balance</p>
                          <p className="mt-1 truncate text-xl font-bold text-slate-900">{formatETB(currentWalletBalance)}</p>
                          {heldWalletBalance > 0 && <p className="mt-1 text-xs text-amber-700">{formatETB(heldWalletBalance)} held</p>}
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-emerald-100 bg-white p-5 shadow-sm">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                          <ArrowDownLeft size={22} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Deposited</p>
                          <p className="mt-1 truncate text-xl font-bold text-emerald-700">+{formatETB(totalDeposited)}</p>
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-rose-100 bg-white p-5 shadow-sm">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-700">
                          <ArrowUpRight size={22} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Spent</p>
                          <p className="mt-1 truncate text-xl font-bold text-rose-700">-{formatETB(totalSpent)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                      <div className="min-w-0 rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-bold text-slate-900">Transactions &amp; Wallet</h3>
                            <p className="mt-1 text-sm text-slate-500">Review your wallet activity and payment history.</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{transactionsForView.length} records</span>
                        </div>

                        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex flex-wrap gap-2" aria-label="Filter transactions">
                            {[
                              { id: 'all', label: 'All' },
                              { id: 'deposits', label: 'Deposits' },
                              { id: 'payments', label: 'Payments' },
                              { id: 'withdrawals', label: 'Withdrawals' },
                              { id: 'hidden', label: hiddenTransactionsCount > 0 ? `Hidden (${hiddenTransactionsCount})` : 'Hidden' },
                            ].map((filter) => (
                              <button
                                key={filter.id}
                                type="button"
                                onClick={() => {
                                  setTransactionFilter(filter.id);
                                  if (filter.id === 'hidden') loadHiddenTransactions();
                                  else setTransactionVisibilityError('');
                                }}
                                aria-pressed={transactionFilter === filter.id}
                                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${transactionFilter === filter.id ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                              >
                                {filter.label}
                              </button>
                            ))}
                          </div>
                          <label className="relative block w-full lg:max-w-xs">
                            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="search"
                              value={transactionSearch}
                              onChange={(event) => setTransactionSearch(event.target.value)}
                              placeholder="Search description or reference"
                              aria-label="Search transactions by description or reference"
                              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white"
                            />
                          </label>
                        </div>

                        {transactionVisibilityError && (
                          <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            {transactionVisibilityError}
                          </p>
                        )}

                        <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
                          {hiddenTransactionsLoading && transactionFilter === 'hidden' ? (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Loading hidden transactions...</div>
                          ) : filteredTransactions.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                              {transactionFilter === 'hidden'
                                ? 'No hidden transactions.'
                                : transactionLedger.length === 0
                                  ? 'No transaction records found. Your wallet deposits and product purchases will appear here.'
                                  : 'No transactions match your filters.'}
                            </div>
                          ) : (
                            filteredTransactions.map((tx) => {
                              const amount = getTransactionAmount(tx);
                              const { sign, colorClass } = getTransactionDirection(tx);
                              const isCredit = sign === '+';
                              const status = normalizePaymentStatus(tx.status);
                              const isPendingTransaction = ['pending', 'processing'].includes(String(tx.status || '').trim().toLowerCase());
                              const isWithdrawal = getTransactionCategory(tx) === 'withdrawals';
                              const isDeposit = getTransactionCategory(tx) === 'deposits';
                              const timestamp = tx.created_at || tx.date;
                              const parsedTimestamp = timestamp ? new Date(timestamp) : null;
                              const timestampLabel = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
                                ? parsedTimestamp.toLocaleString()
                                : timestamp || 'Date unavailable';

                              return (
                                <div key={tx.id || tx.hash || `${tx.label}-${tx.date}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-3 transition hover:border-slate-200 hover:bg-slate-50/60 sm:px-4">
                                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isCredit ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                    {isCredit
                                      ? <ArrowDownLeft size={18} aria-hidden="true" />
                                      : <ArrowUpRight size={18} aria-hidden="true" />}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                      <p className="max-w-full truncate text-sm font-semibold text-slate-900">{getTransactionLabel(tx)}</p>
                                      {tx.test_mode && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-800">TEST</span>}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                      <span>{timestampLabel}</span>
                                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${getTransactionStatusClass(status)}`}>{status}</span>
                                      {tx.hash && (
                                        <span className="inline-flex min-w-0 items-center gap-1">
                                          <span className="max-w-32 truncate font-mono" title={tx.hash}>{tx.hash}</span>
                                          <button
                                            type="button"
                                            onClick={() => copyTransactionHash(tx.hash)}
                                            title={copiedTransactionHash === tx.hash ? 'Copied' : 'Copy transaction hash'}
                                            aria-label={copiedTransactionHash === tx.hash ? 'Transaction hash copied' : 'Copy transaction hash'}
                                            className="rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                                          >
                                            {copiedTransactionHash === tx.hash
                                              ? <Check size={13} aria-hidden="true" />
                                              : <Copy size={13} aria-hidden="true" />}
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                    {isPendingTransaction && (isWithdrawal || isDeposit) && (
                                      <button
                                        type="button"
                                        onClick={() => isWithdrawal ? handlePayoutStatusCheck(tx) : handleDepositStatusCheck(tx)}
                                        disabled={payoutStatusCheckId === (tx.id || tx.hash)}
                                        className="mt-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {payoutStatusCheckId === (tx.id || tx.hash) ? 'Checking status...' : isDeposit ? 'Check Deposit Status' : 'Check Payout Status'}
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-2">
                                    <span className={`text-sm font-bold sm:text-base ${colorClass}`}>
                                      {sign}{formatETB(Math.abs(amount))}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleTransactionVisibility(tx)}
                                      disabled={transactionVisibilityActionId === tx.id}
                                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {transactionVisibilityActionId === tx.id
                                        ? 'Saving...'
                                        : transactionFilter === 'hidden' ? 'Unhide' : 'Hide'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h3 className="text-xl font-bold text-slate-900 border-b pb-2 mb-0 flex-1">Wallet Actions</h3>
                          <button
                            type="button"
                            disabled={withdrawLoading || withdrawalEntryBlocked}
                            title={activeWithdrawal ? 'A payout is currently processing' : currentWalletBalance <= 0 ? 'Add funds before withdrawing' : 'Withdraw funds'}
                            onClick={() => setShowWithdrawModal(true)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            Withdraw Funds
                          </button>
                        </div>
                        {activeWithdrawal && (
                          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
                            <span>You have a payout currently processing. You can request a new withdrawal once it completes.</span>
                            <button type="button" onClick={refreshWithdrawalStatus} disabled={withdrawalStatusLoading} className="font-bold text-amber-900 underline underline-offset-2 disabled:opacity-60">
                              {withdrawalStatusLoading ? 'Refreshing...' : 'Refresh status'}
                            </button>
                          </div>
                        )}

                        <div className="space-y-5">
                          <div>
                            <h3 className="text-xl font-bold text-slate-900 border-b pb-2 mb-4">Deposit via Chapa</h3>
                            <p className="text-sm text-slate-500">Top up your wallet securely through Chapa checkout.</p>
                            {paymentVerificationState === 'confirming' && <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">Confirming your payment...</p>}
                            {paymentVerificationState === 'pending' && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">Your payment is still being confirmed...</p>}
                            {paymentVerificationState === 'pending_timeout' && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">We're still confirming — check back shortly.</p>}
                            <form onSubmit={handleDepositSubmit} className="mt-5 space-y-4">
                              <div>
                                <label className="block text-sm font-semibold text-slate-700">Amount (ETB)</label>
                                <input
                                  type="number"
                                  min="1"
                                  step="0.01"
                                  value={depositAmount}
                                  onChange={(e) => setDepositAmount(e.target.value)}
                                  placeholder="Enter amount to deposit"
                                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none transition"
                                />
                              </div>
                              {depositError && <p className="text-sm text-red-600">{depositError}</p>}
                              <button
                                type="submit"
                                disabled={depositLoading || !isValidDepositAmount}
                                className="w-full rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-500 disabled:opacity-60"
                              >
                                {depositLoading ? 'Redirecting to Chapa…' : 'Deposit via Chapa'}
                              </button>
                            </form>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3. ገጽ 3፦ የሻጭ ሰሌዳ - አዲስ ምርት መለጠፊያ (Seller Hub) */}
            {activeTab === 'seller' && dashboardLink?.section && (
              <SellerModerationNotices
                section={dashboardLink.section}
                itemId={dashboardLink.itemId}
                accessToken={getStudentSessionToken()}
                onInvalidLink={onDashboardLinkInvalid}
              />
            )}
            {activeTab === 'seller' && !dashboardLink?.section && (
              <SellerOperationsCenter
                user={user}
                navigationRequest={sellerNavigationRequest}
                sellerData={sellerData}
                onRefreshOrders={fetchSellerDashboardData}
                myListings={myListings}
                onPayoutAccountUpdated={handlePayoutAccountUpdated}
                onNavigate={(target) => {
                  if (target === 'payout-settings') {
                    setActiveTab('settings');
                    setSettingsTab('payout');
                    return;
                  }
                  onTabChange?.(target, target === 'seller' ? 'seller' : target === 'buyer' ? 'buyer' : dashboardMode);
                }}
                onViewProduct={handleViewProductFromSellerHub}
                onDeleteProduct={handleDeleteProduct}
                sellerDashboardData={sellerDashboardData}
                onEditProduct={handleEditProduct}
                onTogglePause={handleTogglePause}
                onMarkAsSold={handleMarkAsSold}
                onPaymentHistory={() => {
                  setActiveTab('buyer');
                  setBuyerTab('payments');
                }}
                openOrderId={pendingSellerOrderId}
                onOpenSellerOrder={openSellerOrder}
                onBackToSellerOrders={backToSellerOrders}
                onOpenSellerChat={openSellerChat}
              />
            )}

            {showAiAdvisorFab && (
              <div className="fixed bottom-6 right-6 z-50">
                {isAiAdvisorOpen && (
                  <div className="fixed bottom-24 right-6 z-50 flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-fade-in">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50 to-blue-50 px-4 py-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-sky-600">Academic Defense</p>
                        <h3 className="mt-1 text-sm font-bold text-slate-900">AI Advisor</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsAiAdvisorOpen(false)}
                        className="rounded-full bg-white p-2 text-slate-500 transition hover:bg-slate-100"
                        aria-label="Close AI advisor"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto bg-slate-50 p-3">
                      <div ref={aiScrollRef} className="space-y-3">
                        {chatHistory.length === 0 && !isTyping ? (
                          <div className="flex h-full min-h-[320px] items-center justify-center">
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-slate-500 shadow-sm">
                              <p className="text-sm font-medium text-slate-600">Ask about textbooks, gadgets, or campus deals.</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            {chatHistory.map((message, index) => {
                              const productMatches = message.role === 'assistant' ? parseInlineProductCards(message.text) : [];
                              const renderedText = productMatches.length ? message.text.replace(/\[PRODUCT:[^\]]+\]/g, '') : message.text;

                              return (
                                <div key={`${message.role}-${index}`} className={`flex ${message.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm ${message.isError ? 'border border-red-200 bg-red-50 text-red-700' : message.role === 'assistant' ? 'border border-slate-200 bg-white text-slate-800' : 'bg-blue-600 text-white'}`}>
                                    {renderedText && <div className="whitespace-pre-wrap font-medium">{renderedText}</div>}
                                    {message.provider && (
                                      <p className="mt-1 text-[10px] font-medium capitalize text-slate-400">{message.provider}</p>
                                    )}
                                    {productMatches.length > 0 && (
                                      <div className="mt-2 space-y-2">
                                        {productMatches.map((product, pIdx) => (
                                          <div key={`${product.id}-${pIdx}`} className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-slate-800">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">AI pick</p>
                                            <p className="mt-1 text-xs font-bold">{product.title}</p>
                                            <p className="mt-1 text-[10px] font-semibold text-emerald-700">{product.price} ETB</p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {isTyping && (
                              <div className="flex justify-start">
                                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500 [animation-delay:150ms]" />
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500 [animation-delay:300ms]" />
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-sky-300 focus-within:bg-white">
                        <input
                          type="text"
                          value={aiInput}
                          maxLength={500}
                          onChange={(e) => setAiInput(e.target.value)}
                          placeholder="Ask the advisor..."
                          className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAiSend();
                            }
                          }}
                        />
                        {isTyping ? (
                          <button
                            type="button"
                            onClick={handleStopAiGeneration}
                            className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAiSend()}
                            disabled={!aiInput.trim()}
                            className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Send
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setIsAiAdvisorOpen((prev) => !prev)}
                  className="btn-primary fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition"
                  aria-label="Toggle AI Advisor"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m-7 5h10a3 3 0 003-3V7a3 3 0 00-3-3H6a3 3 0 00-3 3v9a3 3 0 003 3z" />
                  </svg>
                </button>
              </div>
            )}

            {activeTab === 'messages' && (
              <div
                ref={messagesViewRef}
                data-dashboard-view="messages"
                style={{
                  height: messagesViewHeight === null ? undefined : `${messagesViewHeight}px`,
                  minHeight: messagesViewHeight === null ? undefined : `${Math.min(420, messagesViewHeight)}px`,
                }}
                className="mx-auto flex min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden px-0 sm:px-2"
              >
                <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 sm:rounded-[32px] lg:flex-row">
                  <aside className={`h-full min-h-0 w-full min-w-0 max-w-full shrink-0 flex-col border-b border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6 lg:w-80 lg:border-b-0 lg:border-r xl:w-96 ${mobileChatView === 'list' ? 'flex' : 'hidden'} lg:flex`}>
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Peer chat</p>
                          <div className="mt-1 flex items-center gap-3">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Messages</h3>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAddChatModal(true)}
                          disabled={Boolean(initialMessagesProductId)}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-600 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          aria-label="New chat"
                        >
                          +
                        </button>
                      </div>

                      {initialMessagesProductId && (
                        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                          <span>{t('productDetails.owner.inquiriesForProduct').replace('{id}', String(initialMessagesProductId))}</span>
                          <button type="button" onClick={onClearProductInquiryFilter} className="shrink-0 underline underline-offset-2">{t('productDetails.owner.clearFilter')}</button>
                        </div>
                      )}
                      {conversationLoadError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{conversationLoadError}</p>}
                      {initialMessagesProductId && !conversationsLoaded && <p className="mt-3 text-sm text-slate-500">Loading product inquiries…</p>}

                      <label className="relative mt-4 block">
                        <span className="sr-only">Search conversations</span>
                        <input
                          type="search"
                          value={conversationSearch}
                          onChange={(event) => setConversationSearch(event.target.value)}
                          placeholder="Search conversations..."
                          className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">⌕</span>
                      </label>

                      <div className="messages-scroll-area mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain">
                        {filteredConversations.length > 0 ? filteredConversations.map((conversation) => {
                          const isActive = conversation.id === activeConversationId;
                          const participantOnline = conversation.status === 'online';

                          return (
                            <button
                              key={conversation.id}
                              type="button"
                              onClick={() => selectConversation(conversation.id)}
                              className={`relative flex w-full min-w-0 items-center gap-3 rounded-[24px] border px-3 py-3 text-left transition ${isActive ? 'border-sky-200 bg-sky-50 shadow-sm dark:border-sky-800 dark:bg-sky-950/40' : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800'}`}
                            >
                              <div className="relative shrink-0">
                                <img
                                  src={getStudentAvatar(conversation.studentId || conversation.student_id || String(conversation.id || '').replace(/^conv-/, ''))}
                                  alt={conversation.name}
                                  onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                                  className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white"
                                />
                                <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white ${participantOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-white">{conversation.name}</p>
                                  <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-400">{formatConversationTimestamp(conversation.timestamp, language)}</span>
                                </div>
                                <p className="mt-1 min-w-0 truncate pr-7 text-xs text-slate-500 dark:text-slate-400">{conversation.lastMessage}</p>
                              </div>
                              {Number(conversation.unread) > 0 && (
                                <span className="absolute right-3 top-1/2 inline-flex h-5 min-w-[20px] -translate-y-1/2 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white ring-2 ring-white">
                                  {conversation.unread}
                                </span>
                              )}
                            </button>
                          );
                        }) : (
                          <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No conversations found.</p>
                        )}
                      </div>
                    </div>
                  </aside>

                  <section className={`relative h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50/25 p-3 dark:bg-slate-950/30 sm:p-6 ${mobileChatView === 'chat' ? 'flex' : 'hidden'} lg:flex`}>
                    <header className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-slate-200 pb-4 dark:border-slate-700">
                      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <button type="button" onClick={showConversationList} className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" aria-label="Back to conversations">←</button>
                        <div className="relative shrink-0">
                          <img
                            src={getStudentAvatar(activeConversation?.studentId || activeConversation?.student_id || String(activeConversation?.id || '').replace(/^conv-/, ''))}
                            alt={activeConversation?.name || 'Student'}
                            onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                            className="h-11 w-11 rounded-full object-cover"
                          />
                          <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${activeConversation?.status === 'online' ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-base font-bold text-slate-900 dark:text-white">{activeConversation?.name || 'Student'}</p>
                            {peerIsTyping ? (
                              <p className="text-xs font-semibold text-sky-600 animate-pulse">{activeConversation?.name || 'Student'} is typing...</p>
                            ) : (
                              <p className="text-xs text-slate-500 dark:text-slate-400">{activeConversation?.status === 'online' ? '🟢 Online' : '⚪ Offline'}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowChatDropdown((visible) => !visible)}
                          className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          aria-label="Conversation actions"
                        >
                          ⋮
                        </button>
                        {showChatDropdown && (
                          <div className="absolute right-0 top-12 z-20 min-w-[180px] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                            <button type="button" onClick={() => handleChatMenuAction('profile')} className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">View Profile</button>
                            <button type="button" onClick={() => handleChatMenuAction('product')} className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">View Product</button>
                            <button type="button" onClick={() => handleChatMenuAction('report')} className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">Report User</button>
                            {!activeConversation?.blocked_me && (
                              <button
                                type="button"
                                disabled={isUpdatingConversationBlock}
                                onClick={() => handleChatMenuAction(activeConversation?.blocked_by_me ? 'unblock' : 'block')}
                                className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                              >
                                {activeConversation?.blocked_by_me ? t('messages.unblockUser') : t('messages.blockUser')}
                              </button>
                            )}
                            <button type="button" onClick={() => handleChatMenuAction('delete')} className="w-full rounded-xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40">Delete Conversation</button>
                          </div>
                        )}
                      </div>
                    </header>

                    <div ref={messagesContainerRef} onScroll={updateAutoScrollPreference} className="messages-scroll-area flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-gradient-to-b from-slate-50 to-white px-2 py-4 dark:from-slate-900 dark:to-slate-950">
                      {visibleChatMessages.map((message) => {
                        const isOwnMessage = message.sender_id
                          ? String(message.sender_id) === String(user?.studentId)
                          : message.sender === 'me';
                        const messageDate = new Date(message.created_at || message.time);
                        const messageTime = Number.isNaN(messageDate.getTime())
                          ? message.time || 'Unknown time'
                          : messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const productDetail = message.productId ? productDetails[message.productId] : null;
                        const productUnavailable = productDetail?.unavailable === true;
                        const product = productUnavailable ? null : productDetail;
                        const parentMessage = message.reply_to_id
                          ? visibleChatMessages.find((candidate) => String(candidate.id) === String(message.reply_to_id))
                          : null;

                        return (
                          <div key={message.id} className="group">
                            <div className={`mb-4 flex min-w-0 flex-wrap items-end gap-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                              {!isOwnMessage && (
                                <img src={getStudentAvatar(message.sender_id || activeConversation?.studentId)} alt={activeConversation?.name || 'Student'} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="order-1 h-8 w-8 shrink-0 rounded-full object-cover sm:order-none" />
                              )}
                              <div className={`${isOwnMessage ? 'order-1' : 'order-2'} min-w-0 break-words shadow-sm sm:order-none ${message.attachment_type === 'image' && message.attachment_url ? 'w-fit max-w-[260px] overflow-hidden rounded-2xl p-1 sm:max-w-[320px]' : 'max-w-[85%] rounded-[22px] px-4 py-3 sm:max-w-[70%]'} ${isOwnMessage ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>
                                {parentMessage && (
                                  <div className={`mb-2 border-l-2 px-2 py-1 text-xs ${isOwnMessage ? 'border-blue-200 bg-blue-700/50 text-blue-100' : 'border-slate-400 bg-slate-300/60 text-slate-600'}`}>
                                    <p className="font-semibold">{parentMessage.sender_id === user?.studentId ? 'You' : activeConversation?.name || 'Student'}</p>
                                    <p className="truncate opacity-80">{parentMessage.text || '[Attachment]'}</p>
                                  </div>
                                )}
                                {message.attachment_type === 'image' && message.attachment_url && (
                                  <div className="relative w-full">
                                    <img
                                      src={resolveImageUrl(message.attachment_url)}
                                      alt="Open chat attachment"
                                      loading="lazy"
                                      onClick={() => setLightboxImage(resolveImageUrl(message.attachment_url))}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                          event.preventDefault();
                                          setLightboxImage(resolveImageUrl(message.attachment_url));
                                        }
                                      }}
                                      onLoad={() => {
                                        if (shouldAutoScrollRef.current) {
                                          window.requestAnimationFrame(() => scrollMessagesToLatest());
                                        }
                                      }}
                                      onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                                      role="button"
                                      tabIndex={0}
                                      className="block h-auto w-full max-h-[240px] aspect-[4/3] cursor-pointer rounded-xl object-cover sm:max-h-[300px]"
                                    />
                                    <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white">
                                      <span>{messageTime}</span>
                                      {isOwnMessage && <span>{message.is_read ? '✓✓' : '✓'}</span>}
                                    </div>
                                  </div>
                                )}
                                {message.attachment_type === 'audio' && message.attachment_url && (
                                  <audio src={message.attachment_url} controls className="mb-2 max-w-full" />
                                )}
                                {message.attachment_type === 'video' && message.attachment_url && (
                                  <video src={message.attachment_url} controls className="mb-2 max-h-64 max-w-full rounded-2xl" />
                                )}
                                {editingMessageId === message.id ? (
                                  <div className="flex min-w-0 items-end gap-2">
                                    <textarea
                                      autoFocus
                                      value={editingMessageContent}
                                      maxLength={MAX_CHAT_MESSAGE_LENGTH}
                                      onChange={(event) => setEditingMessageContent(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          handleCancelEditMessage();
                                        } else if (event.key === 'Enter' && !event.shiftKey) {
                                          event.preventDefault();
                                          handleSaveEditMessage(message);
                                        }
                                      }}
                                      className="min-h-10 w-full min-w-0 resize-y break-words rounded-md border border-blue-200 bg-white/95 px-2 py-1 text-sm leading-5 text-slate-900 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                                      aria-label="Edit message"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEditMessage(message)}
                                      disabled={!editingMessageContent.trim() || editingMessageContent.trim() === message.text || editingMessageContent.trim().length > MAX_CHAT_MESSAGE_LENGTH}
                                      className="shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                      aria-label="Save edited message"
                                      title="Save"
                                    ><Check size={16} /></button>
                                    <button type="button" onClick={handleCancelEditMessage} className="shrink-0 cursor-pointer" aria-label="Cancel editing message" title="Cancel"><X size={16} /></button>
                                  </div>
                                ) : (
                                  message.text && message.text !== '[Attachment]' && <p className="break-words text-sm leading-6">{message.text}</p>
                                )}
                                {!(message.attachment_type === 'image' && message.attachment_url) && (
                                  <div className={`mt-2 flex items-center gap-1 text-[10px] ${isOwnMessage ? 'text-blue-100' : 'text-slate-500'}`}>
                                    <span>{messageTime}</span>
                                    {message.edited && <span>edited</span>}
                                    {isOwnMessage && <span>{message.is_read ? '✓✓' : '✓'}</span>}
                                  </div>
                                )}
                              </div>
                              <div className={`order-3 flex w-full shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 sm:text-xs ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                                {isOwnMessage ? (
                                  <>
                                    {(() => {
                                      const sentAt = new Date(message.created_at || message.time).getTime();
                                      const canEdit = !message.attachment_url
                                        && !message.attachment_type
                                        && !message.productId
                                        && message.text
                                        && message.text !== '[Attachment]'
                                        && !message.deleted
                                        && !message.is_deleted
                                        && Number.isFinite(sentAt)
                                        && Date.now() - sentAt < EDIT_WINDOW_MINUTES * 60 * 1000;
                                      return canEdit && editingMessageId !== message.id ? (
                                        <button type="button" onClick={() => handleStartEditMessage(message)} className="inline-flex cursor-pointer items-center gap-1 hover:text-sky-600"><Pencil size={12} /> Edit</button>
                                      ) : null;
                                    })()}
                                    <button type="button" onClick={() => handleForwardClick(message)} className="cursor-pointer hover:text-sky-600">➡️ Forward</button>
                                    <button type="button" onClick={() => handleDeleteMessage(message.id)} className="cursor-pointer hover:text-rose-600">🗑️ Delete</button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" onClick={() => handleReplyClick(message)} className="cursor-pointer hover:text-sky-600">↩️ Reply</button>
                                    <button type="button" onClick={() => handleForwardClick(message)} className="cursor-pointer hover:text-sky-600">➡️ Forward</button>
                                  </>
                                )}
                              </div>
                              {isOwnMessage && (
                                <img src={getStudentAvatar(user?.studentId)} alt={user?.name || 'You'} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="order-2 h-8 w-8 shrink-0 rounded-full object-cover sm:order-none" />
                              )}
                            </div>

                            {product && (
                              <div className={`mb-4 flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                                <div className="w-full max-w-full rounded-[24px] border border-slate-200 bg-white p-3 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:max-w-xs">
                                  {product.image && <img src={resolveImageUrl(product.image)} alt={product.title} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="mb-2 block h-auto max-h-[160px] w-full max-w-full rounded-2xl object-cover" />}
                                  <p className="mt-2 break-words text-sm font-semibold">{product.title}</p>
                                  <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{product.category || 'Campus marketplace item'}</p>
                                  <div className="mt-2 flex items-center justify-between gap-3">
                                    <span className="text-sm font-bold text-emerald-600">{product.price} ETB</span>
                                    <button
                                      type="button"
                                      onClick={() => handleViewProductFromChat(message.productId)}
                                      className="btn-primary rounded-full px-3 py-1.5 text-[10px] font-semibold"
                                    >
                                      View Product
                                    </button>
                                  </div>
                                  {canPayProductFromChat(product) && (
                                    <button
                                      type="button"
                                      onClick={() => handlePayProductFromChat(message.productId)}
                                      className="mt-2 w-full rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                                    >
                                      Pay with wallet
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {activeConversation?.product && (
                        <div className="order-first mb-5 max-w-full rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                          <div className="flex min-w-0 items-center gap-3">
                            <img src={resolveImageUrl(activeConversation.product.image)} alt={activeConversation.product.title} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-slate-900">{activeConversation.product.title}</p>
                              <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{activeConversation.product.category || productDetails[activeConversation.product.id]?.category || 'Campus marketplace item'}</p>
                              <p className="mt-1 text-sm font-bold text-emerald-600">{Number(activeConversation.product.price).toLocaleString('en-US')} ETB</p>
                            </div>
                            <button type="button" onClick={() => handleViewProductFromChat(activeConversation.product.id)} className="btn-primary shrink-0 rounded-full px-3 py-2 text-xs font-semibold">View Product</button>
                          </div>
                          {canPayProductFromChat({
                            ...activeConversation.product,
                            ...(productDetails[activeConversation.product.id] || {}),
                          }) && (
                              <button
                                type="button"
                                onClick={() => handlePayProductFromChat(activeConversation.product.id)}
                                className="mt-3 w-full rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                              >
                                Pay with wallet
                              </button>
                            )}
                        </div>
                      )}
                    </div>

                    <div className="sticky bottom-0 z-10 w-full shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900">
                      {visibleChatMessages.some((message) => message.productId && productDetails[message.productId]?.unavailable) && (
                        <p className="mb-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300" role="status">
                          This product is no longer available.
                        </p>
                      )}
                      {isActiveConversationBlocked && (
                        <p className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" role="status">
                          {t('messages.conversationBlocked')}
                        </p>
                      )}
                      <div className="space-y-2">
                        {replyToMessage && (
                          <div className="flex items-center gap-2 border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-sm text-slate-700">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-sky-700">Replying to...</p>
                              <p className="truncate text-xs text-slate-600">{replyToMessage.text || '[Attachment]'}</p>
                            </div>
                            <button type="button" onClick={() => setReplyToMessage(null)} className="shrink-0 text-slate-400 hover:text-slate-700" aria-label="Cancel reply">✕</button>
                          </div>
                        )}
                        <div className="flex min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-2 shadow-sm focus-within:border-sky-300 focus-within:bg-white dark:border-slate-700 dark:bg-slate-800 dark:focus-within:bg-slate-900 sm:gap-3 sm:px-3">
                          <label className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-sm ${isActiveConversationBlocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-100'}`} aria-label="Attach file">
                            📎
                            <input ref={attachmentInputRef} type="file" accept="image/*,audio/*,video/*" onChange={handleFileAttachmentSelect} disabled={isActiveConversationBlocked} className="sr-only" />
                          </label>
                          <button
                            type="button"
                            onClick={isVoiceRecording ? handleStopVoiceRecording : handleStartVoiceRecording}
                            disabled={isActiveConversationBlocked}
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${isVoiceRecording ? 'bg-rose-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                            aria-label={isVoiceRecording ? 'Stop voice recording' : 'Record voice note'}
                          >
                            {isVoiceRecording ? '■' : '🎙️'}
                          </button>
                          <div className="relative shrink-0">
                            <button type="button" onClick={() => setShowEmojiPicker((visible) => !visible)} disabled={isActiveConversationBlocked} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Open emoji picker">😊</button>
                            {showEmojiPicker && (
                              <div className="absolute bottom-12 left-0 z-20 flex gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                                {['😀', '😂', '👍', '❤️', '🎉', '🙏'].map((emoji) => (
                                  <button key={emoji} type="button" onClick={() => { setTypingInput((value) => `${value}${emoji}`); setShowEmojiPicker(false); }} className="rounded-lg p-1.5 text-lg hover:bg-slate-100" aria-label={`Insert ${emoji}`}>{emoji}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          <input
                            type="text"
                            value={typingInput}
                            maxLength={MAX_CHAT_MESSAGE_LENGTH}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setTypingInput(nextValue);
                              const receiverId = activeConversation?.studentId || (String(activeConversation?.id || '').replace(/^conv-/, '') || null);
                              if (receiverId && socketRef.current?.readyState === WebSocket.OPEN) {
                                socketRef.current.send(JSON.stringify({ type: 'typing', receiver_id: receiverId, is_typing: Boolean(nextValue.trim()) }));
                              }
                            }}
                            onBlur={() => {
                              const receiverId = activeConversation?.studentId || (String(activeConversation?.id || '').replace(/^conv-/, '') || null);
                              if (receiverId && socketRef.current?.readyState === WebSocket.OPEN) {
                                socketRef.current.send(JSON.stringify({ type: 'typing', receiver_id: receiverId, is_typing: false }));
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                sendChatMessage();
                              }
                            }}
                            disabled={isActiveConversationBlocked}
                            placeholder={isActiveConversationBlocked ? t('messages.messagingDisabled') : t('messages.typeMessage')}
                            className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-white"
                          />
                          <button type="button" onClick={sendChatMessage} disabled={isActiveConversationBlocked || !typingInput.trim()} className="btn-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold shadow-sm disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send message">➤</button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {showProfileDetailsModal && activeConversation && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-details-title">
                <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <img src={getStudentAvatar(activeConversation.studentId)} alt={activeConversation.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Verified student</p>
                        <h3 id="profile-details-title" className="mt-1 truncate text-xl font-bold text-slate-900">{activeConversation.name}</h3>
                      </div>
                    </div>
                    <button type="button" onClick={() => setShowProfileDetailsModal(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close profile details">✕</button>
                  </div>
                  <dl className="mt-5 space-y-3">
                    <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Full Name</dt><dd className="text-right text-sm font-semibold text-slate-900">{activeConversation.name || 'Not provided'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">College</dt><dd className="max-w-[65%] text-right text-sm font-semibold text-slate-900">{activeConversation.college || 'Not provided'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Department</dt><dd className="max-w-[65%] text-right text-sm font-semibold text-slate-900">{activeConversation.department || 'Not provided'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Student ID</dt><dd className="text-right text-sm font-semibold text-slate-900">{activeConversation.studentId || 'Not provided'}</dd></div>
                    <div className="flex items-start justify-between gap-4"><dt className="text-sm text-slate-500">Verification Status</dt><dd className="text-right text-sm font-semibold text-emerald-600">Verified campus student</dd></div>
                  </dl>
                  <button type="button" onClick={() => setShowProfileDetailsModal(false)} className="btn-primary mt-6 w-full rounded-full py-3 text-sm font-semibold">Done</button>
                </div>
              </div>
            )}

            {showReportModal && activeConversation && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="report-user-title">
                <form onSubmit={handleReportSubmit} className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-600">Safety report</p>
                      <h3 id="report-user-title" className="mt-1 text-xl font-bold text-slate-900">Submit Complaint</h3>
                      <p className="mt-1 text-sm text-slate-500">Report your concern about {activeConversation.name}.</p>
                    </div>
                    <button type="button" onClick={() => setShowReportModal(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close complaint form">✕</button>
                  </div>
                  <label htmlFor="chat-report-reason" className="mt-5 block text-sm font-semibold text-slate-700">Reason for reporting</label>
                  <textarea
                    id="chat-report-reason"
                    rows="5"
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    placeholder="Explain what happened..."
                    className="mt-2 block w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:bg-white"
                    required
                  />
                  {reportStatus && <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${reportStatus.startsWith('Your') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{reportStatus}</p>}
                  <div className="mt-5 flex gap-3">
                    <button type="button" onClick={() => setShowReportModal(false)} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                    <button type="submit" disabled={isSubmittingReport || !reportReason.trim()} className="flex-1 rounded-full bg-rose-600 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300">{isSubmittingReport ? 'Submitting...' : 'Submit Complaint'}</button>
                  </div>
                </form>
              </div>
            )}

            {showAddChatModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Verified campus students">
                <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-600">New conversation</p>
                      <h3 className="mt-1 text-xl font-black text-slate-950">Verified campus students</h3>
                    </div>
                    <button type="button" onClick={() => setShowAddChatModal(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close student directory">✕</button>
                  </div>
                  <div className="mt-5 max-h-[420px] space-y-2 overflow-y-auto">
                    {conversationsList.map((conversation) => {
                      const studentId = conversation.studentId || conversation.student_id || String(conversation.id || '').replace(/^conv-/, '');
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => {
                            selectConversation(conversation.id);
                            setShowAddChatModal(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left transition hover:border-sky-200 hover:bg-sky-50"
                        >
                          <img src={getStudentAvatar(studentId)} alt={conversation.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-11 w-11 rounded-full object-cover" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-slate-900">{conversation.name}</span>
                            <span className="mt-1 block text-xs text-emerald-600">✓ Verified campus student</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <NotificationCenter
                notifications={safeNotifications}
                unreadCount={unreadCount}
                isMarkingRead={isMarkingRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
                onNavigate={(target) => {
                  const orderLink = parseOrderDashboardLink(target);
                  if (!orderLink) {
                    setActiveTab(target);
                    return;
                  }
                  if (orderLink.tab === 'buyer' && orderLink.section === 'reports-support') {
                    window.history.pushState({}, '', target);
                    setBuyerTab('reports-support');
                    setActiveTab('buyer');
                    return;
                  }
                  if (orderLink.tab === 'seller') {
                    if (orderLink.section === 'orders' && orderLink.orderId) {
                      openSellerOrder(orderLink.orderId);
                    } else {
                      setActiveTab('seller');
                      setPendingSellerOrderId(null);
                    }
                    return;
                  }
                  if (orderLink.tab === 'buyer') setBuyerTab('orders');
                  setActiveTab(orderLink.tab);
                  if (orderLink.section !== 'orders') return;
                  if (orderLink.orderId) {
                    void handleOrderNotification(orderLink.orderId);
                  } else {
                    setBuyerTab('orders');
                    setActiveTab('buyer');
                    setOrderNavigationMessage(orderLink.hasOrderParameter
                      ? 'This order link has an invalid order id. Your orders are shown below.'
                      : 'This link does not include an order id. Your orders are shown below.');
                  }
                }}
                onBuyerOrders={() => {
                  setBuyerTab('orders');
                  setActiveTab('buyer');
                }}
                onOrder={handleOrderNotification}
                onBuyerPayments={() => {
                  setBuyerTab('payments');
                  setActiveTab('buyer');
                }}
                onDispute={handleDisputeNotification}
                onMarkRead={handleMarkNotificationRead}
                onDeleteNotification={handleDeleteNotification}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsCenter
                settingsTab={settingsTab}
                onNotificationPrefsDirtyChange={setIsNotificationPrefsDirty}
                setSettingsTab={setSettingsTab}
                profileForm={profileForm}
                handleProfileFieldChange={handleProfileFieldChange}
                handleProfileSubmit={handleProfileSubmit}
                profileMessage={profileMessage}
                profileSaving={profileSaving}
                user={user}
                avatarUrl={avatarUrl}
                avatarFile={avatarFile}
                setAvatarFile={setAvatarFile}
                handleAvatarUploadSubmit={handleAvatarUploadSubmit}
                avatarUploadMessage={avatarUploadMessage}
                avatarUploading={avatarUploading}
                universityStructure={universityStructure}
                setSellerData={setSellerData}
                currentWalletBalance={currentWalletBalance}
                transactionLedger={transactionLedger}
                onNavigate={setActiveTab}
                onPayoutAccountUpdated={handlePayoutAccountUpdated}
              />
            )}

          </section>
        </main>
      </div>

      {showDepositModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !depositLoading) setShowDepositModal(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-deposit-title"
            className="flex w-full max-w-lg flex-col justify-between rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="wallet-deposit-title" className="text-xl font-bold text-slate-950">Add Funds</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Top up your wallet securely through Chapa checkout.</p>
              </div>
              <button
                type="button"
                aria-label="Close Add Funds"
                disabled={depositLoading}
                onClick={() => setShowDepositModal(false)}
                className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✕
              </button>
            </div>
            {paymentVerificationState === 'confirming' && <p className="mt-4 rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">Confirming your payment...</p>}
            {paymentVerificationState === 'pending' && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">Your payment is still being confirmed...</p>}
            {paymentVerificationState === 'pending_timeout' && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">We're still confirming — check back shortly.</p>}
            <form onSubmit={handleDepositSubmit} className="mt-8 space-y-6">
              <div>
                <label htmlFor="wallet-deposit-amount" className="block text-sm font-semibold text-slate-700">Amount (ETB)</label>
                <input
                  id="wallet-deposit-amount"
                  type="number"
                  min="1"
                  max="1000000"
                  step="0.01"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder="Enter amount to deposit"
                  className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                  autoFocus
                />
              </div>
              {depositError && <p role="alert" className="text-sm text-red-600">{depositError}</p>}
              <button
                type="submit"
                disabled={depositLoading || !isValidDepositAmount}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-bold text-white shadow-md shadow-emerald-500/20 transition-all hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-500 disabled:opacity-60"
              >
                {depositLoading ? 'Redirecting to Chapa…' : 'Continue to Chapa'}
              </button>
            </form>
          </section>
        </div>
      )}

      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4">
          <div className="flex max-h-[90dvh] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Withdraw Funds</h2>
                <p className="mt-1 text-sm text-slate-500">Available balance: {formatETB(currentWalletBalance)}</p>
              </div>
              <button
                type="button"
                disabled={payoutSetupLoading || withdrawLoading}
                onClick={() => {
                  setShowWithdrawModal(false);
                  setPayoutSetupOpen(false);
                  setPayoutSetupAccountNumber('');
                  setWithdrawError('');
                  setWithdrawPin('');
                }}
                className="rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleWithdrawSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
                <div>
                  <label htmlFor="withdraw-amount" className="block text-sm font-semibold text-slate-700">Amount (ETB)</label>
                  <input
                    id="withdraw-amount"
                    type="number"
                    min="100"
                    max={currentWalletBalance}
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                    disabled={payoutAccountLoading || withdrawProviderUnavailable}
                    placeholder="Enter withdrawal amount"
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="withdraw-wallet-pin" className="block text-sm font-semibold text-slate-700">Wallet PIN</label>
                  <input
                    id="withdraw-wallet-pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    autoComplete="off"
                    value={withdrawPin}
                    onChange={(event) => setWithdrawPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    disabled={payoutAccountLoading || withdrawLoading}
                    required
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm tracking-[0.4em] focus:border-emerald-500 focus:bg-white focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">Enter your 4-digit Wallet PIN to authorize this transaction.</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  {payoutAccount ? (
                    <>
                      <span className="font-bold">{t('walletPayout.accountLabel')}</span> {payoutAccount.provider_name || t('walletPayout.providerFallback')} ({payoutAccount.payout_type === 'mobile_wallet' || payoutAccount.payout_type === 'wallet' ? t('walletPayout.mobileMoney') : t('walletPayout.bank')})
                      <span className="ml-1">{payoutAccount.account_number_masked || `****${payoutAccount.account_last4 || ''}`}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setReturnToWithdrawAfterPayoutSetup(true);
                          setShowWithdrawModal(false);
                          setActiveTab('settings');
                          setSettingsTab('payout');
                        }}
                        className="ml-3 font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                      >
                        {t('walletPayout.changeAccount')}
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{payoutAccountLoading ? t('walletPayout.accountLoading') : t('walletPayout.accountRequired')}</span>
                      <button type="button" onClick={() => { setPayoutSetupError(''); setPayoutSetupOpen(true); }} disabled={payoutAccountLoading} className="font-semibold text-emerald-700 underline underline-offset-2 disabled:opacity-50">
                        {t('walletPayout.setupButton')}
                      </button>
                    </div>
                  )}
                </div>

                {payoutSetupOpen && !payoutAccount && (
                  <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4" aria-busy={payoutSetupLoading || payoutSetupBanksLoading}>
                    <h3 className="font-bold text-slate-900">{t('walletPayout.setupTitle')}</h3>
                    <label className="block text-sm font-semibold text-slate-700">
                      {t('walletPayout.method')}
                      <select
                        value={payoutSetupType}
                        onChange={(event) => {
                          const nextState = getPayoutSetupStateAfterMethodChange(event.target.value);
                          setPayoutSetupType(nextState.payoutType);
                          setPayoutSetupBankCode(nextState.providerCode);
                          setPayoutSetupAccountNumber('');
                          setPayoutSetupError('');
                        }}
                        disabled={payoutSetupLoading}
                        className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-normal"
                      >
                        <option value="bank">{t('walletPayout.bank')}</option>
                        <option value="mobile_wallet">{t('walletPayout.mobileMoney')}</option>
                      </select>
                    </label>
                    <div className="block text-sm font-semibold text-slate-700">
                      <span id="payout-provider-label">
                        {payoutSetupType === 'mobile_wallet' ? t('walletPayout.mobileProvider') : t('walletPayout.bank')}
                      </span>
                      <details className="group" aria-labelledby="payout-provider-label">
                        <summary
                          onClick={(event) => {
                            if (payoutSetupBanksLoading || payoutSetupLoading || !visiblePayoutSetupProviders.length) {
                              event.preventDefault();
                            }
                          }}
                          aria-disabled={payoutSetupBanksLoading || payoutSetupLoading || !visiblePayoutSetupProviders.length}
                          className="mt-1 flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 font-normal"
                        >
                          <span>
                            {visiblePayoutSetupProviders.find((bank) => bank.code === payoutSetupBankCode)?.name
                              || (payoutSetupBanksLoading ? t('walletPayout.loadingBanks') : t('walletPayout.chooseProvider'))}
                          </span>
                          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
                        </summary>
                        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">
                          {visiblePayoutSetupProviders.length ? visiblePayoutSetupProviders.map((bank) => (
                            <button
                              key={bank.code}
                              type="button"
                              aria-pressed={payoutSetupBankCode === bank.code}
                              onClick={(event) => {
                                setPayoutSetupBankCode(bank.code);
                                event.currentTarget.closest('details')?.removeAttribute('open');
                              }}
                              className="block w-full rounded-lg px-3 py-2 text-left font-normal hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            >
                              {bank.name}
                            </button>
                          )) : (
                            <p className="px-3 py-2 text-sm font-normal text-slate-500">{t('walletPayout.noProviders')}</p>
                          )}
                        </div>
                      </details>
                    </div>
                    {payoutSetupBanksLoading && (
                      <p role="status" className="text-sm text-slate-600">{t('walletPayout.loadingBanks')}</p>
                    )}
                    {payoutSetupBanksError && (
                      <div className="space-y-2" role="alert">
                        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{payoutSetupBanksError}</p>
                        {!payoutSetupLoading && !payoutSetupBanksLoading && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayoutSetupBanksError('');
                              setPayoutSetupRetryCount((count) => count + 1);
                            }}
                            className="font-semibold text-emerald-700 underline underline-offset-2"
                          >
                            {t('walletPayout.retryProviders')}
                          </button>
                        )}
                      </div>
                    )}
                    {payoutSetupError && (
                      <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {payoutSetupError}
                      </p>
                    )}
                    <label className="block text-sm font-semibold text-slate-700">
                      {t('walletPayout.holderName')}
                      <input
                        value={payoutSetupAccountName}
                        onChange={(event) => {
                          setPayoutSetupAccountName(event.target.value);
                          setPayoutSetupNameMismatchAcknowledged(false);
                        }}
                        autoComplete="name"
                        disabled={payoutSetupLoading}
                        className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-normal"
                      />
                    </label>
                    {payoutSetupNameNeedsAcknowledgement && (
                      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">
                        <input
                          type="checkbox"
                          checked={payoutSetupNameMismatchAcknowledged}
                          onChange={(event) => setPayoutSetupNameMismatchAcknowledged(event.target.checked)}
                          disabled={payoutSetupLoading}
                          className="mt-1 h-4 w-4 shrink-0 accent-amber-700"
                        />
                        <span>{t('walletPayout.alternativeNameConsent')}</span>
                      </label>
                    )}
                    <label className="block text-sm font-semibold text-slate-700">
                      {payoutSetupType === 'mobile_wallet' ? 'Telebirr / CBE Birr Phone Number' : 'CBE Account Number'}
                      <input
                        value={payoutSetupAccountNumber}
                        onChange={(event) => setPayoutSetupAccountNumber(event.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        type="tel"
                        pattern={payoutSetupType === 'mobile_wallet' ? '(09|07)[0-9]{8}' : undefined}
                        minLength={payoutSetupType === 'mobile_wallet' ? 10 : 10}
                        maxLength={payoutSetupType === 'mobile_wallet' ? 10 : 15}
                        placeholder={payoutSetupType === 'mobile_wallet' ? 'Enter phone number (e.g. 0912345678)' : 'Enter CBE account number (e.g. 1000...)'}
                        autoComplete="off"
                        disabled={payoutSetupLoading}
                        className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-normal"
                      />
                    </label>
                    {payoutSetupAccountNumber && !isValidPayoutAccountNumber(payoutSetupType, payoutSetupBankCode, payoutSetupAccountNumber) && (
                      <p className="text-sm text-red-700">
                        {payoutSetupType === 'mobile_wallet'
                          ? t('walletPayout.mobileNumberInvalid')
                          : t('walletPayout.accountNumberInvalid')}
                      </p>
                    )}
                  </section>
                )}

                {withdrawExceedsBalance && (
                  <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                    Insufficient wallet balance for this withdrawal.
                  </p>
                )}
                {withdrawProviderUnavailable ? (
                  <div className="space-y-3">
                    <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                      ⚠️ {payoutAccount?.provider_name || 'This payout provider'} is temporarily unavailable for withdrawals. Please update your payout method to continue.
                    </p>
                    <button type="button" onClick={() => { setReturnToWithdrawAfterPayoutSetup(true); setShowWithdrawModal(false); setActiveTab('settings'); setSettingsTab('payout'); }} className="font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800">Change Payout Method</button>
                  </div>
                ) : activeWithdrawal ? (
                  <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
                    <p>{activeWithdrawal.status === 'pending_approval'
                      ? 'Your withdrawal is held while an administrator approves it. You can request another withdrawal after it is resolved.'
                      : 'You have a payout currently processing. You can request a new withdrawal once it completes.'}</p>
                    <button type="button" onClick={refreshWithdrawalStatus} disabled={withdrawalStatusLoading} className="font-semibold text-amber-900 underline underline-offset-2 disabled:opacity-60">
                      {withdrawalStatusLoading ? 'Refreshing status...' : 'Refresh payout status'}
                    </button>
                  </div>
                ) : withdrawError && (
                  <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                    <p>{withdrawError}</p>
                    {withdrawAttemptsLeft !== null && <p className="mt-1 font-bold">{withdrawAttemptsLeft} PIN attempt{withdrawAttemptsLeft === 1 ? '' : 's'} remaining.</p>}
                    {withdrawRetryAfterSeconds !== null && <p className="mt-1 font-bold">Try again in {Math.ceil(withdrawRetryAfterSeconds / 60)} minute{Math.ceil(withdrawRetryAfterSeconds / 60) === 1 ? '' : 's'}.</p>}
                    {withdrawError.toLowerCase().includes('wallet pin') && withdrawError.toLowerCase().includes('set up') && (
                      <button type="button" onClick={() => { setShowWithdrawModal(false); setActiveTab('settings'); setSettingsTab('security'); }} className="mt-2 font-bold underline">Set up Wallet PIN in Settings</button>
                    )}
                  </div>
                )}

              </div>
              <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
                {payoutSetupOpen && !payoutAccount ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={handlePayoutSetupSubmit} disabled={payoutSetupLoading || payoutSetupBanksLoading || !payoutSetupValid} className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                      {payoutSetupLoading ? t('walletPayout.saving') : t('walletPayout.saveAndContinue')}
                    </button>
                    <button type="button" onClick={() => setPayoutSetupOpen(false)} disabled={payoutSetupLoading} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60">
                      {t('walletPayout.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={payoutAccountLoading || Boolean(activeWithdrawal) || withdrawProviderUnavailable || withdrawLoading || withdrawPin.length !== 4 || !Number.isFinite(withdrawAmountValue) || withdrawAmountValue < 100 || withdrawExceedsBalance}
                    className="w-full rounded-full bg-emerald-500 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    {withdrawLoading ? t('walletPayout.processing') : t('walletPayout.submitWithdrawal')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-950">{editingProduct ? 'Edit Product' : 'List a New Product'}</h2>
                <p className="mt-1 text-sm text-slate-500">{editingProduct ? 'Update your listing details.' : 'Fill in the details below to add your item to the campus marketplace.'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowProductModal(false);
                  resetProductForm();
                }}
                className="rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-slate-700 transition hover:bg-slate-200"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleAddProductSubmit} className="max-h-[calc(90vh-7rem)] overflow-y-auto overflow-x-hidden px-6 py-6">
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Condition</label>
                  <select value={productForm.condition} onChange={(e) => setProductForm((prev) => ({ ...prev, condition: e.target.value }))} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none">
                    <option>New</option><option>Used</option><option>Gently Used</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Pickup point</label>
                  <input value={productForm.pickupLocation} onChange={(e) => setProductForm((prev) => ({ ...prev, pickupLocation: e.target.value }))} placeholder="e.g. Dormitory Block A, Library Entrance" className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Pickup hours</label>
                  <input value={productForm.pickupHours} onChange={(e) => setProductForm((prev) => ({ ...prev, pickupHours: e.target.value }))} placeholder="08:00-17:00" className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none" />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Title</label>
                  <input
                    type="text"
                    value={productForm.title}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none transition"
                    placeholder="Enter product title"
                  />
                  {productForm.condition.toLowerCase().includes('used') && Array.isArray(productForm.image) && productForm.image.length > 0 && <div className="mt-3 space-y-2"><p className="text-xs font-semibold text-slate-500">Optional condition note for each image</p>{productForm.image.map((image, index) => <input key={`${image.name}-${index}`} value={productForm.imageNotes[index] || ''} onChange={(e) => setProductForm((prev) => ({ ...prev, imageNotes: prev.image.map((note, noteIndex) => noteIndex === index ? e.target.value : note) }))} placeholder={`Image ${index + 1}: e.g. small tear on spine`} className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:bg-white focus:outline-none" />)}</div>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Price (ETB)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={productForm.price}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, price: e.target.value }))}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none transition"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Available quantity</label>
                  <input
                    type="number"
                    min={editingProduct && String(editingProduct.status || '').toLowerCase() === 'sold' ? '0' : '1'}
                    step="1"
                    value={productForm.quantity}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, quantity: e.target.value }))}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none transition"
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Category</label>
                  <select
                    value={productForm.category}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, category: e.target.value, subcategory: '' }))}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none transition"
                  >
                    <option value="">Select Category</option>
                    {dbCategories.map((category) => (
                      <option key={category.id || category.name} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Subcategory</label>
                  <select
                    value={productForm.subcategory}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, subcategory: e.target.value }))}
                    disabled={!productForm.category}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select Subcategory</option>
                    {dbCategories.find((cat) => cat.name === productForm.category)?.items?.map((subcategory) => (
                      <option key={subcategory.name} value={subcategory.name}>{subcategory.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-700">Product Image</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.jfif"
                    onChange={handleProductImageSelect}
                    className="mt-2 block w-full text-sm text-slate-700 file:mr-4 file:rounded-full file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
                  />
                  {editingProduct && existingProductImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {existingProductImages.map((image, index) => (
                        <div key={`${image}-${index}`} className="relative overflow-hidden rounded-xl border border-slate-200">
                          <img src={resolveImageUrl(image)} alt={`Existing product image ${index + 1}`} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-20 w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setExistingProductImages((previous) => previous.filter((_, imageIndex) => imageIndex !== index))}
                            className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-[10px] font-bold text-white"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {newProductImagePreviews.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {newProductImagePreviews.map((preview, index) => (
                        <div key={preview} className="relative overflow-hidden rounded-xl border border-emerald-200">
                          <img src={preview} alt={`New product image ${index + 1}`} className="h-20 w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setProductForm((previous) => ({ ...previous, image: previous.image.filter((_, imageIndex) => imageIndex !== index) }))}
                            className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-[10px] font-bold text-white"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">Description</label>
                <textarea
                  rows="4"
                  value={productForm.description}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none transition"
                  placeholder="Describe your product, condition, and any important details."
                />
              </div>

              {(productError || productSuccessMsg) && (
                <p className={`text-sm ${productError ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {productError || productSuccessMsg}
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="submit"
                  disabled={productSubmitting}
                  className="btn-primary inline-flex justify-center rounded-full px-6 py-3 text-sm font-semibold transition"
                >
                  {productSubmitting ? (editingProduct ? 'Saving...' : 'Posting...') : (editingProduct ? 'Save Changes' : 'Post Product')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowProductModal(false);
                    resetProductForm();
                  }}
                  className="inline-flex justify-center rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightboxImage('')}
        >
          <button
            type="button"
            onClick={() => setLightboxImage('')}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-xl text-white"
            aria-label="Close image preview"
          >
            ×
          </button>
          <img
            src={lightboxImage}
            alt="Full-size chat attachment"
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90dvh] max-w-[95vw] object-contain"
          />
        </div>
      )}
    </div>
  );
}

export default StudentDashboard;
