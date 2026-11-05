/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Check, Copy, Eye, Pencil, Trash2, X } from 'lucide-react';
import AdminDisputeReview from './AdminDisputeReview';
import AdminSupportInbox from './AdminSupportInbox';
import { AdminProductReviewsPage } from './AdminDirectoryPages';
import AdminProfileMenu from './AdminProfileMenu';
import AdminSidebarNavigation from './AdminSidebarNavigation';
import { getErrorMessage, notifyError, notifySuccess } from '../../utils/notify';
import { adminApiGet, apiFetch, getStoredAccessToken } from '../../api/apiClient';
import { normalizeAdminSection } from '../../utils/adminDashboardSection';
import {
  getAdminSecuritySections,
  normalizeAdminSecuritySection,
} from '../../utils/adminSecuritySections';
import {
  ADMIN_NAVIGATION,
  filterAdminNavigation,
  getActiveAdminGroup,
  decrementAdminSidebarCount,
} from '../../utils/adminNavigation';
import { notifyAdminSeenChanged, subscribeToAdminSeenChanges } from '../../utils/adminSeenSync';
import { API_BASE_URL, IMAGE_PLACEHOLDER, resolveImageUrl } from '../../config';
import { getAdminSettings, invalidateAdminSettingsCache, patchAdminSettings } from '../../api/adminSettings';
import { useLanguage } from '../../context/LanguageContext';
import { getAdminProductStatusCounts, matchesAdminProductStatusFilter } from '../../utils/adminProductStatus';
import {
  analyticsSalesPeriods,
  buildAnalyticsRevenueChart,
  changeAnalyticsPeriod,
  fetchAnalyticsSales,
  getAnalyticsGrowthPresentation,
  getAnalyticsPeriodButtonClass,
} from '../../utils/analyticsSalesTrend';
import logs from '../../assets/logs.png';

const ADMIN_REPORT_ITEM_STYLES = {
  unseen: 'font-black text-slate-950',
  seen: 'font-semibold text-slate-700',
};

const generateSvgPath = (values, maxValue, width = 100, height = 100, padding = 8) => {
  if (!Array.isArray(values) || values.length === 0) return '';

  const safeValues = values.map((value) => Math.max(0, Number(value) || 0));
  const safeMax = Math.max(Number(maxValue) || 0, 1);
  const baseline = height - padding;
  const chartHeight = baseline - padding;
  const step = safeValues.length > 1 ? width / (safeValues.length - 1) : 0;

  return safeValues.map((value, index) => {
    const x = safeValues.length > 1 ? index * step : width / 2;
    const y = baseline - (value / safeMax) * chartHeight;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)},${Math.max(padding, Math.min(baseline, y)).toFixed(2)}`;
  }).join(' ');
};

const generateSvgAreaPath = (values, maxValue, width = 100, height = 100, padding = 8) => {
  const linePath = generateSvgPath(values, maxValue, width, height, padding);
  if (!linePath) return '';

  const baseline = height - padding;
  return `${linePath} L ${width},${baseline} L 0,${baseline} Z`;
};

const getDynamicMonths = () => Array.from({ length: 6 }, (_, index) => {
  const targetDate = new Date();
  targetDate.setDate(1);
  targetDate.setMonth(targetDate.getMonth() - (5 - index));
  return targetDate.toLocaleString('en-US', { month: 'short', year: '2-digit' });
});
const UNIVERSITY_STRUCTURE = {
  'College of Computing and Informatics (CCI)': ['Department of Computer Science', 'Department of Information Technology (IT)', 'Department of Software Engineering'],
  'College of Natural and Computational Sciences (CNCS)': ['Department of Biology', 'Department of Chemistry', 'Department of Geology', 'Department of Mathematics', 'Department of Physics', 'Department of Statistics', 'Department of Sport Science'],
  'College of Agriculture and Natural Resource': ['Department of Agro-Economics', 'Department of Agribusiness and Value Chain Management', 'Department of Animal Science', 'Department of Forestry', 'Department of Horticulture', 'Department of Natural Resource Management', 'Department of Plant Science', 'Department of Rural Development and Agricultural Extension'],
  'College of Business and Economics': ['Department of Accounting and Finance', 'Department of Economics', 'Department of Management', 'Department of Marketing Management'],
  'College of Social Sciences and Humanities': ['Department of Amharic Language and Literature', 'Department of English Language and Literature', 'Department of Geography and Environmental Studies', 'Department of History and Heritage Management', 'Department of Political Science and International Relations'],
  'College of Law': ['Department of Law (LLB)'],
};

const ADMIN_AVATAR_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' rx='64' fill='%230f766e'/%3E%3Ccircle cx='64' cy='48' r='22' fill='white'/%3E%3Cpath d='M25 108c4-24 19-36 39-36s35 12 39 36' fill='white'/%3E%3C/svg%3E";

const formatHistoryDevice = (device = '') => {
  const browser = device.match(/(Edg(?:e|A|iOS)?|OPR)\/([\d.]+)/i)
    || device.match(/(Chrome|Firefox|Version|Safari)\/([\d.]+)/i);
  const os = /Windows/i.test(device) ? 'Windows'
    : /Android/i.test(device) ? 'Android'
      : /iPhone|iPad|iPod/i.test(device) ? 'iOS'
        : /Mac OS X|macOS/i.test(device) ? 'macOS'
          : /Linux/i.test(device) ? 'Linux'
            : '';
  let browserName = browser?.[1] || '';
  if (/^Edg/i.test(browserName)) browserName = 'Edge';
  else if (browserName === 'OPR') browserName = 'Opera';
  else if (browserName === 'Version') browserName = /Safari/i.test(device) ? 'Safari' : 'Browser';
  else if (/^Chrome$/i.test(browserName)) browserName = 'Chrome';
  const browserVersion = browser?.[2]?.split('.')[0];
  const browserLabel = browserName ? `${browserName}${browserVersion ? ` ${browserVersion}` : ''}` : '';
  return [browserLabel, os].filter(Boolean).join(' · ') || device || '-';
};

const SETTINGS_TOGGLE_PATHS = {
  'Require Approval': 'productSettings.requireApproval',
  'Allow Editing': 'productSettings.allowEditing',
  'Auto Hide Sold': 'productSettings.autoHideSold',
  'Enable AI': 'aiSettings.enableAI',
  'Enable Online Payment': 'paymentSettings.enableOnlinePayment',
  'Refunds Enabled': 'paymentSettings.refundsEnabled',
  'Enable platform commission': 'paymentSettings.commission.commission_enabled',
  'Email Notifications': 'notificationSettings.emailNotifs',
  'Order Notifications': 'notificationSettings.orderNotifs',
  'Message Notifications': 'notificationSettings.messageNotifs',
  'Approval Notifications': 'notificationSettings.approvalNotifs',
  'Payment Notifications': 'notificationSettings.paymentNotifs',
  'Announcement Notifications': 'notificationSettings.announcementNotifs',
  'Require Student Verification': 'securitySettings.requireStudentVerification',
  'Require 2FA for all admins': 'securitySettings.admin2FA',
  'Audit Logging': 'securitySettings.auditLogging',
  'Require University Email': 'studentVerificationSettings.requireUniversityEmail',
  'Auto Approve Students': 'studentVerificationSettings.autoApproveStudents',
  'Auto Hide Reported': 'moderationSettings.autoHideReported',
  'Require Admin Approval': 'moderationSettings.requireAdminApproval',
  'Allow Student Reports': 'moderationSettings.allowStudentReports',
  'Enable Chat': 'chatSettings.enabled',
  'Allow Attachments': 'chatSettings.allowAttachments',
  'Maintenance Mode': 'maintenanceSettings.maintenanceMode',
};

const isValidEmailDomain = (value) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
  String(value || '').trim().replace(/^@+/, '').toLowerCase(),
);

function SettingsToggle({ label, checked, onChange, description = '', disabled = false }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
      <span>
        {label && <span className="block">{label}</span>}
        {description && <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-label={label || 'Audit Logging'}
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

const STATUS_BADGE_COLORS = {
  Successful: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  Delivered: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  Resolved: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  Verified: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  Active: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  Low: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  Pending: 'border-amber-200 bg-amber-100 text-amber-700',
  Medium: 'border-amber-200 bg-amber-100 text-amber-700',
  Suspended: 'border-amber-100 bg-amber-50 text-amber-700',
  Failed: 'border-red-200 bg-red-100 text-red-700',
  Rejected: 'border-rose-200 bg-rose-100 text-rose-700',
  High: 'border-rose-200 bg-rose-100 text-rose-700',
  Open: 'border-sky-200 bg-sky-100 text-sky-700',
  Scheduled: 'border-sky-200 bg-sky-100 text-sky-700',
  'In Review': 'border-violet-200 bg-violet-100 text-violet-700',
  Review: 'border-violet-200 bg-violet-100 text-violet-700',
  Everyone: 'border-violet-200 bg-violet-100 text-violet-700',
  Closed: 'border-emerald-200 bg-emerald-100 text-emerald-700',
};

function StatusBadge({ status, className = '', ...props }) {
  return (
    <span
      {...props}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 border ${STATUS_BADGE_COLORS[status] || 'border-slate-200 bg-slate-100 text-slate-600'} ${className}`}
    >
      {status}
    </span>
  );
}

const LEGACY_PREPAYMENT_ORDER_STATUSES = new Set([
  'pending',
  'processing',
  'accepted',
  'waiting acceptance',
  'waiting for acceptance',
  'ready for pickup',
  'ready to meet',
  'out for delivery',
  'cancelled',
  'canceled',
  'rejected',
  'returned',
  'expired',
]);

const getAdminOrderStatusLabel = (status) => {
  const normalized = String(status || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (LEGACY_PREPAYMENT_ORDER_STATUSES.has(normalized)) return 'Legacy order';
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'disputed') return 'Disputed';
  return String(status || 'Unknown');
};

function AdminTable({ children, className = '', tableClassName = '' }) {
  return (
    <div className={`admin-data-table-wrapper w-full max-w-full overflow-x-auto rounded-2xl ${className}`}>
      <table className={`admin-data-table w-full min-w-[860px] table-auto text-left text-sm text-slate-700 ${tableClassName}`}>
        {children}
      </table>
    </div>
  );
}

function ActionButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap shrink-0 ${className}`}
    >
      {children}
    </button>
  );
}

const PRODUCT_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='16' fill='%23f1f5f9'/%3E%3Cpath d='M24 35l24-12 24 12v28L48 75 24 63V35z' fill='%2394a3b8'/%3E%3Cpath d='M24 35l24 12 24-12M48 47v28' fill='none' stroke='%23e2e8f0' stroke-width='4'/%3E%3C/svg%3E";

const getComplaintType = (issue = '') => {
  const normalizedIssue = String(issue).toLowerCase();
  if (/scam|fraud|iphone/.test(normalizedIssue)) return 'Fraud/Scam';
  if (/abuse|insult/.test(normalizedIssue)) return 'Seller Misconduct';
  if (/payment|transaction|deposit|refund|paid|money/.test(normalizedIssue)) return 'Payment Problem';
  return 'Product Issue';
};

const getReportedSeller = (issue = '') => {
  const match = String(issue).match(/report against\s+([A-Za-z0-9_-]+)(?:\s*:\s*([A-Za-z0-9\s_]+))?/i);
  if (!match) return 'Not specified';

  const sellerId = match[1];
  const sellerName = match[2]?.trim();
  return sellerName ? `${sellerId}: ${sellerName}` : sellerId;
};

const normalizeTarget = (target = '') => {
  const normalizedTarget = String(target || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  const aliases = {
    all: 'All',
    'all students': 'Everyone',
    everyone: 'Everyone',
    buyer: 'Buyers',
    buyers: 'Buyers',
    seller: 'Sellers',
    sellers: 'Sellers',
    'it department': 'Department of Information Technology (IT)',
    'information technology': 'Department of Information Technology (IT)',
    'department of information technology': 'Department of Information Technology (IT)',
    'department of information technology (it)': 'Department of Information Technology (IT)',
  };

  if (normalizedTarget.startsWith('broadcast_')) {
    return normalizeTarget(normalizedTarget.slice('broadcast_'.length));
  }

  return aliases[normalizedTarget] || normalizedTarget;
};

const parseAuditDescription = (description = '') => {
  const match = String(description).match(/([A-Za-z][\w.]*)\s+changed\s+from\s+["']([^"']*)["']\s+to\s+["']([^"']*)["']/i);
  if (!match || AUDIT_SECRET_KEY.test(match[1])) return null;

  return { field: match[1], previousValue: match[2], newValue: match[3] };
};

const parseAuditJson = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const AUDIT_SECRET_KEY = /(password(?!_?length)|secret|token|backup.?codes?|credential|api.?key|private.?key|authorization)/i;

const redactAuditJson = (value) => {
  if (Array.isArray(value)) return value.map(redactAuditJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    AUDIT_SECRET_KEY.test(key) ? '[REDACTED]' : redactAuditJson(item),
  ]));
};

const redactAuditText = (value) => String(value || '')
  .replace(
    /((?:password(?!_?length)|secret|token|backup.?codes?|credential|api.?key|private.?key|authorization)\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi,
    '$1"[REDACTED]"',
  )
  .replace(
    /((?:password(?!_?length)|secret|token|backup.?codes?|credential|api.?key|private.?key|authorization)\s+changed\s+from\s+)(["'])(.*?)\2(\s+to\s+)(["'])(.*?)\5/gi,
    '$1[REDACTED]$4[REDACTED]',
  );

const getAuditDescriptionPresentation = (description) => {
  const parsed = parseAuditJson(description);
  if (!parsed || typeof parsed !== 'object') {
    const rawText = String(description || 'No additional description provided.');
    const safeText = redactAuditText(rawText);
    return { summary: safeText, details: safeText };
  }

  const safeValue = redactAuditJson(parsed);
  const preferredSummary = ['message', 'summary', 'note']
    .map((key) => safeValue[key])
    .find((value) => value !== undefined && value !== null && value !== '');
  const summaryParts = Object.entries(safeValue)
    .filter(([key, value]) => !AUDIT_SECRET_KEY.test(key) && !['old_values', 'new_values', 'changes'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`);
  const oldValues = safeValue.old_values && typeof safeValue.old_values === 'object' ? safeValue.old_values : {};
  const newValues = safeValue.new_values && typeof safeValue.new_values === 'object' ? safeValue.new_values : {};
  const changedFields = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
    .filter((key) => !AUDIT_SECRET_KEY.test(key))
    .map((key) => `${key}: ${String(oldValues[key] ?? 'empty')} -> ${String(newValues[key] ?? 'empty')}`);
  if (changedFields.length) summaryParts.push(`Changed ${changedFields.slice(0, 2).join('; ')}`);

  return {
    summary: preferredSummary !== undefined
      ? redactAuditText(typeof preferredSummary === 'object' ? JSON.stringify(preferredSummary) : String(preferredSummary))
      : summaryParts.join(' · ') || 'Structured audit event',
    details: JSON.stringify(safeValue, null, 2),
  };
};

const getProductImageUrl = (image) => {
  let value = image;
  if (typeof value === 'string') {
    try {
      const parsedImage = JSON.parse(value);
      value = Array.isArray(parsedImage) ? parsedImage.find(Boolean) : value;
    } catch {
      value = value.trim();
    }
  }
  if (Array.isArray(value)) value = value.find(Boolean);
  if (typeof value !== 'string' || !value.trim()) return PRODUCT_PLACEHOLDER;
  const normalized = value.trim();
  if (/^(https?:|data:|blob:)/i.test(normalized) || normalized.startsWith('/')) return resolveImageUrl(normalized);
  return resolveImageUrl(`/static/uploads/${normalized}`);
};

const formatAuditValue = (value) => {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const getAuditChanges = (log) => {
  const changes = parseAuditJson(log?.changes);
  if (Array.isArray(changes)) {
    return changes.map((change, index) => {
      if (typeof change === 'string') {
        return { field: `Change ${index + 1}`, previousValue: 'Unknown', newValue: change };
      }

      return {
        field: change?.field ?? change?.key ?? change?.name ?? `Change ${index + 1}`,
        previousValue: change?.old_value ?? change?.oldValue ?? change?.from ?? change?.previous ?? 'Unknown',
        newValue: change?.new_value ?? change?.newValue ?? change?.to ?? change?.current ?? 'Unknown',
      };
    });
  }

  const oldValues = parseAuditJson(log?.old_values);
  const newValues = parseAuditJson(log?.new_values);
  if (!oldValues && !newValues) return [];

  return Array.from(new Set([...Object.keys(oldValues || {}), ...Object.keys(newValues || {})])).map((field) => ({
    field,
    previousValue: oldValues?.[field],
    newValue: newValues?.[field],
  }));
};

const exportCSVFile = (fileName, columns, rows) => {
  const sanitize = (value) => String(value || '').replace(/,/g, ';').replace(/"/g, '""');
  const escape = (value) => `"${sanitize(value)}"`;
  const csvContent = `\uFEFF${[columns, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')}`;
  const downloadUrl = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
  const downloadLink = document.createElement('a');
  downloadLink.href = downloadUrl;
  downloadLink.download = fileName;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(downloadUrl);
};

const exportPDFFile = (fileName, reportName, columns, rows) => {
  const pdfDocument = new jsPDF();
  pdfDocument.setFontSize(18);
  pdfDocument.setTextColor(15, 23, 42);
  pdfDocument.text(`DG Market — ${reportName}`, 14, 18);
  pdfDocument.setFontSize(9);
  pdfDocument.setTextColor(100, 116, 139);
  pdfDocument.text(`Generated: ${new Date().toLocaleString()} | Total records: ${rows.length}`, 14, 26);
  autoTable(pdfDocument, {
    startY: 33,
    head: [columns],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
  });
  pdfDocument.save(fileName);
};

const getReportPriority = (issue = '') => {
  const normalizedIssue = String(issue).toLowerCase();
  if (/scam|fraud|iphone|abuse|insult/.test(normalizedIssue)) {
    return { label: 'High', className: 'bg-rose-100 text-rose-700 border border-rose-200' };
  }
  if (/payment|transaction|deposit|refund|paid|money/.test(normalizedIssue)) {
    return { label: 'Medium', className: 'bg-amber-100 text-amber-700 border border-amber-200' };
  }
  return { label: 'Low', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' };
};

const normalizeAdminTab = (tab) => normalizeAdminSection(tab, 'dashboard');

const readExpandedAdminGroups = () => {
  if (typeof window === 'undefined') return [];
  try {
    const expanded = JSON.parse(window.sessionStorage.getItem('adminSidebarExpandedGroups') || '[]');
    return Array.isArray(expanded) ? expanded.filter((key) => typeof key === 'string') : [];
  } catch (error) {
    console.warn('Unable to read expanded admin menu groups.', error);
    return [];
  }
};

class AdminDashboardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Admin dashboard content failed to render. Falling back to a safe empty state.', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-center shadow-sm" role="alert">
          <h2 className="text-2xl font-black text-slate-900">Something went wrong</h2>
          <p className="mt-2 text-sm text-slate-600">The admin section could not be loaded. Please retry.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-5 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function AdminSecurityProfile({ user, onUserUpdate, initialSection = 'personal' }) {
  const [requestedSection, setSection] = useState(initialSection);
  const [profile, setProfile] = useState({ id: null, full_name: '', username: '', email: '', phone: '', role: '', two_factor_enabled: false, permissions: {}, admin_sub_admins_enabled: false, avatarUrl: ADMIN_AVATAR_PLACEHOLDER });
  const [form, setForm] = useState({ full_name: '', username: '', email: '', phone: '', current_password: '', new_password: '', confirm_password: '', logout_all_sessions: false });
  const [sessions, setSessions] = useState([]);
  const [history, setHistoryState] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [historyDeleteAction, setHistoryDeleteAction] = useState(null);
  const [historyDeleteConfirm, setHistoryDeleteConfirm] = useState('');
  const [historyDeleteAge, setHistoryDeleteAge] = useState('all');
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const historyPageRef = useRef(1);
  const [backupCodes, setBackupCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState('');
  const avatarInputRef = useRef(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [backupCodesCopied, setBackupCodesCopied] = useState(false);
  const [setupData, setSetupData] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [reauthAction, setReauthAction] = useState(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [permissionState, setPermissionState] = useState({ users: true, products: true, orders: true, payments: true, reports: true, support: true, ai: true, analytics: true, audit_logs: true, settings: true });
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const { language } = useLanguage();
  const token = () => {
    return getStoredAccessToken();
  };
  const setHistory = (data) => {
    setHistoryState(Array.isArray(data) ? data : data?.items || []);
    if (!Array.isArray(data) && Number.isFinite(data?.total)) setHistoryTotal(data.total);
  };
  const request = async (url, options = {}) => {
    if (url.endsWith('/api/admin/login-history')) {
      url = `${url}?page=${historyPageRef.current}&page_size=25`;
    }
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Security request failed.');
    return data;
  };
  const refreshSecurityData = async () => {
    const sessionToken = token(); if (!sessionToken) return;
    const headers = { Authorization: `Bearer ${sessionToken}` };
    try { const [sessionData, historyData] = await Promise.all([request(`${API_BASE_URL}/api/admin/sessions`, { headers }), request(`${API_BASE_URL}/api/admin/login-history`, { headers })]); setSessions(sessionData); setHistory(historyData); } catch (error) { notifyError(error, 'admin-security-data'); }
  };
  const changeHistoryPage = (page) => {
    historyPageRef.current = page;
    setHistoryPage(page);
    refreshSecurityData();
  };
  const toggleHistorySelection = (id) => {
    setSelectedHistoryIds((current) => current.includes(id)
      ? current.filter((selectedId) => selectedId !== id)
      : [...current, id]);
  };
  const toggleVisibleHistorySelection = () => {
    const visibleIds = history.filter((item) => !item.is_current_session).map((item) => item.id);
    const allVisibleSelected = visibleIds.length > 0
      && visibleIds.every((id) => selectedHistoryIds.includes(id));
    setSelectedHistoryIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };
  const openHistoryDeleteConfirmation = (type, ids = []) => {
    setHistoryDeleteAction({ type, ids });
    setHistoryDeleteConfirm('');
    setHistoryDeleteAge('all');
  };
  const confirmHistoryDelete = async () => {
    if (!historyDeleteAction || historyDeleting) return;
    if (historyDeleteConfirm !== 'DELETE') return;
    setHistoryDeleting(true);
    const headers = { Authorization: `Bearer ${token()}` };
    try {
      let result;
      if (historyDeleteAction.type === 'single') {
        result = await request(`${API_BASE_URL}/api/admin/login-history/${historyDeleteAction.ids[0]}`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ confirm: historyDeleteConfirm }),
        });
      } else if (historyDeleteAction.type === 'selected') {
        result = await request(`${API_BASE_URL}/api/admin/login-history/bulk-delete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ids: historyDeleteAction.ids, confirm: historyDeleteConfirm }),
        });
      } else {
        const body = { confirm: historyDeleteConfirm };
        if (historyDeleteAge !== 'all') body.older_than_days = Number(historyDeleteAge);
        result = await request(`${API_BASE_URL}/api/admin/login-history/delete-all`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      }
      notifySuccess(`${result.deleted} login history record(s) deleted.`, 'admin-login-history-delete');
      setHistoryDeleteAction(null);
      setHistoryDeleteConfirm('');
      setSelectedHistoryIds([]);
      await refreshSecurityData();
    } catch (error) {
      notifyError(error, 'admin-login-history-delete');
    } finally {
      setHistoryDeleting(false);
    }
  };
  useEffect(() => {
    const load = async () => {
      setProfileLoading(true);
      try {
        const data = await request(`${API_BASE_URL}/api/admin/me`, { headers: { Authorization: `Bearer ${token()}` } });
        const subAdminsEnabled = data.admin_sub_admins_enabled === true;
        setProfile((current) => ({
          ...current,
          ...data,
          two_factor_enabled: Boolean(data.two_factor_enabled),
          admin_sub_admins_enabled: subAdminsEnabled,
        }));
        onUserUpdate?.((currentUser) => currentUser
          ? { ...currentUser, admin_sub_admins_enabled: subAdminsEnabled }
          : currentUser);
        setPermissionState((current) => ({ ...current, ...(data.permissions || {}) }));
        setForm((current) => ({
          ...current,
          full_name: data.full_name || '',
          username: data.username || '',
          email: data.email || '',
          phone: data.phone || '',
          current_password: '',
          new_password: '',
          confirm_password: '',
        }));
      } catch (error) {
        setProfile((current) => ({ ...current, admin_sub_admins_enabled: false }));
        onUserUpdate?.((currentUser) => currentUser
          ? { ...currentUser, admin_sub_admins_enabled: false }
          : currentUser);
        notifyError(error, 'admin-profile-load');
      } finally {
        setProfileLoading(false);
      }
      refreshSecurityData();
    };
    load();
    const interval = window.setInterval(refreshSecurityData, 30000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);
  const passwordScore = [form.new_password.length >= 8, /[A-Z]/.test(form.new_password), /[a-z]/.test(form.new_password), /\d/.test(form.new_password), /[^A-Za-z0-9]/.test(form.new_password)].filter(Boolean).length;
  const updateProfile = async (event) => { event.preventDefault(); if (busy) return; setBusy(true); try { const data = await request(`${API_BASE_URL}/api/admin/me`, { method: 'PATCH', headers: { Authorization: `Bearer ${token()}` }, body: JSON.stringify(form) }); setProfile((current) => ({ ...current, ...data })); onUserUpdate?.((currentUser) => ({ ...currentUser, ...data })); setForm((current) => ({ ...current, current_password: '', new_password: '', confirm_password: '' })); notifySuccess('Profile saved successfully', 'admin-profile-save'); refreshSecurityData(); } catch (error) { notifyError(error, 'admin-profile-save'); } finally { setBusy(false); } };
  const normalizedRole = String(profile.role || '').trim().toLowerCase().replace(/_/g, ' ');
  const isMainAdmin = normalizedRole === 'admin';
  const subAdminsEnabled = profile.admin_sub_admins_enabled === true;
  const section = normalizeAdminSecuritySection(requestedSection, subAdminsEnabled, isMainAdmin);
  const sections = getAdminSecuritySections(subAdminsEnabled, isMainAdmin);
  const canEditPermissions = ['admin', 'super admin', 'superadministrator'].includes(normalizedRole);
  const permissionDefinitions = [['users', 'Users'], ['products', 'Products'], ['orders', 'Orders'], ['payments', 'Payments'], ['reports', 'Reports'], ['support', 'Support'], ['ai', 'AI'], ['analytics', 'Analytics'], ['audit_logs', 'Audit Logs'], ['settings', 'Settings']];
  useEffect(() => {
    if (requestedSection !== section) setSection(section);
  }, [requestedSection, section]);
  const savePermissions = async () => { if (!canEditPermissions || !profile.id || permissionsSaving) return; setPermissionsSaving(true); try { const data = await request(`${API_BASE_URL}/api/admin/${profile.id}/permissions`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}` }, body: JSON.stringify({ permissions: permissionState }) }); setPermissionState(data.permissions || permissionState); setProfile((current) => ({ ...current, permissions: data.permissions || permissionState })); notifySuccess('Permissions saved successfully', 'admin-permissions-save'); } catch (error) { notifyError(error, 'admin-permissions-save'); } finally { setPermissionsSaving(false); } };
  const securityAction = async (path) => { if (busy) return; setBusy(true); try { const data = await request(`${API_BASE_URL}/api/admin/${path}`, { method: 'POST', body: JSON.stringify({ session_token: token() }) }); if (data.backup_codes) setBackupCodes(data.backup_codes); if (typeof data.enabled === 'boolean') setProfile((current) => ({ ...current, two_factor_enabled: data.enabled })); notifySuccess(data.message || 'Security action completed.', `admin-security-${path}`); refreshSecurityData(); } catch (error) { notifyError(error, `admin-security-${path}`); } finally { setBusy(false); } };
  const startTwoFactorSetup = async () => { if (busy) return; setBusy(true); try { const data = await request(`${API_BASE_URL}/api/admin/2fa/setup`, { method: 'POST', body: JSON.stringify({ session_token: token() }) }); setSetupData(data); setSetupCode(''); notifySuccess('Authenticator setup started', 'admin-2fa-setup'); } catch (error) { notifyError(error, 'admin-2fa-setup'); } finally { setBusy(false); } };
  const verifyTwoFactorSetup = async (event) => { event.preventDefault(); if (busy) return; setBusy(true); try { const data = await request(`${API_BASE_URL}/api/admin/2fa/setup/verify`, { method: 'POST', body: JSON.stringify({ session_token: token(), code: setupCode }) }); const enabled = Boolean(data.enabled); setProfile((current) => ({ ...current, two_factor_enabled: enabled })); onUserUpdate?.((currentUser) => ({ ...(currentUser || user || {}), two_factor_enabled: enabled })); setSetupData(null); setSetupCode(''); notifySuccess(data.message || 'Authenticator setup completed.', 'admin-2fa-setup-verify'); refreshSecurityData(); } catch (error) { notifyError(error, 'admin-2fa-setup-verify'); } finally { setBusy(false); } };
  const confirmReauthentication = async (event) => {
    event.preventDefault();
    const backupCodeRegeneration = reauthAction === 'backup-codes';
    if (backupCodeRegeneration && !reauthPassword) {
      notifyError(new Error('Enter your current password to regenerate backup codes.'), 'admin-2fa-reauth');
      return;
    }
    if (!backupCodeRegeneration && !reauthPassword && !reauthCode) {
      notifyError(new Error('Enter your current password or a valid authenticator/backup code.'), 'admin-2fa-reauth');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const data = await request(`${API_BASE_URL}/api/admin/2fa/${reauthAction}`, {
        method: 'POST',
        body: JSON.stringify({
          session_token: token(),
          current_password: reauthPassword || null,
          otp_code: backupCodeRegeneration ? null : (reauthCode || null),
        }),
      });
      if (data.backup_codes) setBackupCodes(data.backup_codes);
      if (typeof data.enabled === 'boolean') setProfile((current) => ({ ...current, two_factor_enabled: data.enabled }));
      setReauthAction(null);
      setReauthPassword('');
      setReauthCode('');
      setBackupCodesCopied(false);
      notifySuccess(data.message || 'Security action completed.', 'admin-2fa-reauth');
      refreshSecurityData();
    } catch (error) {
      notifyError(error, 'admin-2fa-reauth');
    } finally {
      setBusy(false);
    }
  };
  const copyBackupCodes = async () => { if (!backupCodes.length || !navigator.clipboard) { notifyError(new Error('Clipboard access is unavailable.'), 'admin-backup-codes-copy'); return; } try { await navigator.clipboard.writeText(backupCodes.join('\n')); setBackupCodesCopied(true); notifySuccess('Backup codes copied.', 'admin-backup-codes-copy'); window.setTimeout(() => setBackupCodesCopied(false), 2000); } catch (error) { notifyError(error, 'admin-backup-codes-copy'); } };
  const downloadBackupCodes = () => { if (!backupCodes.length) return; const generatedDate = new Date().toISOString().slice(0, 10); const contents = `DG Market Admin - Backup Codes (Generated: ${generatedDate}). Keep these safe. Each code can only be used once.\n\n${backupCodes.join('\n')}\n`; const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'dg-market-backup-codes.txt'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); };
  const localizeAvatarMessage = (message) => {
    if (language !== 'am') return message;
    const amharicMessages = {
      'Profile photo updated': 'የመገለጫ ፎቶ ተቀይሯል።',
      'Profile photo must be 5 MB or smaller.': 'የመገለጫ ፎቶው 5 ሜባ ወይም ከዚያ በታች መሆን አለበት።',
      'Unsupported image type. Upload a JPEG, PNG, or WEBP image.': 'ያልተደገፈ የምስል አይነት ነው። JPEG፣ PNG ወይም WEBP ይምረጡ።',
      'Unsupported or invalid image. Upload a valid JPEG, PNG, or WEBP image.': 'የምስሉ ፋይል ትክክለኛ አይደለም። JPEG፣ PNG ወይም WEBP ይምረጡ።',
      'Failed to save profile photo.': 'የመገለጫ ፎቶውን ማስቀመጥ አልተቻለም።',
    };
    return amharicMessages[message] || message;
  };
  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || avatarUploading) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      notifyError(new Error(language === 'am' ? 'JPEG፣ PNG ወይም WEBP ፎቶ ይምረጡ።' : 'Choose a JPEG, PNG, or WEBP image.'), 'admin-avatar-upload');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notifyError(new Error(localizeAvatarMessage('Profile photo must be 5 MB or smaller.')), 'admin-avatar-upload');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    onUserUpdate?.((currentUser) => ({ ...(currentUser || user || {}), avatarUrl: previewUrl }));
    const formData = new FormData();
    formData.append('avatar', file);
    setAvatarUploading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/profile/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizeAvatarMessage(result.detail || 'Failed to save profile photo.'));
      const savedAvatarUrl = `${result.avatar_url}?v=${Date.now()}`;
      setProfile((current) => ({ ...current, avatar_url: result.avatar_url, avatarUrl: savedAvatarUrl }));
      setAvatarPreview('');
      onUserUpdate?.((currentUser) => ({ ...(currentUser || user || {}), avatar_url: result.avatar_url, avatarUrl: savedAvatarUrl }));
      notifySuccess(localizeAvatarMessage(result.message || 'Profile photo updated'), 'admin-avatar-upload');
    } catch (error) {
      notifyError(error, 'admin-avatar-upload');
    } finally {
      setAvatarUploading(false);
    }
  };
  const field = (label, key, type = 'text') => <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span><input type={type} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500" /></label>;
  if (profileLoading) return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 shadow-sm" role="status">Loading your admin profile...</div>;
  return <div className="space-y-6 p-1 text-slate-900"><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">Security Access</p><h2 className="mt-2 text-2xl font-black">Admin Security Profile</h2></div><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Protected</span></div><div className="mt-6 flex flex-wrap gap-2">{sections.map(([id, label]) => <button key={id} type="button" onClick={() => setSection(id)} className={`rounded-xl px-3 py-2 text-xs font-bold ${section === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}</div></div>
    {section === 'personal' && <form onSubmit={updateProfile} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-6 flex items-center gap-4"><img src={avatarPreview || resolveImageUrl(profile.avatarUrl || profile.avatar_url || ADMIN_AVATAR_PLACEHOLDER)} alt="Admin profile" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} className="h-20 w-20 rounded-full object-cover" /><div><button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} className="btn-primary cursor-pointer rounded-xl px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">{avatarUploading ? 'Uploading...' : 'Upload Photo'}</button><input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} className="hidden" /></div></div><div className="grid gap-4 md:grid-cols-2">{field('Full Name', 'full_name')}{field('Username', 'username')}{field('Email', 'email', 'email')}{field('Phone Number', 'phone')}</div><button disabled={busy} className="btn-primary mt-6 rounded-xl px-5 py-3 text-sm font-bold">Save Changes</button></form>}
    {section === 'password' && <form onSubmit={updateProfile} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="grid gap-4 md:grid-cols-2">{field('Current Password', 'current_password', 'password')}{field('New Password', 'new_password', 'password')}</div>{form.new_password && <div className="mt-4"><div className="flex h-2 gap-1">{[0, 1, 2, 3, 4].map((item) => <span key={item} className={`flex-1 rounded-full ${item < passwordScore ? (passwordScore < 3 ? 'bg-rose-500' : passwordScore < 5 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-200'}`} />)}</div><p className="mt-2 text-xs text-slate-500">{passwordScore}/5 password requirements met</p></div>}{field('Confirm New Password', 'confirm_password', 'password')}<label className="mt-5 flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.logout_all_sessions} onChange={(event) => setForm((current) => ({ ...current, logout_all_sessions: event.target.checked }))} />Log out of all active sessions</label><button disabled={busy} className="btn-primary mt-6 rounded-xl px-5 py-3 text-sm font-bold">Update Password</button></form>}
    {section === '2fa' && <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-xl font-black">Authenticator protection for this admin</h3><p className="mt-2 text-sm text-slate-500">Current admin status: <strong>{profile.two_factor_enabled ? 'Enabled' : 'Disabled'}</strong></p><p className="mt-2 text-xs font-medium leading-5 text-slate-500">This status reflects the authenticated admin&apos;s configured authenticator, not the system-wide login policy in Settings.</p><div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} onClick={startTwoFactorSetup} className="btn-primary rounded-xl px-4 py-3 text-sm font-bold">Setup Authenticator</button><button disabled={busy || !profile.two_factor_enabled} onClick={() => setReauthAction('backup-codes')} title={profile.two_factor_enabled ? 'Generate one-time backup codes' : 'Enable 2FA first to generate backup codes'} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">Generate Backup Codes</button><button disabled={busy || !profile.two_factor_enabled} onClick={() => setReauthAction('disable')} title={profile.two_factor_enabled ? 'Disable authenticator protection' : 'Enable 2FA first'} className="rounded-xl border border-rose-200 px-4 py-3 text-sm font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50">Disable 2FA</button></div></div>}
    {setupData && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={verifyTwoFactorSetup} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-black">Set up authenticator</h3><p className="mt-2 text-sm text-slate-600">Scan this QR code with Google Authenticator or Authy, then enter the six-digit code.</p><img src={setupData.qr_code} alt="Authenticator setup QR code" className="mx-auto mt-5 h-52 w-52" /><p className="mt-3 break-all text-center font-mono text-xs text-slate-500">Manual key: {setupData.secret}</p><input autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={setupCode} onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, ''))} placeholder="6-digit code" className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg tracking-[0.3em]" /><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setSetupData(null)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Cancel</button><button disabled={busy || setupCode.length !== 6} className="btn-primary rounded-xl px-4 py-3 text-sm font-bold">Verify and Enable</button></div></form></div>}
    {reauthAction && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={confirmReauthentication} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h3 className="text-xl font-black">Confirm security action</h3><p className="mt-2 text-sm text-slate-600">{reauthAction === 'backup-codes' ? 'Enter your current password to regenerate backup codes.' : 'Re-authenticate with your current password or a valid authenticator/backup code before continuing.'}</p><input type="password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} placeholder="Current password" className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-3" />{reauthAction !== 'backup-codes' && <><div className="my-3 text-center text-xs font-bold uppercase text-slate-400">or</div><input inputMode="numeric" value={reauthCode} onChange={(event) => setReauthCode(event.target.value.trim())} placeholder="Authenticator or backup code" className="w-full rounded-xl border border-slate-300 px-4 py-3" /></>}<div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setReauthAction(null)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Cancel</button><button disabled={busy} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Confirm</button></div></form></div>}
    {backupCodes.length > 0 && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="backup-codes-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h3 id="backup-codes-title" className="text-xl font-black">Backup codes generated</h3><p className="mt-2 text-sm font-semibold text-amber-700">These codes will only be shown once. Store them somewhere secure before closing this dialog.</p><div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 font-mono text-sm">{backupCodes.map((code) => <span key={code}>{code}</span>)}</div><div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" onClick={copyBackupCodes} className="rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-bold text-amber-900 hover:bg-amber-100">{backupCodesCopied ? 'Copied!' : 'Copy All Codes'}</button><button type="button" onClick={downloadBackupCodes} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Download as .txt</button><button type="button" onClick={() => setBackupCodes([])} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Close</button></div></div></div>}
    {section === 'sessions' && <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><h3 className="text-xl font-black">Active Sessions</h3><button disabled={busy} onClick={() => securityAction('sessions/logout-others')} className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white">Logout Other Sessions</button></div><div className="mt-5 space-y-3">{sessions.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border border-slate-200 p-4 text-sm md:grid-cols-4"><span className="font-bold">{item.is_current ? 'Current session' : 'Active session'}</span><span>{item.device_browser || 'Unknown browser'}</span><span>{item.ip_address || 'Unknown IP'}</span><span>{item.last_active ? new Date(item.last_active).toLocaleString() : 'Unknown activity'}</span></div>)}{sessions.length === 0 && <p className="text-sm text-slate-500">No active sessions were found for this account.</p>}</div></div>}
    {section === 'history' && <>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-black">Login History</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={selectedHistoryIds.length === 0 || historyDeleting} onClick={() => openHistoryDeleteConfirmation('selected', selectedHistoryIds)} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50">Delete selected ({selectedHistoryIds.length})</button>
            <button type="button" disabled={historyTotal === 0 || historyDeleting} onClick={() => openHistoryDeleteConfirmation('all')} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Delete All</button>
          </div>
        </div>
        <table className="mt-5 w-full min-w-[680px] text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
            <th className="pb-3 pr-3"><input type="checkbox" aria-label="Select all login history on this page" disabled={!history.some((item) => !item.is_current_session)} checked={history.some((item) => !item.is_current_session) && history.filter((item) => !item.is_current_session).every((item) => selectedHistoryIds.includes(item.id))} onChange={toggleVisibleHistorySelection} /></th>
            <th className="pb-3">Date &amp; Time</th><th className="pb-3">Event</th><th className="pb-3">IP Address</th><th className="pb-3">Browser / Device</th><th className="pb-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {history.map((item) => <tr key={item.id} className="border-b border-slate-100">
              <td className="py-3 pr-3"><input type="checkbox" aria-label={`Select login history record ${item.id}`} checked={selectedHistoryIds.includes(item.id)} disabled={item.is_current_session} title={item.is_current_session ? 'The current session entry cannot be deleted' : undefined} onChange={() => toggleHistorySelection(item.id)} /></td>
              <td className="py-3">{item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</td>
              <td className="py-3 font-semibold">{item.event_type}{item.is_current_session && <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">Current session</span>}</td>
              <td className="py-3">{item.ip_address || '-'}</td>
              <td className="max-w-[180px] truncate py-3" title={item.device_browser || 'Unknown browser / device'}>{formatHistoryDevice(item.device_browser || '')}</td>
              <td className="py-3 text-right"><button type="button" aria-label={`Delete login history record ${item.id}`} title={item.is_current_session ? 'The current session entry cannot be deleted' : 'Delete record'} disabled={historyDeleting || item.is_current_session} onClick={() => openHistoryDeleteConfirmation('single', [item.id])} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={16} /></button></td>
            </tr>)}
            {history.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-sm text-slate-500">No login history records found.</td></tr>}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>{historyTotal === 0 ? '0 records' : `${(historyPage - 1) * 25 + 1}-${Math.min(historyPage * 25, historyTotal)} of ${historyTotal}`}</span>
          <div className="flex gap-2">
            <button type="button" disabled={historyPage <= 1} onClick={() => changeHistoryPage(historyPage - 1)} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40">Previous</button>
            <button type="button" disabled={historyPage >= Math.ceil(historyTotal / 25)} onClick={() => changeHistoryPage(historyPage + 1)} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40">Next</button>
          </div>
        </div>
        <p className="mt-4 text-xs font-medium text-slate-500">This cannot be undone.</p>
      </div>
      {historyDeleteAction && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="login-history-delete-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h3 id="login-history-delete-title" className="text-xl font-black">
            {historyDeleteAction.type === 'all' ? 'Delete all login history' : historyDeleteAction.type === 'selected' ? 'Delete selected login history' : 'Delete login history record'}
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            {historyDeleteAction.type === 'all'
              ? 'Choose which records to permanently delete. Type DELETE to confirm.'
              : 'This cannot be undone. Type DELETE to confirm.'}
          </p>
          {historyDeleteAction.type === 'all' && <>
            <label className="mt-5 block text-sm font-semibold text-slate-700">Delete records</label>
            <select value={historyDeleteAge} onChange={(event) => setHistoryDeleteAge(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="7">Older than 7 days</option>
              <option value="30">Older than 30 days</option>
              <option value="90">Older than 90 days</option>
              <option value="all">All records</option>
            </select>
          </>}
          <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="login-history-delete-confirm">Type DELETE to continue</label>
          <input id="login-history-delete-confirm" value={historyDeleteConfirm} onChange={(event) => setHistoryDeleteConfirm(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" autoComplete="off" />
          <p className="mt-4 text-xs font-medium text-slate-500">This cannot be undone.</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" disabled={historyDeleting} onClick={() => setHistoryDeleteAction(null)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Cancel</button>
            <button type="button" disabled={historyDeleting || historyDeleteConfirm !== 'DELETE'} onClick={confirmHistoryDelete} className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{historyDeleting ? 'Deleting...' : 'Confirm Delete'}</button>
          </div>
        </div>
      </div>}
    </>}
    {section === 'permissions' && <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-xl font-black">Role & Permissions</h3><p className="mt-2 text-sm text-slate-500">Role</p><p className="font-bold">{profile.role || 'Unavailable'}</p><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{permissionDefinitions.map(([key, label]) => <label key={key} className={`flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold ${!canEditPermissions ? 'cursor-not-allowed opacity-60' : ''}`}><input type="checkbox" checked={Boolean(permissionState[key])} disabled={!canEditPermissions || permissionsSaving} onChange={(event) => setPermissionState((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>{canEditPermissions ? <button type="button" onClick={savePermissions} disabled={permissionsSaving} className="btn-primary mt-6 rounded-xl px-5 py-3 text-sm font-bold">{permissionsSaving ? 'Saving...' : 'Save Changes'}</button> : <p className="mt-5 text-sm font-semibold text-slate-500">Your role can view permissions but cannot edit them.</p>}</div>}
    {section === 'admin-accounts' && isMainAdmin && <AdminAccountsPanel user={user} />}
  </div>;
}

function AdminAccountsPanel({ user }) {
  const [limitInfo, setLimitInfo] = useState({ current_count: 0, max_allowed: 3, can_add: true });
  const [subAdmins, setSubAdmins] = useState([]);
  const [form, setForm] = useState({ username: '', email: '', full_name: '', phone: '', password: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const token = () => {
    try {
      const session = JSON.parse(window.localStorage.getItem('campaceSession') || '{}');
      return session.access_token || session.accessToken || user?.access_token || '';
    } catch {
      return user?.access_token || '';
    }
  };

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/sub-admins`, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to load admin accounts.');
      setLimitInfo({ current_count: data.current_count, max_allowed: data.max_allowed, can_add: data.can_add });
      setSubAdmins(Array.isArray(data.sub_admins) ? data.sub_admins : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAdmins(); }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/sub-admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to create sub admin.');
      setForm({ username: '', email: '', full_name: '', phone: '', password: '' });
      notifySuccess('Sub admin added successfully', 'admin-sub-admin-create');
      await loadAdmins();
    } catch (createError) {
      notifyError(createError, 'admin-sub-admin-create');
      await loadAdmins();
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (adminId, status) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/sub-admins/${adminId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to update sub admin status.');
      notifySuccess(status === 'Active' ? 'Sub admin activated successfully' : 'Sub admin deactivated successfully', `admin-sub-admin-status-${adminId}`);
    } catch (statusError) {
      notifyError(statusError, `admin-sub-admin-status-${adminId}`);
    } finally {
      await loadAdmins();
    }
  };

  const deleteAdmin = async (adminId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/sub-admins/${adminId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to delete sub admin.');
      notifySuccess('Sub admin deleted successfully', `admin-sub-admin-delete-${adminId}`);
    } catch (deleteError) {
      notifyError(deleteError, `admin-sub-admin-delete-${adminId}`);
    } finally {
      await loadAdmins();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-slate-900">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-600">Access control</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-black text-slate-950">Admin Accounts</h2>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-bold text-slate-700">{limitInfo.current_count} / {limitInfo.max_allowed} active admins</span>
        </div>
        {message && <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p>}
        {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <form onSubmit={handleCreate} autoComplete="off" className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Add Sub Admin</h3>
          <div className="mt-4 space-y-3">
            {['username', 'email', 'full_name', 'phone', 'password'].map((field) => <input key={field} required={['username', 'email', 'password'].includes(field)} type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'} autoComplete={field === 'password' ? 'new-password' : field === 'username' ? 'off' : undefined} placeholder={field.replace('_', ' ')} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500" />)}
          </div>
          <button type="submit" disabled={saving || loading || !limitInfo.can_add} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold transition">{saving ? 'Adding...' : 'Add Sub Admin'}</button>
          {!limitInfo.can_add && <p className="mt-3 text-sm font-bold text-slate-500">Maximum of 3 admins reached</p>}
        </form>
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Sub Admins</h3>
          <div className="mt-4 space-y-3">
            {subAdmins.map((admin) => <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="font-bold text-slate-900">{admin.full_name || admin.username}</p><p className="text-sm text-slate-500">{admin.email} · {admin.status}</p></div><div className="flex gap-2"><button type="button" onClick={() => updateStatus(admin.id, admin.status === 'Active' ? 'Inactive' : 'Active')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">{admin.status === 'Active' ? 'Deactivate' : 'Activate'}</button><button type="button" onClick={() => deleteAdmin(admin.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700">Delete</button></div></div>)}
            {!loading && subAdmins.length === 0 && <p className="text-sm text-slate-500">No sub admins have been added.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ onLogout, onNavigate, onSessionExpired, onSessionTimeoutChange, user, onUserUpdate, initialTab = 'dashboard', onTabChange }) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState(normalizeAdminTab(initialTab));
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(readExpandedAdminGroups);
  const [sidebarCounts, setSidebarCounts] = useState({});
  const visibleNavigation = useMemo(() => filterAdminNavigation(ADMIN_NAVIGATION, user), [user]);
  const activeGroup = getActiveAdminGroup(activeTab, visibleNavigation);
  useEffect(() => {
    const toggleSidebar = () => setIsSidebarOpen((isOpen) => !isOpen);
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
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeTab]);
  useEffect(() => {
    if (activeTab !== 'admin-accounts' || user?.admin_sub_admins_enabled !== false) return;
    setActiveTab('profile');
    onTabChange?.('profile');
  }, [activeTab, onTabChange, user?.admin_sub_admins_enabled]);
  useEffect(() => {
    if (!activeGroup) return;
    setExpandedGroups((current) => current.includes(activeGroup) ? current : [...current, activeGroup]);
  }, [activeGroup]);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('adminSidebarCollapsed') === 'true';
    } catch (error) {
      console.warn('Unable to read the admin sidebar preference from localStorage.', error);
      return false;
    }
  });
  const userGrowthChartRef = useRef(null);
  const salesTrendChartRef = useRef(null);
  const [userGrowthChartWidth, setUserGrowthChartWidth] = useState(100);
  const [salesTrendChartWidth, setSalesTrendChartWidth] = useState(660);
  const [isReady, setIsReady] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({
    fullName: '',
    username: '',
    email: '',
    phone: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    twoFactorEnabled: false,
  });
  const [profileMsg, setProfileMsg] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileDataLoading, setProfileDataLoading] = useState(true);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [logoutAllSessions, setLogoutAllSessions] = useState(false);
  const [adminSessions, setAdminSessions] = useState([]);
  const [loginHistory, setLoginHistory] = useState([]);
  const [backupCodes, setBackupCodes] = useState([]);
  const [profileSection, setProfileSection] = useState('personal');
  const [adminProfile, setAdminProfile] = useState({
    fullName: '',
    username: '',
    email: '',
    phone: '',
    role: '',
    status: '',
    last_login: null,
    total_actions: 0,
    avatarUrl: ADMIN_AVATAR_PLACEHOLDER,
    sessionIp: '',
  });

  const getAdminSessionToken = () => {
    return getStoredAccessToken();
  };
  const getReportRequestHeaders = () => {
    const token = getAdminSessionToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const sidebarPollingStoppedRef = useRef(false);
  const sidebarRequestInFlightRef = useRef(false);
  const refreshSidebarCounts = useCallback(async () => {
    if (
      sidebarPollingStoppedRef.current
      || sidebarRequestInFlightRef.current
      || !getStoredAccessToken()
    ) return;
    sidebarRequestInFlightRef.current = true;
    try {
      const counts = await adminApiGet('/api/admin/sidebar-counts');
      if (sidebarPollingStoppedRef.current) return;
      setSidebarCounts(counts || {});
    } catch (error) {
      if (error?.status === 401) {
        sidebarPollingStoppedRef.current = true;
        onSessionExpired?.();
        return;
      }
      setSidebarCounts({});
      console.error('Unable to refresh admin sidebar counts.', error);
    } finally {
      sidebarRequestInFlightRef.current = false;
    }
  }, [onSessionExpired]);

  const optimisticallyMarkAdminItemsSeen = useCallback((countKey, count = 1) => {
    if (count > 0) {
      setSidebarCounts((current) => decrementAdminSidebarCount(current, countKey, count));
    }
    notifyAdminSeenChanged();
  }, []);

  useEffect(() => {
    void refreshSidebarCounts();
    const handleFocus = () => {
      if (!sidebarPollingStoppedRef.current) void refreshSidebarCounts();
    };
    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(() => {
      if (!sidebarPollingStoppedRef.current) void refreshSidebarCounts();
    }, 60000);
    const unsubscribeSeenChanges = subscribeToAdminSeenChanges(() => {
      if (!sidebarPollingStoppedRef.current) void refreshSidebarCounts();
    });
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
      unsubscribeSeenChanges();
    };
  }, [activeTab, refreshSidebarCounts]);

  // === HOISTED STATES FOR ALL PANELS (OBEYING RULES OF HOOKS) ===

  // 1. User Management States
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userCollegeFilter, setUserCollegeFilter] = useState('');
  const [userDeptFilter, setUserDeptFilter] = useState('');
  const [userPage, setUserPage] = useState(1);
  const USERS_PER_PAGE = 10;
  const [dbCollegesList, setDbCollegesList] = useState([]);
  const [dbDepartmentsList, setDbDepartmentsList] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [statusSavingUserIds, setStatusSavingUserIds] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [showEnforcementModal, setShowEnforcementModal] = useState(false);
  const [enforcementTarget, setEnforcementTarget] = useState(null);
  const [enforcementReason, setEnforcementReason] = useState('Scam attempts');
  const [customEnforcementReason, setCustomEnforcementReason] = useState('');
  const [userManagementStats, setUserManagementStats] = useState({
    totalStudents: 5240,
    activeSellers: 2340,
    activeBuyers: 4120,
    suspendedAccounts: 18,
  });
  const [studentUsers, setStudentUsers] = useState([
    { id: 1, student_id: "MAU1600002", name: "Tefesayiku", email: "student@example.edu", phone: "0962714305", college: "CCI", department: "Software Engineering", year: "Year 3", is_verified: true, status: "Active", rating: "4.8 ★", activity: [{ action: "Logged in", time: "10m ago" }] },
    { id: 2, student_id: "IT2026-001", name: "Abebe Kebede", email: "student@university.edu", phone: "0911223344", college: "CCI", department: "Information Technology", year: "Year 2", is_verified: false, status: "Active", rating: "No ratings", activity: [{ action: "Updated Profile", time: "3h ago" }] }
  ]);
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [addStudentForm, setAddStudentForm] = useState({
    name: '', student_id: '', email: '', phone: '', college: '', department: '', password: '',
  });
  const [addStudentError, setAddStudentError] = useState('');
  const [addStudentLoading, setAddStudentLoading] = useState(false);

  useEffect(() => {
    setSelectedUserIds([]);
  }, [userSearchTerm, userCollegeFilter, userDeptFilter]);

  // 2. Student Verification States
  const [selectedIDPhoto, setSelectedIDPhoto] = useState(null);
  const [verificationSearchTerm, setVerificationSearchTerm] = useState('');
  const [verificationFilterDept, setVerificationFilterDept] = useState('All');
  const [verificationFilterCollege, setVerificationFilterCollege] = useState('All');
  const [verificationColleges, setVerificationColleges] = useState([]);
  const [verificationDepartments, setVerificationDepartments] = useState([]);
  const [showRejectReasonModal, setShowRejectReasonModal] = useState(false);
  const [selectedVerificationRequest, setSelectedVerificationRequest] = useState(null);
  const [verificationRejectReason, setVerificationRejectReason] = useState('Blurry Image');
  const [verificationZoom, setVerificationZoom] = useState(1);
  const [verificationRotation, setVerificationRotation] = useState(0);
  const [verifications, setVerifications] = useState([]);
  const [verificationMetrics, setVerificationMetrics] = useState({ pending: 0, verified: 0, rejected: 0 });
  const [selectedVerificationIds, setSelectedVerificationIds] = useState([]);

  // 3. Product Management States
  const [prodSearch, setProdSearch] = useState('');
  const [prodStatusFilter, setProdStatusFilter] = useState('all');
  const [productCategoryFilter, setProductCategoryFilter] = useState('All');
  const [productSubcategoryFilter, setProductSubcategoryFilter] = useState('All');
  const [productPage, setProductPage] = useState(1);
  const PRODUCTS_PER_PAGE = 10;
  const [dbCategories, setDbCategories] = useState([]);
  const [dbSubcategories, setDbSubcategories] = useState([]);
  const [productsList, setProductsList] = useState([
    { id: 1, title: "HP Pavilion Laptop", price: "24,000 ETB", seller: "Tefesayiku", category: "Electronics", condition: "New", status: "Pending", image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=900&q=80", description: "Premium lightweight laptop with 16GB RAM and a 512GB SSD for student productivity.", seller_verified: true },
    { id: 2, title: "Calculus II Textbook", price: "450 ETB", seller: "Abebe Kebede", category: "Books", condition: "Gently Used", status: "Approved", image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=900&q=80", description: "Well-maintained calculus reference book with highlighted notes and exercise solutions.", seller_verified: true }
  ]);
  const [adminProductStatusCounts, setAdminProductStatusCounts] = useState(null);
  const [selectedProductDetails, setSelectedProductDetails] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [bulkRejectMode, setBulkRejectMode] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('Inappropriate Image');
  const [pendingRejectProduct, setPendingRejectProduct] = useState(null);

  // 4. Category Management States
  const [categoriesList, setCategoriesList] = useState([]);
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [newSubParentId, setNewSubParentId] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryEditForm, setCategoryEditForm] = useState({ name: '', icon: '', is_active: true });
  const [editingSubcategory, setEditingSubcategory] = useState(null);
  const [subcategoryEditForm, setSubcategoryEditForm] = useState({ name: '', icon: '', parent_category_id: '' });

  // 5. Order Management State
  const [ordersList, setOrdersList] = useState([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilterStatus, setOrderFilterStatus] = useState('All');
  const [orderFilterRefund, setOrderFilterRefund] = useState('All');
  const [orderFilterPayment, setOrderFilterPayment] = useState('All');
  const [orderPage, setOrderPage] = useState(1);
  const ORDERS_PER_PAGE = 10;
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);
  const [disputeResolutionMessage, setDisputeResolutionMessage] = useState('');
  const [openDisputeCount, setOpenDisputeCount] = useState(0);

  const refreshOpenDisputeCount = async () => {
    try {
      const token = getAdminSessionToken();
      const isAdminSession = String(user?.role || '').toLowerCase() === 'admin';
      if (!isAdminSession || !token) return;

      const response = await fetch(`${API_BASE_URL}/api/admin/disputes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const disputes = await response.json();
      setOpenDisputeCount((Array.isArray(disputes) ? disputes : []).filter((item) => ['OPEN', 'UNDER_REVIEW'].includes(String(item.status || '').toUpperCase())).length);
    } catch (error) {
      console.error('Failed to fetch open dispute count:', error);
    }
  };

  useEffect(() => {
    refreshOpenDisputeCount();
  }, [user?.role]);

  const calculatedOrderMetrics = useMemo(() => {
    const legacyOrders = ordersList.filter((order) => getAdminOrderStatusLabel(order.order_status) === 'Legacy order').length;
    const completedOrders = ordersList.filter((order) => order.order_status === 'Completed');
    const totalSalesAmount = completedOrders.reduce((total, order) => total + (Number(order.total_amount) || 0), 0);

    return {
      totalOrders: ordersList.length,
      legacyOrders,
      completed: completedOrders.length,
      totalSales: `${totalSalesAmount.toLocaleString('en-US')} ETB`,
    };
  }, [ordersList]);

  // 6. Reports & Complaints States
  const [reportsList, setReportsList] = useState([]);
  const [reportSearchTerm, setReportSearchTerm] = useState('');
  const [reportTypeFilter, setReportTypeFilter] = useState('All');
  const [reportStatusFilter, setReportStatusFilter] = useState('All');
  const [reportPriorityFilter, setReportPriorityFilter] = useState('All');
  const [reportPage, setReportPage] = useState(1);
  const REPORTS_PER_PAGE = 10;
  const [reportDecision, setReportDecision] = useState('');
  const [reportDecisionOptions, setReportDecisionOptions] = useState([]);
  const [reportReason, setReportReason] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportActionLoading, setReportActionLoading] = useState(false);
  const [reportReviewLoading, setReportReviewLoading] = useState(false);
  const [reportReviewOwned, setReportReviewOwned] = useState(false);
  const [reportContext, setReportContext] = useState(null);
  const [reportContextLoading, setReportContextLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const reportActionInFlightRef = useRef(false);
  const [reportReporterMessage, setReportReporterMessage] = useState('');
  const [reportReviewBy, setReportReviewBy] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [evidenceImage, setEvidenceImage] = useState(null);
  const [conversationLogs, setConversationLogs] = useState(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [reportToast, setReportToast] = useState('');

  const calculatedReportMetrics = useMemo(() => {
    const openStatuses = new Set(['Open']);
    const reviewStatuses = new Set(['Review', 'Under Review']);
    const resolvedStatuses = new Set(['Resolved', 'Closed']);

    return {
      total: reportsList.length,
      open: reportsList.filter((report) => openStatuses.has(report.status)).length,
      underReview: reportsList.filter((report) => reviewStatuses.has(report.status)).length,
      resolved: reportsList.filter((report) => resolvedStatuses.has(report.status)).length,
      highPriority: reportsList.filter((report) => getReportPriority(report.issue).label === 'High').length,
    };
  }, [reportsList]);

  // 6.5 Payments Management States
  const [paymentsList, setPaymentsList] = useState([]);
  const [paymentSearchTerm, setPaymentSearchTerm] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('All');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('All');
  const [paymentDateFilter, setPaymentDateFilter] = useState('');
  const [paymentPage, setPaymentPage] = useState(1);
  const PAYMENTS_PER_PAGE = 10;
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState(null);
  const [paymentVerificationLoading, setPaymentVerificationLoading] = useState(false);
  const [paymentVerificationMessage, setPaymentVerificationMessage] = useState('');
  const [gatewayStatus, setGatewayStatus] = useState({
    gateway: 'Checking...',
    webhook: 'Checking...',
    currency: 'ETB',
    last_checked: null,
  });

  const calculatedPaymentMetrics = useMemo(() => {
    const now = new Date();
    const isToday = (payment) => {
      const date = new Date(payment.created_date || payment.date);
      return date.toDateString() === now.toDateString();
    };
    const isThisMonth = (payment) => {
      const date = new Date(payment.created_date || payment.date);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    };
    const successfulPayments = paymentsList.filter((payment) => payment.status === 'Successful');
    const revenue = (payments) => payments.reduce((total, payment) => total + (Number(payment.amount) || 0), 0);

    return {
      todayRevenue: revenue(successfulPayments.filter(isToday)),
      monthlyRevenue: revenue(successfulPayments.filter(isThisMonth)),
      successful: successfulPayments.length,
      refunded: revenue(paymentsList.filter((payment) => payment.status === 'Refunded' || payment.status === 'Reversed')),
    };
  }, [paymentsList]);

  // 7. System Notifications / Broadcast Dashboard States
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
    image_url: '',
    image_preview_url: '',
    target: 'everyone',
    department: '',
    deliveryChannels: ['in_app'],
  });
  const [announcementImageUploading, setAnnouncementImageUploading] = useState(false);
  const [announcementImageError, setAnnouncementImageError] = useState('');
  const announcementPreviewUrlRef = useRef('');
  const [announcementLog, setAnnouncementLog] = useState([]);
  const [verificationDeptsList, setVerificationDeptsList] = useState([]);
  const [notificationsSearch, setNotificationsSearch] = useState('');
  const [notificationsFilter, setNotificationsFilter] = useState('All');
  const [previewAnnouncement, setPreviewAnnouncement] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  useEffect(() => () => {
    if (announcementPreviewUrlRef.current) URL.revokeObjectURL(announcementPreviewUrlRef.current);
  }, []);

  // 8. Audit Logs List
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLogSearch, setAuditLogSearch] = useState('');
  const [auditLogFilterSeverity, setAuditLogFilterSeverity] = useState('All');
  const [auditLogFilterCategory, setAuditLogFilterCategory] = useState('All');
  const [auditLogFilterStatus, setAuditLogFilterStatus] = useState('All');
  const [auditLogStartDate, setAuditLogStartDate] = useState('');
  const [auditLogEndDate, setAuditLogEndDate] = useState('');
  const [auditLogSummary, setAuditLogSummary] = useState(null);
  const [auditLogsLoading, setAuditLogsLoading] = useState(true);
  const [auditLogsError, setAuditLogsError] = useState('');
  const [auditLogsRetry, setAuditLogsRetry] = useState(0);
  const auditSessionExpiredHandled = useRef(false);
  const [selectedLogDetails, setSelectedLogDetails] = useState(null);
  const [auditLogPage, setAuditLogPage] = useState(1);
  const [auditLogTotal, setAuditLogTotal] = useState(0);
  const auditLogPageSize = 20;
  const refreshAuditLogs = () => setAuditLogsRetry((retry) => retry + 1);

  const buildAuditLogParams = (page = auditLogPage, pageSize = auditLogPageSize) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (auditLogSearch.trim()) params.set('search', auditLogSearch.trim());
    if (auditLogFilterSeverity !== 'All') params.set('severity', auditLogFilterSeverity);
    if (auditLogFilterCategory !== 'All') params.set('category', auditLogFilterCategory);
    if (auditLogFilterStatus !== 'All') params.set('status', auditLogFilterStatus);
    if (auditLogStartDate) params.set('start_date', new Date(`${auditLogStartDate}T00:00:00`).toISOString());
    if (auditLogEndDate) params.set('end_date', new Date(`${auditLogEndDate}T23:59:59.999`).toISOString());
    return params;
  };

  const fetchAllFilteredAuditLogs = async () => {
    const logs = [];
    let total;
    let page = 1;
    do {
      const params = buildAuditLogParams(page, 100);
      const result = await adminApiGet(`/api/admin/audit-logs?${params.toString()}`);
      const items = Array.isArray(result.items) ? result.items : [];
      logs.push(...items);
      total = Number(result.total) || 0;
      page += 1;
    } while (logs.length < total);
    return logs;
  };

  useEffect(() => {
    setUserPage(1);
  }, [userSearchTerm, userCollegeFilter, userDeptFilter]);

  useEffect(() => {
    setProductPage(1);
  }, [prodSearch, prodStatusFilter, productCategoryFilter, productSubcategoryFilter]);

  useEffect(() => {
    setOrderPage(1);
  }, [orderSearch, orderFilterStatus, orderFilterPayment]);

  useEffect(() => {
    setPaymentPage(1);
  }, [paymentSearchTerm, paymentStatusFilter, paymentMethodFilter, paymentDateFilter]);

  const fetchGatewayStatus = async () => {
    try {
      const token = getAdminSessionToken();
      if (!token) {
        setGatewayStatus((current) => ({ ...current, gateway: 'Disconnected', last_checked: new Date().toISOString() }));
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/admin/payments/gateway-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Gateway status endpoint unavailable');
      const data = await response.json();
      setGatewayStatus({
        gateway: data.gateway || 'Disconnected',
        webhook: data.webhook || 'Not configured',
        currency: data.currency || 'ETB',
        last_checked: data.last_checked || null,
      });
    } catch (error) {
      console.error('Failed to fetch gateway status:', error);
      setGatewayStatus((current) => ({ ...current, gateway: 'Disconnected', last_checked: new Date().toISOString() }));
    }
  };

  useEffect(() => {
    if (activeTab !== 'payments') return;
    fetchGatewayStatus();
  }, [activeTab]);

  useEffect(() => {
    const fetchAdminProfile = async () => {
      const sessionToken = getAdminSessionToken();
      const isAdminSession = String(user?.role || '').toLowerCase() === 'admin';
      if (!sessionToken || !isAdminSession) {
        setProfileDataLoading(false);
        return;
      }

      setProfileDataLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/me`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) {
          throw new Error('Admin profile endpoint unavailable');
        }

        const data = await response.json();
        if (data.avatarUrl && typeof onUserUpdate === 'function') {
          onUserUpdate((currentUser) => {
            const updatedUser = { ...(currentUser || user || {}), avatarUrl: data.avatarUrl };
            const savedSession = window.localStorage.getItem('campaceSession');
            const session = savedSession ? JSON.parse(savedSession) : {};
            window.localStorage.setItem('campaceSession', JSON.stringify({
              ...session,
              user: updatedUser,
            }));
            return updatedUser;
          });
        }
        if (data && data.username) {
          const nextProfile = {
            fullName: data.full_name || '',
            username: data.username,
            email: data.email || '',
            phone: data.phone || '',
            role: data.role || '',
            status: data.status || '',
            last_login: data.last_login || null,
            total_actions: Number(data.total_actions ?? 0),
            avatarUrl: data.avatarUrl || ADMIN_AVATAR_PLACEHOLDER,
            sessionIp: data.session_ip || '',
          };
          setAdminProfile(nextProfile);
          setProfileForm((prev) => ({
            ...prev,
            fullName: data.full_name || '',
            username: nextProfile.username,
            email: nextProfile.email,
            phone: data.phone || '',
            twoFactorEnabled: data.two_factor_enabled ?? prev.twoFactorEnabled,
          }));
        }
      } catch (err) {
        console.warn('Failed to fetch the authenticated admin profile.', err);
      } finally {
        setProfileDataLoading(false);
      }
    };

    fetchAdminProfile();
  }, [user?.role]);

  useEffect(() => {
    if (activeTab !== 'audit-logs') return;
    let cancelled = false;
    const fetchAuditLogs = async () => {
      setAuditLogsLoading(true);
      setAuditLogsError('');
      try {
        const params = buildAuditLogParams();

        const [data, summary] = await Promise.all([
          adminApiGet(`/api/admin/audit-logs?${params.toString()}`),
          adminApiGet('/api/admin/audit-logs/summary'),
        ]);
        if (cancelled) return;
        const mappedLogs = (Array.isArray(data.items) ? data.items : []).map((log) => {
          const description = getAuditDescriptionPresentation(log.metadata?.details ?? log.metadata ?? log.description);
          const rowStatus = String(log.status || '').toUpperCase();
          const performedBy = log.actor_name || log.full_name || log.username || 'System';
          const actorRole = log.actor_role || (log.admin_id ? 'admin' : 'system');
          const device = log.device || log.metadata?.device || log.user_agent;
          const isSystemActor = String(actorRole).toLowerCase() === 'system' || String(performedBy).toLowerCase() === 'system';
          return {
            id: log.id,
            action: log.action || 'System Event',
            event_type: log.event_type || log.action || 'SYSTEM_EVENT',
            category: log.category || 'SYSTEM',
            description: description.summary,
            rawDescription: description.details,
            performed_by: performedBy,
            actor_id: log.actor_id ?? log.admin_id ?? '',
            actor_role: actorRole,
            attempted_identifier: log.metadata?.attempted_identifier || '',
            is_system_actor: isSystemActor,
            entity_type: log.entity_type || 'System',
            entity_id: log.entity_id ?? 'N/A',
            ip_address: log.ip_address || 'Unknown',
            user_agent: !device || !String(device).trim() || String(device).trim().toLowerCase() === 'unknown'
              ? isSystemActor ? 'Internal Service' : 'Web / Client'
              : device,
            date_time: log.created_at,
            status: ['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(rowStatus) ? 'SUCCESS' : 'FAILED',
            severity: String(log.severity || 'INFO').toUpperCase(),
          };
        });
        setAuditLogs(mappedLogs);
        setAuditLogTotal(Number(data.total) || 0);
        setAuditLogSummary(summary);
      } catch (error) {
        if (cancelled) return;
        setAuditLogs([]);
        setAuditLogTotal(0);
        setAuditLogSummary(null);
        if (error?.status === 401) {
          const message = 'Your session expired, please sign in again';
          setAuditLogsError(message);
          if (!auditSessionExpiredHandled.current) {
            auditSessionExpiredHandled.current = true;
            notifyError(message, 'admin-audit-session-expired');
            onSessionExpired?.();
          }
          return;
        }
        setAuditLogsError(error instanceof Error ? error.message : 'Unable to load audit logs.');
      } finally {
        if (!cancelled) setAuditLogsLoading(false);
      }
    };

    fetchAuditLogs();
    return () => { cancelled = true; };
  }, [activeTab, auditLogPage, auditLogSearch, auditLogFilterSeverity, auditLogFilterCategory, auditLogFilterStatus, auditLogStartDate, auditLogEndDate, auditLogsRetry, user?.role, onSessionExpired]);

  useEffect(() => {
    const fetchVerificationColleges = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/colleges`);
        if (!response.ok) throw new Error('College endpoint unavailable');
        const colleges = await response.json();
        setVerificationColleges(Array.isArray(colleges) ? colleges : []);
      } catch (error) {
        console.error('Failed to fetch verification colleges:', error);
        setVerificationColleges([]);
      }
    };

    fetchVerificationColleges();
  }, []);

  useEffect(() => {
    const fetchVerificationDepartments = async () => {
      try {
        const url = verificationFilterCollege !== 'All'
          ? `${API_BASE_URL}/api/admin/departments?college=${encodeURIComponent(verificationFilterCollege)}`
          : `${API_BASE_URL}/api/admin/departments`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Department endpoint unavailable');
        const departments = await response.json();
        setVerificationDepartments(Array.isArray(departments) ? departments : []);
      } catch (error) {
        console.error('Failed to fetch verification departments:', error);
        setVerificationDepartments([]);
      }
    };

    fetchVerificationDepartments();
    setVerificationFilterDept('All');
  }, [verificationFilterCollege]);

  const fetchFilteredVerifications = async () => {
    try {
      const params = new URLSearchParams();
      if (verificationSearchTerm.trim()) params.set('search', verificationSearchTerm.trim());
      if (verificationFilterCollege !== 'All') params.set('college', verificationFilterCollege);
      if (verificationFilterDept !== 'All') params.set('department', verificationFilterDept);

      const query = params.toString();
      const response = await fetch(`${API_BASE_URL}/api/admin/verifications${query ? `?${query}` : ''}`);
      if (!response.ok) throw new Error('Verification endpoint unavailable');

      const data = await response.json();
      const payload = Array.isArray(data) ? data : (data.verifications || data.items || []);
      if (!Array.isArray(data)) {
        setVerificationMetrics({
          pending: Number(data.counts?.pending ?? data.total_pending ?? 0),
          verified: Number(data.counts?.verified ?? data.total_verified ?? 0),
          rejected: Number(data.counts?.rejected ?? data.total_rejected ?? 0),
        });
      }
      const mappedVerifications = (Array.isArray(payload) ? payload : [])
        .filter((request) => request.is_verified !== true)
        .map((request, index) => ({
          id: request.id ?? request.student_id ?? index + 1,
          name: request.name ?? request.student_name ?? request.full_name ?? 'Unknown Student',
          student_id: request.student_id ?? request.studentId ?? `STU-${index + 1}`,
          email: request.email ?? request.student_email ?? 'student@campus.edu.et',
          phone: request.phone ?? request.phone_number ?? '',
          college: request.college ?? '',
          department: request.department ?? request.college_department ?? 'General Studies',
          status: request.status ?? 'Pending',
          uploaded_id_card: request.uploaded_id_card ?? request.id_card_url ?? request.image_url ?? null,
          uploaded_at: request.uploaded_at ?? request.created_at ?? new Date().toISOString(),
          reason: request.reason ?? '',
        }));

      setVerifications(mappedVerifications);
    } catch (error) {
      console.error('Failed to fetch filtered verification requests:', error);
      setVerifications([]);
    }
  };
  useEffect(() => {
    fetchFilteredVerifications();
  }, [verificationSearchTerm, verificationFilterCollege, verificationFilterDept]);

  useEffect(() => {
    const visibleIds = new Set(verifications.filter((request) => request.status === 'Pending').map((request) => request.id));
    setSelectedVerificationIds((selectedIds) => selectedIds.filter((id) => visibleIds.has(id)));
  }, [verifications]);

  const fetchUsersData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users`);
      if (!response.ok) {
        throw new Error('Users endpoint unavailable');
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        const mappedUsers = data.map((student, index) => ({
          id: student.id ?? index + 1,
          student_id: student.student_id ?? `STU-${index + 1}`,
          name: student.name ?? `Student ${index + 1}`,
          email: student.email ?? `student${index + 1}@campus.edu.et`,
          phone: student.phone ?? 'N/A',
          college: student.college ?? 'CCI',
          department: student.department ?? 'Software Engineering',
          year: student.year ?? 'Year 1',
          is_verified: Boolean(student.is_verified),
          status: student.status ?? 'Active',
          rating: student.rating ?? 'No ratings',
          wallet_balance: student.wallet_balance ?? 0,
          active_listings: student.active_listings ?? 0,
          family_alternative_payout_account: Boolean(student.family_alternative_payout_account),
          activity: student.activity ?? [{ action: 'Account synced', time: 'Recently' }],
        }));

        setStudentUsers(mappedUsers);

        const totalStudents = mappedUsers.length;
        const activeSellers = mappedUsers.filter(user => user.is_verified && (user.active_listings ?? 0) > 0).length;
        const activeBuyers = Math.max(totalStudents - activeSellers, 0);
        const suspendedAccounts = mappedUsers.filter(user => user.status === 'Suspended' || user.status === 'Deactivated').length;

        setUserManagementStats({
          totalStudents,
          activeSellers,
          activeBuyers,
          suspendedAccounts,
        });
      }
    } catch (error) {
      console.error('Failed to fetch user metrics:', error);
    }
  };

  useEffect(() => {
    fetchUsersData();
  }, []);

  const fetchDbCategories = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/categories`);
      if (!response.ok) throw new Error('Categories endpoint unavailable');
      const data = await response.json();
      setDbCategories(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch database categories:', error);
      setDbCategories([]);
    }
  };

  const fetchCatalogProducts = async () => {
    try {
      const params = new URLSearchParams();
      if (productCategoryFilter && productCategoryFilter !== 'All') {
        params.set('category', productCategoryFilter);
      }
      if (productSubcategoryFilter && productSubcategoryFilter !== 'All') {
        params.set('subcategory', productSubcategoryFilter);
      }
      const query = params.toString();
      const queryString = query ? `?${query}` : '';
      const response = await fetch(`${API_BASE_URL}/api/admin/products${queryString}`);
      if (!response.ok) {
        throw new Error('Catalog products endpoint unavailable');
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        const mappedProducts = data.map((product, index) => ({
          id: product.id ?? index + 1,
          title: product.title ?? `Product ${index + 1}`,
          price: product.price ?? `${Math.floor(Math.random() * 9000) + 500} ETB`,
          seller: product.seller ?? 'Unknown Student',
          seller_id: product.seller_id ?? product.seller ?? 'Unknown Student',
          category: product.category ?? 'General',
          subcategory: product.subcategory ?? '',
          condition: product.condition ?? (index % 2 === 0 ? 'New' : 'Gently Used'),
          status: product.status ?? 'Pending',
          moderation_reason: product.moderation_reason ?? '',
          rejection_reason: product.rejection_reason ?? '',
          image: product.image ?? null,
          description: product.description ?? 'No product description provided by the seller yet.',
          seller_verified: product.seller_verified ?? product.is_verified ?? true,
        }));
        setProductsList(mappedProducts);
      }

      try {
        const statsResponse = await fetch(`${API_BASE_URL}/api/admin/products/stats${queryString}`);
        if (!statsResponse.ok) {
          throw new Error('Catalog product statistics endpoint unavailable');
        }
        setAdminProductStatusCounts(await statsResponse.json());
      } catch (error) {
        console.error('Failed to fetch admin catalog product statistics:', error);
        setAdminProductStatusCounts(null);
      }
    } catch (error) {
      console.error('Failed to fetch admin catalog products:', error);
    }
  };

  useEffect(() => {
    fetchDbCategories();
  }, []);

  useEffect(() => {
    const selectedCategory = dbCategories.find((category) => category.name === productCategoryFilter);
    setDbSubcategories(selectedCategory?.subcategories || selectedCategory?.items || []);
    setProductSubcategoryFilter('All');
  }, [productCategoryFilter, dbCategories]);

  useEffect(() => {
    fetchCatalogProducts();
  }, [productCategoryFilter, productSubcategoryFilter]);

  // 9. System Settings Fields
  const [generalSettings, setGeneralSettings] = useState({
    marketplaceName: 'Campuse Market',
    description: 'A secure campus platform for buying and selling university essentials on UniXchange.',
    supportEmail: 'support@campus.edu.et',
    currency: 'ETB',
    timezone: 'Africa/Addis_Ababa'
  });
  const [productSettings, setProductSettings] = useState({
    maxImageSize: '5MB',
    maxImagesPerProduct: 5,
    requireApproval: true,
    allowEditing: true,
    autoHideSold: true
  });
  const [aiSettings, setAiSettings] = useState({
    recommendationEngine: 'Content-Based Filtering (TF-IDF)',
    numRecommendations: 5,
    minSimilarityScore: 0.20,
    enableAI: true
  });
  const [paymentSettings, setPaymentSettings] = useState({
    paymentProvider: 'Chapa',
    currency: 'ETB',
    enableOnlinePayment: true,
    paymentVerification: 'Automatic',
    refundsEnabled: true,
    refundPolicy: 'Admin approval required',
    maximumRefund: '100%',
    publicKey: '',
    secretKey: '',
    security: {
      automaticVerification: true,
      duplicateTransactionProtection: true,
      adminApprovalForRefunds: true,
      auditLogging: true,
    },
    commission: {
      commission_enabled: true,
      commission_type: 'percentage',
      commission_rate: '1.0',
      commission_min_fee: null,
      commission_max_fee: null,
    },
  });
  const [chapaConnectionMessage, setChapaConnectionMessage] = useState('');
  const [chapaConnectionLoading, setChapaConnectionLoading] = useState(false);
  const [gatewayInfo, setGatewayInfo] = useState({
    gateway: 'Checking...',
    webhook: 'Checking...',
    currency: 'ETB',
    last_checked: null,
  });
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifs: true,
    orderNotifs: true,
    messageNotifs: true,
    approvalNotifs: true,
    paymentNotifs: true,
    announcementNotifs: true
  });
  const [securitySettings, setSecuritySettings] = useState({
    requireStudentVerification: true,
    admin2FA: true,
    maxLoginAttempts: 5,
    sessionTimeout: 30,
    minPasswordLength: 8,
    auditLogging: true
  });
  const [studentVerificationSettings, setStudentVerificationSettings] = useState({
    allowedEmailDomain: 'university.edu.et',
    requireUniversityEmail: true,
    autoApproveStudents: false
  });
  const [moderationSettings, setModerationSettings] = useState({
    autoHideReported: true,
    requireAdminApproval: true,
    maxReportsBeforeReview: 3,
    allowStudentReports: true
  });
  const [chatSettings, setChatSettings] = useState({
    enabled: true,
    allowAttachments: true,
    maxMessageLength: 1000
  });
  const [maintenanceSettings, setMaintenanceSettings] = useState({
    maintenanceMode: false,
    maintenanceMessage: 'UniXchange is temporarily unavailable for maintenance.'
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [securitySettingsSaving, setSecuritySettingsSaving] = useState(false);
  const savedSettingsRef = useRef(null);
  const securitySettingsRef = useRef(securitySettings);
  const securitySaveTimerRef = useRef(null);
  const securitySaveSequenceRef = useRef(0);
  const securitySaveQueueRef = useRef(Promise.resolve());
  const settingsLoadRequestedRef = useRef(false);
  const updateSetting = (key, value) => {
    const [section, ...fieldPath] = key.split('.');
    const updateSection = {
      generalSettings: setGeneralSettings,
      productSettings: setProductSettings,
      aiSettings: setAiSettings,
      paymentSettings: setPaymentSettings,
      notificationSettings: setNotificationSettings,
      securitySettings: setSecuritySettings,
      studentVerificationSettings: setStudentVerificationSettings,
      moderationSettings: setModerationSettings,
      chatSettings: setChatSettings,
      maintenanceSettings: setMaintenanceSettings,
    }[section];
    if (!updateSection || fieldPath.length === 0) return;

    updateSection((previous) => {
      const next = { ...previous };
      let previousBranch = previous;
      let nextBranch = next;
      for (const field of fieldPath.slice(0, -1)) {
        nextBranch[field] = { ...(previousBranch[field] || {}) };
        previousBranch = previousBranch[field] || {};
        nextBranch = nextBranch[field];
      }
      nextBranch[fieldPath.at(-1)] = value;
      return next;
    });
  };
  const restoreSavedSettings = () => {
    const saved = savedSettingsRef.current;
    if (!saved) return;
    setGeneralSettings(saved.general);
    setProductSettings(saved.marketplace);
    setAiSettings(saved.ai);
    setPaymentSettings(saved.payment);
    setNotificationSettings(saved.notifications);
    setSecuritySettings(saved.security);
    securitySettingsRef.current = saved.security;
    setStudentVerificationSettings(saved.studentVerification);
    setModerationSettings(saved.moderation);
    setChatSettings(saved.chat);
    setMaintenanceSettings(saved.maintenance);
  };

  const saveSecuritySettings = async (nextSettings) => {
    if (settingsLoading) return;
    if (securitySaveTimerRef.current) {
      window.clearTimeout(securitySaveTimerRef.current);
      securitySaveTimerRef.current = null;
    }
    const requestSequence = ++securitySaveSequenceRef.current;
    securitySettingsRef.current = nextSettings;
    setSecuritySettings(nextSettings);
    setSecuritySettingsSaving(true);
    const save = securitySaveQueueRef.current.catch(() => { }).then(async () => {
      try {
        const saved = await patchAdminSettings({ security: nextSettings });
        const savedSecurity = saved.settings?.security || nextSettings;
        savedSettingsRef.current = {
          ...(savedSettingsRef.current || {}),
          security: savedSecurity,
        };
        if (requestSequence === securitySaveSequenceRef.current) {
          securitySettingsRef.current = savedSecurity;
          setSecuritySettings(savedSecurity);
        }
        onSessionTimeoutChange?.(Number(savedSecurity.sessionTimeout));
        notifySuccess('Security settings saved successfully.', 'admin-security-settings-save');
      } catch (error) {
        if (requestSequence === securitySaveSequenceRef.current) {
          const savedSecurity = savedSettingsRef.current?.security || nextSettings;
          securitySettingsRef.current = savedSecurity;
          setSecuritySettings(savedSecurity);
        }
        notifyError(error, 'admin-security-settings-save');
      } finally {
        if (requestSequence === securitySaveSequenceRef.current) {
          setSecuritySettingsSaving(false);
        }
      }
    });
    securitySaveQueueRef.current = save;
    return save;
  };

  const scheduleSecuritySettingsSave = (field, value) => {
    const nextSettings = { ...securitySettingsRef.current, [field]: value };
    securitySettingsRef.current = nextSettings;
    setSecuritySettings(nextSettings);
    if (securitySaveTimerRef.current) window.clearTimeout(securitySaveTimerRef.current);
    securitySaveTimerRef.current = window.setTimeout(() => {
      securitySaveTimerRef.current = null;
      saveSecuritySettings(nextSettings);
    }, 400);
  };

  const flushSecuritySettingsSave = () => {
    if (!securitySaveTimerRef.current) return;
    window.clearTimeout(securitySaveTimerRef.current);
    securitySaveTimerRef.current = null;
    saveSecuritySettings(securitySettingsRef.current);
  };

  useEffect(() => () => {
    if (securitySaveTimerRef.current) window.clearTimeout(securitySaveTimerRef.current);
  }, []);

  // KPI calculations
  const [metrics, setMetrics] = useState({
    totalStudents: 0,
    activeStudents: 0,
    totalProducts: 0,
    pendingProducts: 0,
    totalOrders: 0,
    completedOrders: 0,
    totalRevenue: '0 ETB',
    pendingReports: 0,
    gatewayStatus: {
      provider: 'Chapa',
      configured: false,
      status: 'Not configured',
      webhookStatus: 'Awaiting successful transaction',
      lastSuccessfulTransaction: null,
    },
    trends: {
      months: getDynamicMonths(),
      user_growth: [0, 0, 0, 0, 0, 0],
      product_uploads: [0, 0, 0, 0, 0, 0],
      revenue: [0, 0, 0, 0, 0, 0],
    },
    order_status_breakdown: [],
    popular_categories: [],
    college_activity: [],
    recent_activity: [],
  });
  const [dashboardMetricsLoading, setDashboardMetricsLoading] = useState(true);
  const [dashboardMetricsError, setDashboardMetricsError] = useState('');
  const [salesTrendRange, setSalesTrendRange] = useState(6);
  const [salesTrendData, setSalesTrendData] = useState([]);
  const [salesTrendLoading, setSalesTrendLoading] = useState(true);
  const [salesTrendError, setSalesTrendError] = useState('');
  const [period, setPeriod] = useState('7d');
  const [analyticsSalesData, setAnalyticsSalesData] = useState({ labels: [], revenue: [] });
  const [analyticsSalesLoading, setAnalyticsSalesLoading] = useState(true);
  const [analyticsSalesError, setAnalyticsSalesError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const fetchSalesTrend = async () => {
      setSalesTrendLoading(true);
      setSalesTrendError('');
      try {
        const token = getAdminSessionToken();
        if (!token) {
          throw new Error('An admin session is required to load sales data.');
        }
        const response = await fetch(
          `${API_BASE_URL}/api/admin/analytics/sales-trend?months=${salesTrendRange}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || 'Unable to load sales data.');
        }
        if (!Array.isArray(data)) {
          throw new Error('The sales data response was invalid.');
        }
        setSalesTrendData(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Failed to fetch admin sales trend:', error);
        setSalesTrendData([]);
        setSalesTrendError(error.message || 'Unable to load sales data.');
      } finally {
        if (!controller.signal.aborted) setSalesTrendLoading(false);
      }
    };

    fetchSalesTrend();
    return () => controller.abort();
  }, [salesTrendRange]);

  useEffect(() => {
    const controller = new AbortController();
    const loadAnalyticsSales = async () => {
      setAnalyticsSalesLoading(true);
      setAnalyticsSalesError('');
      try {
        const token = getAdminSessionToken();
        const data = await fetchAnalyticsSales(
          period,
          token,
          API_BASE_URL,
          fetch,
          controller.signal,
        );
        setAnalyticsSalesData(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Failed to fetch analytics sales data:', error);
        setAnalyticsSalesData({ labels: [], revenue: [] });
        setAnalyticsSalesError(error.message || 'Unable to load sales data.');
      } finally {
        if (!controller.signal.aborted) setAnalyticsSalesLoading(false);
      }
    };

    loadAnalyticsSales();
    return () => controller.abort();
  }, [period]);

  const fetchDashboardOverview = async () => {
    setDashboardMetricsLoading(true);
    setDashboardMetricsError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/analytics?period=${encodeURIComponent(period)}`);
      if (!response.ok) {
        throw new Error('Admin analytics endpoint unavailable');
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('No dashboard data available.');
      }
      const productBreakdown = data?.productStatusBreakdown ?? data?.product_status_breakdown ?? {};
      const totalStudents = Number(data?.total_students ?? data?.users ?? 0);
      const activeStudents = Number(data?.active_students ?? data?.activeStudents ?? 0);
      const totalProducts = Number(data?.total_products ?? data?.products ?? 0);
      const pendingProducts = Number(data?.pending_products ?? data?.pendingProducts ?? productBreakdown.Pending ?? 0);
      const totalOrders = Number(data?.total_orders ?? data?.orders ?? 0);
      const completedOrders = Number(data?.completed_orders ?? data?.completedOrders ?? 0);
      const totalRevenue = data?.revenue ?? `${Number(data?.total_revenue ?? 0).toLocaleString()} ETB`;
      const pendingReports = Number(data?.pending_reports ?? data?.pendingReports ?? 0);
      const trends = data?.trends ?? {};
      const monthlyGrowth = Array.isArray(data?.userGrowth) ? data.userGrowth : [];
      const monthlyGrowthMonths = monthlyGrowth.map((row) => row.month);
      const monthlyUserGrowth = monthlyGrowth.map((row) => Number(row.users) || 0);
      const monthlyProductUploads = monthlyGrowth.map((row) => Number(row.products) || 0);
      const orderStatusBreakdown = data?.order_status_breakdown ?? data?.orderStatus ?? [];
      const popularCategories = data?.popular_categories ?? data?.categories ?? [];
      const hasDatabaseActivity = totalStudents > 0 || totalProducts > 0 || totalOrders > 0 || Number(data?.total_revenue ?? 0) > 0;
      const emptyTrends = [0, 0, 0, 0, 0, 0];
      const revenueTrendData = Array.isArray(data?.revenueTrend)
        ? data.revenueTrend
        : Array.isArray(data?.monthlyRevenue)
          ? data.monthlyRevenue
          : Array.isArray(trends.revenue)
            ? trends.revenue
            : emptyTrends;

      setMetrics({
        totalStudents,
        activeStudents,
        totalProducts,
        pendingProducts,
        totalOrders,
        completedOrders,
        totalRevenue,
        growth: data?.growth ?? {},
        pendingReports,
        gatewayStatus: data?.gatewayStatus ?? {
          provider: 'Chapa',
          configured: false,
          status: 'Not configured',
          webhookStatus: 'Awaiting successful transaction',
          lastSuccessfulTransaction: null,
        },
        trends: {
          months: monthlyGrowth.length
            ? monthlyGrowthMonths
            : Array.isArray(trends.months)
              ? trends.months
              : Array.isArray(data?.monthsLabels)
                ? data.monthsLabels
                : data?.months ?? getDynamicMonths(),
          user_growth: hasDatabaseActivity
            ? (monthlyGrowth.length ? monthlyUserGrowth : trends.user_growth ?? data?.registrations ?? emptyTrends)
            : emptyTrends,
          product_uploads: hasDatabaseActivity
            ? (monthlyGrowth.length ? monthlyProductUploads : trends.product_uploads ?? data?.productUploadsTrend ?? data?.productUploads ?? data?.salesTrend ?? emptyTrends)
            : emptyTrends,
          revenue: hasDatabaseActivity ? revenueTrendData : emptyTrends,
        },
        registrationLabels: Array.isArray(data?.registrationLabels) ? data.registrationLabels : [],
        registrations: Array.isArray(data?.registrations) ? data.registrations : [],
        monthlyRevenue: Array.isArray(data?.monthlyRevenue) ? data.monthlyRevenue : [],
        monthsLabels: Array.isArray(data?.monthsLabels) ? data.monthsLabels : [],
        order_status_breakdown: Array.isArray(orderStatusBreakdown) ? orderStatusBreakdown : [],
        popular_categories: Array.isArray(data?.categoryPerformance ?? popularCategories) ? (data?.categoryPerformance ?? popularCategories) : [],
        college_activity: Array.isArray(data?.collegesActivity ?? data?.college_activity ?? data?.collegeActivity)
          ? (data?.collegesActivity ?? data.college_activity ?? data.collegeActivity)
          : [],
        recent_activity: Array.isArray(data?.recentActivity) ? data.recentActivity : [],
      });
    } catch (error) {
      console.error('Failed to fetch dashboard overview metrics:', error);
      setDashboardMetricsError(error.message || 'Unable to load dashboard data.');
      setMetrics({
        totalStudents: 0,
        activeStudents: 0,
        totalProducts: 0,
        pendingProducts: 0,
        totalOrders: 0,
        completedOrders: 0,
        totalRevenue: '0 ETB',
        growth: {},
        pendingReports: 0,
        gatewayStatus: {
          provider: 'Chapa',
          configured: false,
          status: 'Not configured',
          webhookStatus: 'Awaiting successful transaction',
          lastSuccessfulTransaction: null,
        },
        trends: {
          months: getDynamicMonths(),
          user_growth: [0, 0, 0, 0, 0, 0],
          product_uploads: [0, 0, 0, 0, 0, 0],
          revenue: [0, 0, 0, 0, 0, 0],
        },
        order_status_breakdown: [],
        popular_categories: [],
        college_activity: [],
        recent_activity: [],
      });
    } finally {
      setDashboardMetricsLoading(false);
    }
  };

  const analyticsSummaryCards = [
    { label: 'Users', value: metrics.total_students ?? metrics.totalStudents, growth: metrics.growth?.users },
    { label: 'Products', value: metrics.total_products ?? metrics.totalProducts, growth: metrics.growth?.products },
    { label: 'Orders', value: metrics.total_orders ?? metrics.totalOrders, growth: metrics.growth?.orders },
    { label: 'Revenue', value: metrics.total_revenue ?? metrics.totalRevenue, growth: metrics.growth?.revenue },
  ];

  useEffect(() => {
    const fetchGatewayStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/payments/gateway-status`);
        if (!response.ok) throw new Error('Gateway status endpoint unavailable');
        const data = await response.json();
        setGatewayInfo({
          gateway: data.gateway || 'Disconnected',
          webhook: data.webhook || 'Not configured',
          currency: data.currency || 'ETB',
          last_checked: data.last_checked || null,
        });
      } catch (error) {
        console.error('Failed to fetch gateway status:', error);
        setGatewayInfo((current) => ({ ...current, gateway: 'Disconnected', last_checked: new Date().toISOString() }));
      }
    };

    fetchGatewayStatus();
    const gatewayInterval = window.setInterval(fetchGatewayStatus, 30000);
    return () => window.clearInterval(gatewayInterval);
  }, []);

  const userGrowthTrend = Array.isArray(metrics.trends?.user_growth) ? metrics.trends.user_growth.slice(-6) : [];
  const productUploadsTrend = Array.isArray(metrics.trends?.product_uploads) ? metrics.trends.product_uploads.slice(-6) : [];
  const revenueTrend = (Array.isArray(metrics.trends?.revenue) ? metrics.trends.revenue : [])
    .slice(-6)
    .map((value) => Number(value) || 0);
  const lineMaxValue = Math.max(
    ...userGrowthTrend.map((value) => Number(value) || 0),
    ...productUploadsTrend.map((value) => Number(value) || 0),
    1,
  );
  const userGrowthAxisMax = Math.max(1, Math.ceil(lineMaxValue));
  const userGrowthAxisTickCount = Math.min(4, userGrowthAxisMax);
  const userGrowthPlotStart = 38;
  const userGrowthPlotEnd = Math.max(userGrowthPlotStart + 1, userGrowthChartWidth - 8);
  const userGrowthPlotWidth = userGrowthPlotEnd - userGrowthPlotStart;
  const userGrowthSvgPath = generateSvgPath(userGrowthTrend, userGrowthAxisMax, userGrowthPlotWidth);
  const productUploadsSvgPath = generateSvgPath(productUploadsTrend, userGrowthAxisMax, userGrowthPlotWidth);
  const userGrowthAreaSvgPath = generateSvgAreaPath(userGrowthTrend, userGrowthAxisMax, userGrowthPlotWidth);
  const salesChartViewWidth = Math.max(salesTrendChartWidth, 320);
  const salesChartPlotWidth = salesChartViewWidth - 106;
  const salesChartPlotStart = 58;
  const salesChartPlotEnd = salesChartViewWidth - 48;
  const salesTrendMaxRevenue = Math.max(
    ...salesTrendData.map((item) => Number(item.revenue) || 0),
    1,
  );
  const salesTrendMaxOrders = Math.max(
    ...salesTrendData.map((item) => Number(item.orders) || 0),
    1,
  );
  const hasSalesTrendData = salesTrendData.some(
    (item) => Number(item.revenue) > 0 || Number(item.orders) > 0,
  );
  const overviewOrderStatus = (Array.isArray(metrics.order_status_breakdown) ? metrics.order_status_breakdown : [])
    .reduce((statuses, status) => {
      const label = getAdminOrderStatusLabel(status.label);
      const existing = statuses.find((entry) => entry.label === label);
      if (!existing) {
        statuses.push({ ...status, label });
        return statuses;
      }

      if (status.value !== undefined) {
        existing.value = (Number(existing.value) || 0) + (Number(status.value) || 0);
      }
      if (status.percentage !== undefined) {
        existing.percentage = (Number(existing.percentage) || 0) + (Number(status.percentage) || 0);
      }
      return statuses;
    }, []);
  const overviewCategories = metrics.popular_categories ?? [];
  const collegeActivity = metrics.college_activity ?? [];
  const trendMonths = (Array.isArray(metrics.trends?.months) ? metrics.trends.months : getDynamicMonths()).slice(-6);
  const userGrowthMonthCount = Math.max(userGrowthTrend.length, productUploadsTrend.length);
  const userGrowthMonthLabels = trendMonths.slice(-userGrowthMonthCount);
  const dashboardHasData = Boolean(
    Number(metrics.totalStudents || 0)
    || Number(metrics.totalProducts || 0)
    || Number(metrics.totalOrders || 0)
    || Number(metrics.pendingReports || 0)
    || overviewCategories.length
    || collegeActivity.length
    || (metrics.recent_activity ?? []).length,
  );

  const fetchCollegesData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/colleges`);
      const colleges = await response.json();
      setDbCollegesList(colleges || []);
    } catch (err) {
      console.error('Failed to fetch colleges:', err);
      setDbCollegesList([]);
    }
  };

  useEffect(() => {
    const nextTab = normalizeAdminTab(initialTab);
    setActiveTab(nextTab);
    if (nextTab !== initialTab) onTabChange?.(nextTab);
  }, [initialTab, onTabChange]);

  useEffect(() => {
    try {
      window.localStorage.setItem('adminSidebarCollapsed', String(isDesktopSidebarCollapsed));
    } catch (error) {
      console.warn('Unable to save the admin sidebar preference to localStorage.', error);
    }
  }, [isDesktopSidebarCollapsed]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem('adminSidebarExpandedGroups', JSON.stringify(expandedGroups));
    } catch (error) {
      console.warn('Unable to save expanded admin menu groups.', error);
    }
  }, [expandedGroups]);

  useEffect(() => {
    void Promise.resolve().then(refreshSidebarCounts);
    const intervalId = window.setInterval(refreshSidebarCounts, 60000);
    return () => window.clearInterval(intervalId);
  }, [activeTab, refreshSidebarCounts]);

  useEffect(() => {
    const updateChartWidths = () => {
      const userGrowthWidth = Math.max(1, (userGrowthChartRef.current?.clientWidth ?? 148) - 48);
      const salesWidth = Math.max(1, (salesTrendChartRef.current?.clientWidth ?? 708) - 48);
      setUserGrowthChartWidth((currentWidth) => currentWidth === userGrowthWidth ? currentWidth : userGrowthWidth);
      setSalesTrendChartWidth((currentWidth) => currentWidth === salesWidth ? currentWidth : salesWidth);
    };

    updateChartWidths();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateChartWidths);
      return () => window.removeEventListener('resize', updateChartWidths);
    }

    const chartObserver = new ResizeObserver(updateChartWidths);
    if (userGrowthChartRef.current) chartObserver.observe(userGrowthChartRef.current);
    if (salesTrendChartRef.current) chartObserver.observe(salesTrendChartRef.current);
    return () => chartObserver.disconnect();
  }, [activeTab, isDesktopSidebarCollapsed, isReady]);

  useEffect(() => {
    fetchDashboardOverview();
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') fetchDashboardOverview();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'analytics') fetchDashboardOverview();
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsReady(true), 250);
    return () => window.clearTimeout(timer);
  }, []);

  // Fetch colleges list on component mount
  useEffect(() => {
    fetchCollegesData();
  }, []);

  const loadSystemSettings = async () => {
    setSettingsLoading(true);
    try {
      const responseData = await getAdminSettings();
      const data = responseData.settings || responseData;
      const marketplaceSettings = data.marketplace || {};
      const studentVerification = data.studentVerification || {};
      const normalizedStudentVerification = {
        allowedEmailDomain: studentVerification.allowedEmailDomain ?? studentVerification.allowed_email_domain ?? 'university.edu.et',
        requireUniversityEmail: studentVerification.requireUniversityEmail ?? studentVerification.require_university_email ?? true,
        autoApproveStudents: studentVerification.autoApproveStudents ?? studentVerification.auto_approve_students ?? false,
      };
      const loadedSettings = {
        general: { ...generalSettings, ...(data.general || {}) },
        marketplace: { ...productSettings, ...marketplaceSettings },
        ai: { ...aiSettings, ...(data.ai || {}) },
        payment: {
          ...paymentSettings,
          ...(data.payment || {}),
          security: { ...paymentSettings.security, ...(data.payment?.security || {}) },
          commission: { ...paymentSettings.commission, ...(data.payment?.commission || {}) },
          paymentProvider: 'Chapa',
          currency: 'ETB',
          paymentVerification: 'Automatic',
        },
        notifications: { ...notificationSettings, ...(data.notifications || {}) },
        security: { ...securitySettings, ...(data.security || {}) },
        studentVerification: normalizedStudentVerification,
        moderation: { ...moderationSettings, ...(data.moderation || {}) },
        chat: { ...chatSettings, ...(data.chat || {}) },
        maintenance: { ...maintenanceSettings, ...(data.maintenance || {}) },
      };
      savedSettingsRef.current = loadedSettings;
      securitySettingsRef.current = loadedSettings.security;

      const setIfChanged = (setter, nextValue) => setter((current) => (
        JSON.stringify(current) === JSON.stringify(nextValue) ? current : nextValue
      ));
      setIfChanged(setGeneralSettings, loadedSettings.general);
      setIfChanged(setProductSettings, loadedSettings.marketplace);
      setIfChanged(setModerationSettings, loadedSettings.moderation);
      setIfChanged(setAiSettings, loadedSettings.ai);
      setIfChanged(setPaymentSettings, loadedSettings.payment);
      setIfChanged(setNotificationSettings, loadedSettings.notifications);
      setIfChanged(setSecuritySettings, loadedSettings.security);
      setIfChanged(setStudentVerificationSettings, normalizedStudentVerification);
      setIfChanged(setChatSettings, loadedSettings.chat);
      setIfChanged(setMaintenanceSettings, loadedSettings.maintenance);
    } catch (error) {
      console.error('Failed to fetch system settings:', error);
      notifyError(error, 'admin-settings-load');
    } finally {
      setSettingsLoading(false);
    }
  };

  const loadSystemSettingsRef = useRef(null);

  useEffect(() => {
    loadSystemSettingsRef.current = loadSystemSettings;
  }, [loadSystemSettings]);

  useEffect(() => {
    if (activeTab === 'settings' && !settingsLoadRequestedRef.current) {
      settingsLoadRequestedRef.current = true;
      loadSystemSettingsRef.current?.();
    }
  }, [activeTab]);

  // Fetch reports when reports tab is active
  useEffect(() => {
    if (activeTab === 'reports') {
      fetchReportsData();
    }
  }, [activeTab]);

  // Fetch payments when payments tab is active
  useEffect(() => {
    if (activeTab === 'payments') {
      fetchPaymentsData();
    }
  }, [activeTab]);

  // Fetch orders when orders tab is active
  useEffect(() => {
    if (activeTab === 'orders') {
      fetchOrdersData();
    }
  }, [activeTab]);

  async function fetchCategories() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/categories/all`);
      if (!response.ok) throw new Error('Categories endpoint unavailable');

      const categories = await response.json();
      setCategoriesList(categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
      setCategoriesList([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'categories') {
      fetchCategories();
    }
  }, [activeTab]);

  // Fetch departments whenever college filter changes
  useEffect(() => {
    if (activeTab === 'user-management') {
      if (userCollegeFilter) {
        fetchDepartmentsData(userCollegeFilter);
      } else {
        fetchDepartmentsData(null); // Fetch all departments
      }
      // Reset department filter when college changes
      setUserDeptFilter('');
    }
  }, [userCollegeFilter, activeTab]);

  // Fetch departments from backend (optionally filtered by college)
  async function fetchDepartmentsData(selectedCollege = null) {
    try {
      const url = selectedCollege
        ? `${API_BASE_URL}/api/admin/departments?college=${encodeURIComponent(selectedCollege)}`
        : `${API_BASE_URL}/api/admin/departments`;

      const response = await fetch(url);
      const departments = await response.json();
      setDbDepartmentsList(departments || []);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
      setDbDepartmentsList([]);
    }
  };

  // Fetch reports from backend
  async function fetchReportsData() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/reports`, {
        headers: getReportRequestHeaders(),
      });
      const reports = await response.json().catch(() => []);
      if (!response.ok) throw new Error(getErrorMessage(reports));
      setReportsList(Array.isArray(reports) ? reports.map((report) => ({
        ...report,
        report_id: report.report_id || `RPT-${report.id}`,
        student: report.student || report.student_name || 'Unknown Student',
        student_id: report.student_id || 'Unknown',
        seller_id: report.seller_id || null,
        evidence_image: report.evidence_image || null,
        product_name: report.product_name || '',
        issue: report.issue || 'No issue details provided.',
        status: report.status || 'Open',
        date: report.date || new Date().toISOString(),
      })) : []);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      setReportToast(getErrorMessage(err));
    }
  }

  const markAllReportsSeen = async () => {
    const unseenCount = reportsList.filter((report) => report.is_unseen).length;
    try {
      await apiFetch('/api/admin/reports/seen-all', {
        method: 'POST',
        headers: getReportRequestHeaders(),
      });
      setReportsList((current) => current.map((report) => ({ ...report, is_unseen: false })));
      optimisticallyMarkAdminItemsSeen('unseenReports', unseenCount);
    } catch (error) {
      notifyError(error, 'admin-reports-mark-seen');
    }
  };

  // Fetch payments from backend
  async function fetchPaymentsData() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/payments?limit=1000`);
      const payments = await response.json();
      setPaymentsList(Array.isArray(payments) ? payments : []);
    } catch (err) {
      console.error('Failed to fetch payments:', err);
      // Fallback to default state already set
    }
  };

  const handleExportCSV = () => {
    const columns = ['Transaction ID', 'Buyer ID', 'Seller ID', 'Order ID', 'Amount', 'Payment Type', 'Payment Method', 'Status', 'Date'];
    const escapeCSVValue = (value) => {
      const normalizedValue = value ?? '';
      return `"${String(normalizedValue).replace(/"/g, '""')}"`;
    };
    const rows = paymentsList.map((payment) => [
      payment.transaction_id,
      payment.buyer_id,
      payment.seller_id,
      payment.order_id,
      `${payment.amount ?? 0} ETB`,
      payment.payment_type,
      payment.payment_method,
      payment.status,
      payment.date,
    ]);
    const csvContent = [columns, ...rows].map((row) => row.map(escapeCSVValue).join(',')).join('\r\n');
    const downloadUrl = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = `payment-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadUrl);
  };

  const handleExportPDF = () => {
    window.print();
  };

  const handleTestChapaConnection = async () => {
    if (chapaConnectionLoading) return;
    setChapaConnectionLoading(true);
    setChapaConnectionMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/payments/test-connection`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.detail || data.status || 'Chapa connection is not configured.');
      notifySuccess('Chapa connection verified.', 'admin-chapa-test');
    } catch (error) {
      notifyError(error, 'admin-chapa-test');
    } finally {
      setChapaConnectionLoading(false);
    }
  };

  const handleExportAuditLogsCSV = async () => {
    let logs;
    try {
      logs = await fetchAllFilteredAuditLogs();
    } catch (error) {
      setAuditLogsError(getErrorMessage(error));
      return;
    }
    const columns = ['Event ID', 'Event Type', 'Category', 'Severity', 'Action', 'Description', 'Actor ID', 'Performed By', 'Actor Role', 'Entity Type', 'Entity ID', 'IP Address', 'User Agent', 'Date & Time', 'Status', 'Metadata'];
    const sanitizeCSVField = (value) => String(value || '').replace(/,/g, ';').replace(/"/g, '""');
    const escapeCSVValue = (value) => `"${sanitizeCSVField(value)}"`;
    const rows = logs.map((log) => {
      const presentation = getAuditDescriptionPresentation(log.metadata ?? log.description);
      return [
        String(log.id || ''),
        String(log.event_type || ''),
        String(log.category || ''),
        String(log.severity || ''),
        String(log.action || ''),
        presentation.summary,
        String(log.actor_id ?? log.admin_id ?? ''),
        String(log.actor_name || log.full_name || log.username || 'System'),
        String(log.actor_role || ''),
        String(log.entity_type || ''),
        String(log.entity_id || ''),
        String(log.ip_address || ''),
        String(log.user_agent || ''),
        String(log.created_at || ''),
        String(log.status || ''),
        presentation.details,
      ].map(escapeCSVValue);
    });

    const csvContent = `\uFEFF${columns.map(escapeCSVValue).join(',')}\n${rows.map((row) => row.join(',')).join('\n')}`;
    const downloadLink = document.createElement('a');
    downloadLink.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;
    downloadLink.download = 'admin-audit-logs.csv';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // Fetch orders from backend
  async function fetchOrdersData() {
    try {
      const token = getAdminSessionToken();
      const response = await fetch(`${API_BASE_URL}/api/admin/orders`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error('Orders endpoint unavailable');
      }
      const orders = await response.json();
      if (Array.isArray(orders)) {
        setOrdersList(orders.map((order) => ({
          ...order,
          buyer_id: order.buyer_id || order.buyer || 'Unknown',
          seller_id: order.seller_id || order.seller || 'Unknown',
          product_title: order.product_title || order.item || 'Unnamed Product',
          total_amount: Number(order.total_amount ?? order.amount ?? 0),
          price: `${Number(order.total_amount ?? order.amount ?? 0).toLocaleString('en-ET')} ETB`,
          order_status: order.order_status || 'Pending',
          payment_status: order.payment_status || order.pay_status || 'Pending',
          pickup_location: order.pickup_location || 'Main Library',
          dispute_reason: order.dispute_reason || '',
          refund_status: order.refund_status || 'none',
          refund_reference: order.refund_reference || '',
          refund_attempts: Number(order.refund_attempts || 0),
          expiry_reason: order.expiry_reason || '',
          expired_at: order.expired_at || null,
          date: order.date || new Date().toISOString()
        })));
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    }
  };

  const handleRetryPaymentVerification = async () => {
    const txRef = selectedPaymentDetail?.chapa_reference || selectedPaymentDetail?.transaction_id;
    if (!txRef || paymentVerificationLoading) return;

    setPaymentVerificationLoading(true);
    setPaymentVerificationMessage('');
    try {
      const adminToken = localStorage.getItem('admin_token')
        || localStorage.getItem('token')
        || getAdminSessionToken();
      const authorization = adminToken
        ? (/^Bearer\s/i.test(adminToken) ? adminToken : `Bearer ${adminToken}`)
        : '';
      const response = await fetch(`${API_BASE_URL}/api/admin/payments/${encodeURIComponent(txRef)}/verify`, {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.verified === false || data.success === false) {
        const detail = typeof data.detail === 'string'
          ? data.detail
          : data.detail?.message || `Gateway verification returned ${data.status || 'an error'}.`;
        setPaymentVerificationMessage(
          data.status === 'Pending'
            ? 'Verification check: Still pending on Chapa.'
            : `Verification check: ${detail}`,
        );
        return;
      }

      setPaymentVerificationMessage(`Verification check: Payment verified successfully.`);
      setPaymentsList((previous) => previous.map((payment) => payment.transaction_id === txRef
        ? { ...payment, status: data.status }
        : payment));
      setSelectedPaymentDetail((previous) => previous ? { ...previous, status: data.status } : previous);
      refreshAuditLogs();
      notifySuccess('Payment verification updated.', `admin-payment-verify-${txRef}`);
    } catch (error) {
      setPaymentVerificationMessage(`Verification check: ${error.message || 'Unable to verify payment.'}`);
    } finally {
      setPaymentVerificationLoading(false);
    }
  };

  const handleTabClick = (tabId) => {
    setIsSidebarOpen(false);
    if (tabId === 'logout') {
      onLogout?.();
      return;
    }
    setActiveTab(tabId);
    onTabChange?.(tabId);
  };

  const handleAddStudentSubmit = async (event) => {
    event.preventDefault();
    const requiredFields = ['name', 'student_id', 'email', 'college', 'department', 'password'];
    if (requiredFields.some((field) => !String(addStudentForm[field] || '').trim())) {
      setAddStudentError('Please complete all required fields.');
      return;
    }

    setAddStudentLoading(true);
    setAddStudentError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addStudentForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'Unable to register student.');
      }

      await fetchUsersData();
      setAddStudentForm({ name: '', student_id: '', email: '', phone: '', college: '', department: '', password: '' });
      setShowAddStudentModal(false);
      notifySuccess('Student added successfully.', 'admin-student-add');
    } catch (error) {
      setAddStudentError(error.message || 'Unable to register student.');
      notifyError(error, 'admin-student-add');
    } finally {
      setAddStudentLoading(false);
    }
  };

  // State manipulation handlers
  const toggleVerification = async (student) => {
    if (!student?.id) return;

    const nextStatus = student.is_verified ? 'Rejected' : 'Verified';
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/verifications/${student.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, reason: '' }),
      });

      if (!response.ok) {
        throw new Error(`Verification update failed with status ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));
      setStudentUsers(prev => prev.map(user =>
        user.id === student.id
          ? { ...user, is_verified: payload.is_verified ?? nextStatus === 'Verified', verification_reason: payload.reason ?? '' }
          : user
      ));
      refreshAuditLogs();
      notifySuccess(`${student.name} verification status updated to ${nextStatus}.`, `admin-verification-${student.id}`);
    } catch (error) {
      console.error('Failed to update student verification:', error);
      notifyError(error, `admin-verification-${student.id}`);
    }
  };

  const applyAccountStatusChange = async (userId, newStatus, reason = '') => {
    const target = studentUsers.find(u => u.id === userId);
    if (!target) return;

    setStatusSavingUserIds((ids) => ids.includes(userId) ? ids : [...ids, userId]);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason })
      });

      if (!response.ok) {
        throw new Error(`User status update failed with status ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));

      setStudentUsers(prev => prev.map(user =>
        user.id === userId
          ? { ...user, status: newStatus, restriction_reason: reason || user.restriction_reason || '' }
          : user
      ));
      await fetchUsersData();
      refreshAuditLogs();

      try {
        await fetch(`${API_BASE_URL}/api/student/notifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_id: target.student_id,
            title: newStatus === 'Active' ? 'Account Restored' : 'Account Restriction Notice',
            message: newStatus === 'Active'
              ? 'Your account has been restored and you can continue using UniXchange.'
              : `Your account has been restricted. Reason: ${reason || 'Policy violation'}. Please contact support for review.`
          })
        });
      } catch (notificationError) {
        console.warn('User notification endpoint unavailable; continuing without it.', notificationError);
      }

      notifySuccess(payload?.message || `User ${newStatus.toLowerCase()} successfully.`, `admin-user-status-${userId}`);
      await fetchFilteredVerifications();
    } catch (error) {
      console.error('Failed to update user status:', error);
      notifyError(error, `admin-user-status-${userId}`);
    } finally {
      setStatusSavingUserIds((ids) => ids.filter((id) => id !== userId));
      setShowEnforcementModal(false);
      setEnforcementTarget(null);
      setEnforcementReason('Scam attempts');
    }
  };

  const handleStatusChange = (userId, newStatus) => {
    if (newStatus === 'Suspended' || newStatus === 'Deactivated') {
      const target = studentUsers.find(u => u.id === userId);
      if (!target) return;
      setEnforcementTarget({ id: userId, name: target.name, student_id: target.student_id, status: newStatus });
      setEnforcementReason('Scam attempts');
      setCustomEnforcementReason('');
      setShowEnforcementModal(true);
      return;
    }

    applyAccountStatusChange(userId, newStatus, '');
  };

  const handleDeleteUser = async (user) => {
    if (!user?.id || !window.confirm(`Delete ${user.name}? This action cannot be undone.`)) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/${user.id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to delete student.');
      setStudentUsers((previousUsers) => previousUsers.filter((student) => student.id !== user.id));
      setSelectedUser(null);
      setEditingUser(null);
      notifySuccess('Student deleted successfully.', `admin-student-delete-${user.id}`);
    } catch (error) {
      console.error('Failed to delete student:', error);
      notifyError(error, `admin-student-delete-${user.id}`);
    }
  };

  const handleBulkApproveUsers = async () => {
    if (!selectedUserIds.length) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedUserIds),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to approve selected users.');
      setStudentUsers((users) => users.map((user) => selectedUserIds.includes(user.id) ? { ...user, is_verified: true } : user));
      setSelectedUserIds([]);
      notifySuccess(payload.message || 'Selected users approved successfully.', 'admin-users-bulk-approve');
    } catch (error) {
      console.error('Failed to bulk approve users:', error);
      notifyError(error, 'admin-users-bulk-approve');
    }
  };

  const handleBulkRejectUsers = async () => {
    if (!selectedUserIds.length) return;
    const reason = window.prompt('Enter a rejection reason for the selected users:')?.trim();
    if (!reason) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/bulk-reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: selectedUserIds, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to reject selected users.');
      setStudentUsers((users) => users.map((user) => selectedUserIds.includes(user.id)
        ? { ...user, is_verified: false, verification_reason: reason }
        : user));
      setSelectedUserIds([]);
      notifySuccess(payload.message || 'Selected users rejected successfully.', 'admin-users-bulk-reject');
    } catch (error) {
      console.error('Failed to bulk reject users:', error);
      notifyError(error, 'admin-users-bulk-reject');
    }
  };

  const handleUpdateUser = async (event) => {
    event.preventDefault();
    if (!editingUser?.id) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingUser.name,
          email: editingUser.email,
          phone: editingUser.phone || null,
          college: editingUser.college,
          department: editingUser.department,
          is_verified: Boolean(editingUser.is_verified),
          status: editingUser.status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to update student.');

      setStudentUsers((previousUsers) => previousUsers.map((student) => (
        student.id === editingUser.id ? { ...student, ...payload.student } : student
      )));
      setEditingUser(null);
      notifySuccess('Student updated successfully.', `admin-student-update-${editingUser.id}`);
    } catch (error) {
      console.error('Failed to update student:', error);
      notifyError(error, `admin-student-update-${editingUser?.id || 'unknown'}`);
    }
  };

  const handleVerifyAction = async (id, actionStatus, reason = '') => {
    const target = verifications.find(v => v.id === id);
    if (!target) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/verifications/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: actionStatus,
          reason: actionStatus === 'Rejected' ? (reason || 'Verification failed') : ''
        })
      });

      if (!response.ok) {
        throw new Error(`Verification update failed with status ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));

      setVerifications(prev => prev.map(v =>
        v.id === id ? { ...v, status: actionStatus, reason: actionStatus === 'Rejected' ? (reason || 'Verification failed') : '' } : v
      ));

      setStudentUsers(prev => prev.map(u =>
        u.student_id === target.student_id ? { ...u, is_verified: actionStatus === 'Verified' } : u
      ));
      refreshAuditLogs();

      if (payload && payload.message) {
        console.info(payload.message);
      }
    } catch (error) {
      console.error('Failed to update verification status:', error);
      notifyError(error, `admin-verification-review-${id}`);
    } finally {
      setShowRejectReasonModal(false);
      setSelectedVerificationRequest(null);
      setVerificationRejectReason('Blurry Image');
    }
  };

  const handleBulkApprove = async () => {
    if (!selectedVerificationIds.length) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/verifications/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedVerificationIds),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to approve selected students.');

      setVerifications((requests) => requests.filter((request) => !selectedVerificationIds.includes(request.id)));
      setSelectedVerificationIds([]);
      await fetchFilteredVerifications();
      notifySuccess(payload.message || 'Selected students approved successfully.', 'admin-verifications-bulk-approve');
    } catch (error) {
      console.error('Failed to bulk approve students:', error);
      notifyError(error, 'admin-verifications-bulk-approve');
    }
  };

  const handleBulkReject = async () => {
    if (!selectedVerificationIds.length) return;
    const reason = window.prompt('Enter a rejection reason for the selected students:')?.trim();
    if (!reason) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/verifications/bulk-reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: selectedVerificationIds, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to reject selected students.');

      setVerifications((requests) => requests.filter((request) => !selectedVerificationIds.includes(request.id)));
      setSelectedVerificationIds([]);
      await fetchFilteredVerifications();
      notifySuccess(payload.message || 'Selected students rejected successfully.', 'admin-verifications-bulk-reject');
    } catch (error) {
      console.error('Failed to bulk reject students:', error);
      notifyError(error, 'admin-verifications-bulk-reject');
    }
  };

  const handleProductStatus = (id, actionStatus) => {
    setProductsList(prev => prev.map(p =>
      p.id === id ? { ...p, status: actionStatus } : p
    ));
  };

  const handleProductApproval = async (productId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Approved' }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.detail || payload.message || 'Failed to approve product');
      }

      setProductsList(prev => prev.map(product =>
        product.id === productId
          ? { ...product, status: 'Approved', moderation_reason: '', rejection_reason: '' }
          : product
      ));
      notifySuccess('Product approved successfully.', `admin-product-approve-${productId}`);
    } catch (error) {
      console.error('Failed to approve product:', error);
      notifyError(error, `admin-product-approve-${productId}`);
    }
  };

  const handleOpenRejectModal = (product) => {
    setBulkRejectMode(false);
    setPendingRejectProduct(product);
    setRejectReason('Inappropriate Image');
    setShowRejectModal(true);
  };

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`Permanently delete "${product.title}"? This action cannot be undone.`)) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/products/${product.id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to delete product.');
      setProductsList((products) => products.filter((item) => item.id !== product.id));
      setSelectedProductIds((ids) => ids.filter((id) => id !== product.id));
      if (selectedProductDetails?.id === product.id) setSelectedProductDetails(null);
      notifySuccess(payload.message || 'Product deleted successfully.', `admin-product-delete-${product.id}`);
    } catch (error) {
      console.error('Failed to delete product:', error);
      notifyError(error, `admin-product-delete-${product.id}`);
    }
  };

  const handleSubmitProductFlag = async () => {
    if (!pendingRejectProduct) return;

    try {
      const targetProducts = bulkRejectMode
        ? productsList.filter((product) => selectedProductIds.includes(product.id))
        : [pendingRejectProduct];
      const responses = await Promise.all(targetProducts.map((product) => fetch(`${API_BASE_URL}/api/admin/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Flagged', reason: rejectReason }),
      })));
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) throw new Error('Failed to flag one or more products');

      setProductsList(prev => prev.map(product =>
        targetProducts.some((target) => target.id === product.id)
          ? { ...product, status: 'Flagged', moderation_reason: rejectReason, rejection_reason: rejectReason }
          : product
      ));
      setSelectedProductIds([]);
      notifySuccess('Product status updated successfully.', 'admin-products-flag');
    } catch (error) {
      console.error('Failed to flag product:', error);
      notifyError(error, 'admin-products-flag');
    } finally {
      setShowRejectModal(false);
      setPendingRejectProduct(null);
      setBulkRejectMode(false);
      setRejectReason('Inappropriate Image');
    }
  };

  const handleBulkApproveProducts = async () => {
    if (!selectedProductIds.length) return;
    try {
      const responses = await Promise.all(selectedProductIds.map((productId) => fetch(`${API_BASE_URL}/api/admin/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Approved' }),
      })));
      if (responses.some((response) => !response.ok)) throw new Error('Failed to approve one or more products');
      setProductsList((products) => products.map((product) => selectedProductIds.includes(product.id)
        ? { ...product, status: 'Approved', moderation_reason: '', rejection_reason: '' }
        : product));
      setSelectedProductIds([]);
      notifySuccess('Selected products approved successfully.', 'admin-products-bulk-approve');
    } catch (error) {
      console.error('Failed to bulk approve products:', error);
      notifyError(error, 'admin-products-bulk-approve');
    }
  };

  const handleOpenBulkRejectModal = () => {
    if (!selectedProductIds.length) return;
    setBulkRejectMode(true);
    setPendingRejectProduct({ id: selectedProductIds[0], title: `${selectedProductIds.length} selected products` });
    setRejectReason('Inappropriate content');
    setShowRejectModal(true);
  };

  // Handle main category creation with API integration
  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCatName,
          icon: newCatIcon
        })
      });

      if (response.ok) {
        await fetchCategories();

        setNewCatName('');
        setNewCatIcon('📁');
        refreshAuditLogs();
        notifySuccess('Category added successfully.', 'admin-category-add');

      } else {
        const payload = await response.json().catch(() => ({}));
        notifyError(new Error(payload.detail || 'Failed to add category.'), 'admin-category-add');
      }
    } catch (err) {
      console.error('Error adding category:', err);
      notifyError(err, 'admin-category-add');
    }
  };

  // Handle subcategory creation with API integration
  const handleAddSubcategory = async (e) => {
    e.preventDefault();
    if (!newSubName.trim() || !newSubParentId) {
      notifyError(new Error('Please fill in all fields.'), 'admin-subcategory-add');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/subcategories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSubName,
          category_id: parseInt(newSubParentId),
          icon: '📂'
        })
      });

      if (response.ok) {
        await fetchCategories();

        setNewSubName('');
        setNewSubParentId('');
        refreshAuditLogs();
        notifySuccess('Subcategory added successfully.', 'admin-subcategory-add');

      } else {
        const payload = await response.json().catch(() => ({}));
        notifyError(new Error(payload.detail || 'Failed to add subcategory.'), 'admin-subcategory-add');
      }
    } catch (err) {
      console.error('Error adding subcategory:', err);
      notifyError(err, 'admin-subcategory-add');
    }
  };

  // Handle category deletion with confirmation
  const toggleCategoryExpand = (catId) => {
    setExpandedCategoryId((currentId) => currentId === catId ? null : catId);
  };

  const openCategoryEditor = (category) => {
    setEditingCategory(category);
    setCategoryEditForm({
      name: category.name || '',
      icon: category.icon || '',
      is_active: category.is_active ?? category.status !== 'Inactive',
    });
  };

  const handleUpdateCategory = async (event) => {
    event.preventDefault();
    if (!editingCategory) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/categories/${editingCategory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categoryEditForm.name.trim(),
          icon: categoryEditForm.icon.trim() || null,
          is_active: categoryEditForm.is_active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Failed to update category.');

      setCategoriesList((categories) => categories.map((category) => (
        category.id === editingCategory.id
          ? { ...category, ...payload, subcategories: category.subcategories }
          : category
      )));
      setEditingCategory(null);
      refreshAuditLogs();
      notifySuccess('Category updated successfully.', `admin-category-update-${editingCategory.id}`);
    } catch (error) {
      notifyError(error, `admin-category-update-${editingCategory.id}`);
    }
  };

  const openSubcategoryEditor = (category, subcategory) => {
    setEditingSubcategory(subcategory);
    setSubcategoryEditForm({
      name: subcategory.name || '',
      icon: subcategory.icon || '',
      parent_category_id: String(category.id),
    });
  };

  const handleUpdateSubcategory = async (event) => {
    event.preventDefault();
    if (!editingSubcategory) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/subcategories/${editingSubcategory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: subcategoryEditForm.name.trim(),
          icon: subcategoryEditForm.icon.trim() || null,
          parent_category_id: Number(subcategoryEditForm.parent_category_id),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Failed to update subcategory.');

      setCategoriesList((categories) => categories.map((category) => {
        const existingSubcategory = category.subcategories?.find((subcategory) => subcategory.id === payload.id);
        const subcategory = {
          ...(existingSubcategory || {}),
          ...payload,
          ads: payload.ads || existingSubcategory?.ads || editingSubcategory.ads || '0 ads',
        };
        const subcategories = (category.subcategories || []).filter((item) => item.id !== payload.id);
        if (category.id === payload.category_id) {
          subcategories.push(subcategory);
        }
        return { ...category, subcategories };
      }));
      setEditingSubcategory(null);
      refreshAuditLogs();
      notifySuccess('Subcategory updated successfully.', `admin-subcategory-update-${editingSubcategory.id}`);
    } catch (error) {
      notifyError(error, `admin-subcategory-update-${editingSubcategory.id}`);
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Are you sure you want to delete this category? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/categories/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        // Update local state - remove the deleted category
        setCategoriesList(prev => prev.filter(cat => cat.id !== id));

        refreshAuditLogs();
        notifySuccess('Category deleted successfully.', `admin-category-delete-${id}`);

      } else {
        const payload = await response.json().catch(() => ({}));
        notifyError(new Error(payload.detail || 'Failed to delete category.'), `admin-category-delete-${id}`);
      }
    } catch (err) {
      console.error('Error deleting category:', err);
      notifyError(err, `admin-category-delete-${id}`);
    }
  };

  // Handle subcategory deletion with confirmation
  const handleDeleteSubcategory = async (catId, subId) => {
    if (!window.confirm('Are you sure you want to delete this subcategory? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/subcategories/${subId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        // Update local state - remove the deleted subcategory from the parent category
        setCategoriesList(prev => prev.map(cat =>
          cat.id === catId
            ? {
              ...cat,
              subcategories: cat.subcategories.filter(sub => sub.id !== subId)
            }
            : cat
        ));

        refreshAuditLogs();
        notifySuccess('Subcategory deleted successfully.', `admin-subcategory-delete-${subId}`);

      } else {
        const payload = await response.json().catch(() => ({}));
        notifyError(new Error(payload.detail || 'Failed to delete subcategory.'), `admin-subcategory-delete-${subId}`);
      }
    } catch (err) {
      console.error('Error deleting subcategory:', err);
      notifyError(err, `admin-subcategory-delete-${subId}`);
    }
  };

  const handleCloseCase = async (id) => {
    const report = reportsList.find(r => r.id === id);
    if (!report || reportActionLoading) return;

    setReportActionLoading(true);

    try {
      // Call backend API with corrected endpoint and payload
      const response = await fetch(`${API_BASE_URL}/api/admin/reports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getReportRequestHeaders() },
        body: JSON.stringify({ status: 'Closed' })
      });

      if (response.ok) {
        // Update local state
        setReportsList(prev => prev.map(r =>
          r.id === id ? { ...r, status: 'Closed' } : r
        ));

        // Close modal and reset
        setSelectedReport(null);
        refreshAuditLogs();
        notifySuccess('Report closed successfully.', `admin-report-close-${id}`);
      } else {
        const payload = await response.json().catch(() => ({}));
        notifyError({ detail: payload.detail || 'Failed to close report.' }, `admin-report-close-${id}`);
      }
    } catch (err) {
      console.error('Error closing case:', err);
      notifyError({ detail: getErrorMessage(err) }, `admin-report-close-${id}`);
    } finally {
      setReportActionLoading(false);
    }
  };

  const handleResolveReport = async (id) => {
    const report = reportsList.find(r => r.id === id);
    const reason = reportReason.trim();
    const availability = reportContext?.decision_availability?.[reportDecision];
    if (!report || reportActionInFlightRef.current || !reportDecision || !availability?.enabled || reason.length < 10 || reason.length > 1000) return;

    if (reportDecision === 'hide_product' && !window.confirm(
      `Hide "${reportContext?.product?.title || report.product_name}" from listings and prevent purchases? The product and existing orders will be kept.`,
    )) return;
    if (reportDecision === 'deactivate' && !window.confirm(
      `Deactivate "${reportContext?.seller?.seller_name || report.seller_name || report.seller_id}"? This will prevent the seller from using their account.`,
    )) return;

    reportActionInFlightRef.current = true;
    setReportActionLoading(true);
    setReportError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getReportRequestHeaders() },
        body: JSON.stringify({
          decision: reportDecision,
          reason,
          ...(reportDecision === 'escalate' ? {
            reporter_message: reportReporterMessage.trim() || null,
            review_by: reportReviewBy || null,
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload.detail;
        const code = typeof detail === 'object' && detail !== null ? detail.code : null;
        const message = typeof detail === 'object' && detail !== null
          ? detail.message || t('adminReports.resolveError')
          : detail || t('adminReports.resolveError');
        throw new Error(`${code ? `${code}: ` : ''}${message}`);
      }

      setReportsList(prev => prev.map(r => r.id === id ? { ...r, ...payload } : r));
      await fetchReportsData();
      refreshAuditLogs();
      if (reportDecision === 'escalate') {
        setSelectedReport((current) => current?.id === id ? { ...current, ...payload } : current);
        setReportDecision('');
        setReportReason('');
        setReportReporterMessage('');
        setReportReviewBy('');
        await loadReportContext(id, false);
        notifySuccess('Report escalated and remains Under Review.', `admin-report-escalate-${id}`);
      } else {
        setSelectedReport(null);
        setShowReportModal(false);
        setReportContext(null);
        notifySuccess(t('adminReports.resolved'), `admin-report-resolve-${id}`);
      }
    } catch (err) {
      console.error('Error resolving report:', err);
      setReportError(getErrorMessage(err));
    } finally {
      reportActionInFlightRef.current = false;
      setReportActionLoading(false);
    }
  };

  const loadReportContext = async (reportId, markSeen = true) => {
    setReportContextLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/reports/${reportId}/context`, {
        headers: getReportRequestHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || t('adminReports.contextError'));
      if (Array.isArray(payload.decision_options)) setReportDecisionOptions(payload.decision_options);
      if (markSeen) {
        try {
          await apiFetch(`/api/admin/reports/${reportId}/seen`, {
            method: 'POST',
            headers: getReportRequestHeaders(),
          });
          const wasUnseen = reportsList.some((report) => report.id === reportId && report.is_unseen);
          setReportsList((current) => current.map((report) => (
            report.id === reportId ? { ...report, is_unseen: false } : report
          )));
          setSelectedReport((current) => current?.id === reportId ? { ...current, is_unseen: false } : current);
          optimisticallyMarkAdminItemsSeen('unseenReports', wasUnseen ? 1 : 0);
        } catch (error) {
          console.warn('Failed to mark report as seen:', error);
        }
      }
      setReportContext(payload);
    } catch (error) {
      console.error('Failed to load report context:', error);
      setReportError(getErrorMessage(error));
    } finally {
      setReportContextLoading(false);
    }
  };

  const handleOpenReportModal = async (report) => {
    setSelectedReport(report);
    setShowReportModal(true);
    setReportDecision('');
    setReportReason('');
    setReportDecisionOptions([]);
    setReportReporterMessage('');
    setReportReviewBy('');
    setReportContext(null);
    setReportError('');
    setReportReviewOwned(false);
    try {
      const decisionsResponse = await fetch(`${API_BASE_URL}/api/admin/reports/decisions`, {
        headers: getReportRequestHeaders(),
      });
      const decisions = await decisionsResponse.json().catch(() => []);
      if (!decisionsResponse.ok) throw new Error(getErrorMessage(decisions));
      setReportDecisionOptions(Array.isArray(decisions) ? decisions : []);
    } catch (error) {
      setReportError(getErrorMessage(error));
    }
    await loadReportContext(report.id);

    if (['Resolved', 'Dismissed'].includes(report.status)) return;
    setReportReviewLoading(true);
    try {
      const requestReview = (takeOver) => fetch(`${API_BASE_URL}/api/admin/reports/${report.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getReportRequestHeaders() },
        body: JSON.stringify({ take_over: takeOver }),
      });
      let response = await requestReview(false);
      let payload = await response.json().catch(() => ({}));
      if (response.status === 409 && /being reviewed by/i.test(payload.detail || '')) {
        if (!window.confirm(`${payload.detail}\n\n${t('adminReports.takeOverConfirm')}`)) return;
        response = await requestReview(true);
        payload = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        const detail = typeof payload.detail === 'string'
          ? payload.detail
          : payload.detail ? JSON.stringify(payload.detail) : t('adminReports.reviewError');
        const error = new Error(detail);
        error.status = response.status;
        error.detail = detail;
        throw error;
      }
      setSelectedReport((current) => current?.id === report.id ? { ...current, ...payload } : current);
      setReportsList((current) => current.map((item) => item.id === report.id ? { ...item, ...payload } : item));
      setReportReviewOwned(!['Resolved', 'Dismissed'].includes(payload.status));
      await loadReportContext(report.id, false);
    } catch (error) {
      console.error('Failed to open report for review:', error);
      const detail = error.detail || getErrorMessage(error);
      const message = `${error.status ? `HTTP ${error.status}: ` : ''}${detail}`;
      setReportError(message);
      setReportToast(message);
      window.setTimeout(() => setReportToast(''), 5000);
    } finally {
      setReportReviewLoading(false);
    }
  };

  const handleViewEvidence = async () => {
    if (!selectedReport?.evidence_image) {
      setReportToast('No evidence photo was attached to this report.');
      window.setTimeout(() => setReportToast(''), 3000);
      return;
    }
    if (selectedReport.evidence_image.startsWith('/api/admin/reports/')) {
      try {
        const response = await fetch(`${API_BASE_URL}${selectedReport.evidence_image}`, {
          headers: getReportRequestHeaders(),
        });
        if (!response.ok) throw new Error('Evidence could not be loaded.');
        setEvidenceImage(URL.createObjectURL(await response.blob()));
      } catch (error) {
        setReportToast(getErrorMessage(error));
        window.setTimeout(() => setReportToast(''), 3000);
      }
      return;
    }
    setEvidenceImage(selectedReport.evidence_image);
  };

  const handleViewConversationLogs = async () => {
    if (!selectedReport) return;
    setConversationLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/reports/${selectedReport.id}/conversation-logs`, {
        headers: getReportRequestHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Unable to load conversation logs.');
      setConversationLogs(payload);
    } catch (error) {
      console.error('Failed to load conversation logs:', error);
      setReportToast(getErrorMessage(error));
      window.setTimeout(() => setReportToast(''), 3000);
    } finally {
      setConversationLoading(false);
    }
  };

  const handleDeleteAnnouncement = async (id) => {
    const targetAnnouncement = announcementLog.find(item => item.id === id);
    if (!targetAnnouncement) return;

    const confirmed = window.confirm(`Delete the announcement "${targetAnnouncement.title}" from the history?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/broadcasts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getReportRequestHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Announcement deletion failed.');

      setAnnouncementLog((previous) => previous.filter((item) => item.id !== id));
      if (previewAnnouncement && previewAnnouncement.id === id) {
        setPreviewAnnouncement(null);
        setShowPreviewModal(false);
      }
      notifySuccess('Announcement deleted successfully.', `admin-announcement-delete-${id}`);
    } catch (error) {
      notifyError(error, `admin-announcement-delete-${id}`);
    }
  };

  const fetchBroadcastHistory = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/broadcasts`, {
        headers: getReportRequestHeaders(),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Broadcast history endpoint unavailable');
      }

      const data = await response.json();
      setAnnouncementLog(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch broadcast history:', error);
    }
  };

  useEffect(() => {
    if (activeTab !== 'notifications') return;

    fetchBroadcastHistory();

    const fetchVerificationDeptsList = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/departments`);
        if (!response.ok) throw new Error('Department endpoint unavailable');
        const departments = await response.json();
        setVerificationDeptsList(Array.isArray(departments) ? departments : []);
      } catch (error) {
        console.error('Failed to fetch notification departments:', error);
        setVerificationDeptsList([]);
      }
    };

    fetchVerificationDeptsList();
  }, [activeTab]);

  const handlePreviewAnnouncement = (e) => {
    e.preventDefault();

    if (!announcementForm.title.trim() || !announcementForm.message.trim()) {
      notifyError(new Error('Please enter a title and message before previewing the broadcast.'), 'admin-broadcast-preview');
      return;
    }

    if (announcementForm.target === 'department' && !announcementForm.department) {
      notifyError(new Error('Please choose a department before previewing the broadcast.'), 'admin-broadcast-preview');
      return;
    }

    setPreviewAnnouncement({
      ...announcementForm,
      id: Date.now(),
      delivered: 0,
      read: 0,
      unread: 0,
      status: 'Ready to send',
      date: new Date().toLocaleString()
    });
    setShowPreviewModal(true);
  };

  const resetAnnouncementForm = () => {
    if (announcementPreviewUrlRef.current) {
      URL.revokeObjectURL(announcementPreviewUrlRef.current);
      announcementPreviewUrlRef.current = '';
    }
    setAnnouncementImageError('');
    setAnnouncementForm({
      title: '',
      message: '',
      image_url: '',
      image_preview_url: '',
      target: 'everyone',
      department: '',
      deliveryChannels: ['in_app'],
    });
  };

  const handleAnnouncementImageChange = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || announcementImageUploading) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAnnouncementImageError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAnnouncementImageError('Image must be 5 MB or smaller.');
      return;
    }

    if (announcementPreviewUrlRef.current) URL.revokeObjectURL(announcementPreviewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    announcementPreviewUrlRef.current = previewUrl;
    setAnnouncementImageError('');
    setAnnouncementForm((previous) => ({
      ...previous,
      image_url: '',
      image_preview_url: previewUrl,
    }));

    const formData = new FormData();
    formData.append('image', file);
    setAnnouncementImageUploading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/broadcasts/image`, {
        method: 'POST',
        headers: getReportRequestHeaders(),
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Image upload failed.');
      if (!data.image_url) throw new Error('Image upload did not return a URL.');
      URL.revokeObjectURL(previewUrl);
      announcementPreviewUrlRef.current = '';
      setAnnouncementForm((previous) => ({
        ...previous,
        image_url: data.image_url,
        image_preview_url: data.image_url,
      }));
    } catch (error) {
      setAnnouncementImageError(error.message || 'Image upload failed.');
      notifyError(error, 'admin-broadcast-image-upload');
    } finally {
      setAnnouncementImageUploading(false);
    }
  };

  const removeAnnouncementImage = () => {
    if (announcementPreviewUrlRef.current) {
      URL.revokeObjectURL(announcementPreviewUrlRef.current);
      announcementPreviewUrlRef.current = '';
    }
    setAnnouncementImageError('');
    setAnnouncementForm((previous) => ({ ...previous, image_url: '', image_preview_url: '' }));
  };

  const handleEditPreview = () => {
    if (!previewAnnouncement) return;

    const targetByType = {
      everyone: 'everyone',
      sellers: 'active_sellers',
      buyers: 'active_buyers',
      department: 'department',
    };
    setAnnouncementForm((previous) => ({
      ...previous,
      title: previewAnnouncement.title || '',
      target: targetByType[previewAnnouncement.target_type] || previewAnnouncement.target || 'everyone',
      department: previewAnnouncement.department || '',
      deliveryChannels: previewAnnouncement.deliveryChannels || previewAnnouncement.delivery_channels || ['in_app'],
      message: previewAnnouncement.message || '',
      image_url: previewAnnouncement.image_url || '',
      image_preview_url: previewAnnouncement.image_preview_url || previewAnnouncement.image_url || '',
    }));
    setShowPreviewModal(false);
  };

  const handleSendBroadcast = async (announcement = announcementForm) => {
    if (broadcastSending) return;
    if (announcementImageUploading) {
      notifyError(new Error('Wait for the image upload to finish before sending.'), 'admin-broadcast-send');
      return;
    }
    if (announcement.image_preview_url && !announcement.image_url) {
      notifyError(new Error('The image could not be uploaded. Remove it or choose another image.'), 'admin-broadcast-send');
      return;
    }
    if (!announcement.title.trim() || !announcement.message.trim()) {
      notifyError(new Error('Please enter a title and message before sending the broadcast.'), 'admin-broadcast-send');
      return;
    }
    if (announcement.target === 'department' && !announcement.department) {
      notifyError(new Error('Please choose a department before sending the broadcast.'), 'admin-broadcast-send');
      return;
    }
    if (!announcement.deliveryChannels?.length) {
      notifyError(new Error('Choose at least one delivery channel.'), 'admin-broadcast-send');
      return;
    }

    setBroadcastSending(true);

    const payload = {
      title: announcement.title.trim(),
      message: announcement.message.trim(),
      image_url: announcement.image_url || null,
      target: announcement.target,
      department: announcement.target === 'department' ? announcement.department : null,
      deliveryChannels: announcement.deliveryChannels,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getReportRequestHeaders() },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Broadcast request failed');
      }

      const data = await response.json();
      const campaign = data.campaign || data;
      setAnnouncementLog((previous) => [
        campaign,
        ...previous.filter((item) => item.id !== campaign.id),
      ]);
      notifySuccess('Announcement published to campus!', 'admin-broadcast-send');
      resetAnnouncementForm();
      setPreviewAnnouncement(null);
      setShowPreviewModal(false);
    } catch (error) {
      console.error('Failed to send broadcast notification:', error);
      notifyError(error, 'admin-broadcast-send');
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleConfirmBroadcast = () => {
    if (previewAnnouncement) handleSendBroadcast(previewAnnouncement);
  };

  const handleSaveSystemSettings = async () => {
    if (settingsLoading || securitySettingsSaving) return;
    const allowedEmailDomain = String(studentVerificationSettings.allowedEmailDomain || '').trim().replace(/^@+/, '').toLowerCase();
    const validEmailDomain = isValidEmailDomain(allowedEmailDomain);
    if (studentVerificationSettings.requireUniversityEmail && !validEmailDomain) {
      notifyError(new Error('Allowed Email Domain must be a valid domain when Require University Email is on.'), 'admin-settings-domain');
      restoreSavedSettings();
      return;
    }
    const payload = {
      general: generalSettings,
      marketplace: productSettings,
      ai: aiSettings,
      payment: {
        ...paymentSettings,
        paymentProvider: 'Chapa',
        currency: 'ETB',
        paymentVerification: 'Automatic',
      },
      notifications: notificationSettings,
      security: securitySettings,
      studentVerification: {
        ...studentVerificationSettings,
        allowedEmailDomain,
      },
      moderation: moderationSettings,
      chat: chatSettings,
      maintenance: maintenanceSettings,
    };

    setSettingsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminSessionToken()}`,
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to save settings');
      }

      const savedSettings = data.settings || payload;
      savedSettingsRef.current = savedSettings;
      setSecuritySettings(savedSettings.security || payload.security);
      securitySettingsRef.current = savedSettings.security || payload.security;
      setStudentVerificationSettings(savedSettings.studentVerification || payload.studentVerification);
      invalidateAdminSettingsCache();
      try {
        await fetchDashboardOverview();
      } catch (refreshError) {
        console.error('Settings saved, but dashboard refresh failed:', refreshError);
      }
      notifySuccess('System configurations saved successfully.', 'admin-settings-save');
    } catch (error) {
      console.error('Failed to save settings:', error);
      notifyError(error, 'admin-settings-save');
      restoreSavedSettings();
    } finally {
      setSettingsLoading(false);
    }

  };

  const handleProfileFieldChange = (field, value) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    setProfileMsg('');

    if (profileForm.newPassword && profileForm.newPassword !== profileForm.confirmPassword) {
      setProfileMsg('New password and confirm password do not match.');
      return;
    }

    if (profileForm.newPassword && !profileForm.currentPassword) {
      setProfileMsg('Please enter your current password before changing the password.');
      return;
    }

    setProfileLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminSessionToken()}`,
        },
        body: JSON.stringify({
          full_name: profileForm.fullName,
          username: profileForm.username,
          email: profileForm.email,
          phone: profileForm.phone,
          current_password: profileForm.currentPassword,
          new_password: profileForm.newPassword,
          confirm_password: profileForm.confirmPassword,
          two_factor_enabled: profileForm.twoFactorEnabled,
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Profile update failed');
      }

      setAdminProfile((prev) => ({
        ...prev,
        username: profileForm.username || prev.username,
        email: profileForm.email || prev.email,
        status: 'Active',
      }));
      setProfileForm((prev) => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
      refreshAuditLogs();
      notifySuccess('Profile saved successfully.', 'admin-profile-save-legacy');
    } catch (error) {
      console.error('Profile update failed:', error);
      notifyError(error, 'admin-profile-save-legacy');
    } finally {
      setProfileLoading(false);
      window.setTimeout(() => setProfileMsg(''), 3000);
    }
  };

  const handleProfileAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    console.log('[AdminAvatar] File input changed:', file ? {
      name: file.name,
      type: file.type,
      size: file.size,
    } : 'No file selected');
    if (!file) return;

    const formData = new FormData();
    const username = profileForm.username || adminProfile.username;
    if (!username) {
      notifyError(new Error('Admin profile is not loaded yet.'), 'admin-avatar-upload-legacy');
      return;
    }
    formData.append('username', username);
    formData.append('image', file);
    console.log('[AdminAvatar] Starting upload:', {
      username,
      endpoint: `${API_BASE_URL}/api/admin/upload-avatar`,
    });

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/upload-avatar`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      console.log('[AdminAvatar] Upload response:', {
        status: response.status,
        ok: response.ok,
        data,
      });
      if (!response.ok) {
        throw new Error(data.detail || 'Avatar upload failed');
      }

      const baseAvatarUrl = data.imageUrl || data.avatarUrl;
      if (!baseAvatarUrl) throw new Error('Avatar upload did not return an image URL.');
      const urlWithTs = `${baseAvatarUrl}${baseAvatarUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      console.log('[AdminAvatar] Cache-busted avatar URL:', urlWithTs);
      setAdminProfile((prev) => ({ ...prev, avatarUrl: urlWithTs }));

      console.log('[AdminAvatar] onUserUpdate prop:', {
        provided: typeof onUserUpdate === 'function',
        user,
      });

      if (typeof onUserUpdate === 'function') {
        onUserUpdate((currentUser) => {
          const updatedUser = { ...(currentUser || user || {}), avatarUrl: urlWithTs };
          console.log('[AdminAvatar] Updating global user state:', updatedUser);
          const savedSession = window.localStorage.getItem('campaceSession');
          const session = savedSession ? JSON.parse(savedSession) : {};
          window.localStorage.setItem('campaceSession', JSON.stringify({
            ...session,
            user: updatedUser,
          }));
          console.log('[AdminAvatar] Saved updated user to campaceSession.');
          return updatedUser;
        });
      } else {
        console.error('[AdminAvatar] onUserUpdate is undefined. Pass user={user} and onUserUpdate={setUser} from App.jsx to AdminDashboard.');
        const savedSession = window.localStorage.getItem('campaceSession');
        const session = savedSession ? JSON.parse(savedSession) : {};
        window.localStorage.setItem('campaceSession', JSON.stringify({
          ...session,
          user: { ...(session.user || user || {}), avatarUrl: urlWithTs },
        }));
        console.log('[AdminAvatar] Saved fallback session update without onUserUpdate.');
      }
      window.dispatchEvent(new Event('storage'));
      console.log('[AdminAvatar] Dispatched storage event for navbar synchronization.');

      notifySuccess('Profile photo updated.', 'admin-avatar-upload-legacy');
      window.setTimeout(() => setProfileMsg(''), 2500);
    } catch (error) {
      console.error('Avatar upload failed:', error);
      notifyError(error, 'admin-avatar-upload-legacy');
      window.setTimeout(() => setProfileMsg(''), 2500);
    }
  };

  const filteredAnnouncements = useMemo(() => {
    const searchQuery = notificationsSearch.trim().toLowerCase();
    const normalizedFilter = normalizeTarget(notificationsFilter);

    return announcementLog.filter((item) => {
      const title = String(item.title || '').trim().toLowerCase();
      const message = String(item.message || '').trim().toLowerCase();
      const normalizedItemTarget = normalizeTarget(item.target);
      const matchesSearch = !searchQuery ||
        title.includes(searchQuery) ||
        message.includes(searchQuery) ||
        normalizedItemTarget.includes(searchQuery);
      const matchesFilter = normalizedFilter === 'All' || normalizedItemTarget === normalizedFilter;

      return matchesSearch && matchesFilter;
    });
  }, [announcementLog, notificationsSearch, notificationsFilter]);

  const renderTabContent = () => {
    if (activeTab === 'profile' || activeTab === 'admin-accounts') return <AdminSecurityProfile user={user} onUserUpdate={onUserUpdate} initialSection={activeTab === 'admin-accounts' ? 'admin-accounts' : 'personal'} />;
    switch (activeTab) {
      case 'profile':
        if (profileDataLoading) {
          return <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm" role="status">Loading your admin profile...</div>;
        }
        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">Security Access</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-950">Admin Security Profile</h2>
                </div>
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">
                  Protected
                </span>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-4 border-b border-slate-200 pb-5">
                  <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-4 border-emerald-200 shadow-md">
                    <img
                      src={resolveImageUrl(adminProfile.avatarUrl)}
                      alt="Admin avatar"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = ADMIN_AVATAR_PLACEHOLDER;
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-slate-950/65 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                      Change
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Primary Account</p>
                    <h3 className="mt-2 text-2xl font-black text-slate-950">{profileForm.username || 'Unavailable'}</h3>
                    <p className="text-sm text-slate-500">{adminProfile.role || 'Unavailable'}</p>
                    <label className="mt-3 inline-flex cursor-pointer items-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600">
                      Choose Photo
                      <input type="file" accept="image/*" className="hidden" onChange={handleProfileAvatarUpload} />
                    </label>
                  </div>
                </div>

                <form onSubmit={handleProfileSubmit} className="mt-6 space-y-5">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Username</label>
                    <input
                      type="text"
                      value={profileForm.username}
                      disabled
                      className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500 outline-none"
                    />
                  </div>

                  {/* <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Admin Email</label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => handleProfileFieldChange('email', e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                    />
                  </div> */}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Current Password</label>
                      <div className="relative">
                        <input
                          type={showCurrentPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={profileForm.currentPassword}
                          onChange={(e) => handleProfileFieldChange('currentPassword', e.target.value)}
                          placeholder="Enter current password"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword((previous) => !previous)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-emerald-600"
                          aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                        >
                          {showCurrentPassword ? (
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 10.58a2 2 0 002.84 2.84M9.88 4.24A10.94 10.94 0 0112 4c5 0 8.27 4.11 9.5 8a11.8 11.8 0 01-3.17 5.06M6.23 6.23C4.16 7.64 2.77 9.75 2.5 12c.45 1.43 1.3 2.96 2.59 4.25" /></svg>
                          ) : (
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 4 12 4s9.5 8 9.5 8-3.5 8-9.5 8-9.5-8-9.5-8z" /><circle cx="12" cy="12" r="2.5" /></svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">New Password</label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={profileForm.newPassword}
                          onChange={(e) => handleProfileFieldChange('newPassword', e.target.value)}
                          placeholder="Enter new password"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((previous) => !previous)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-emerald-600"
                          aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                        >
                          {showNewPassword ? (
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 10.58a2 2 0 002.84 2.84M9.88 4.24A10.94 10.94 0 0112 4c5 0 8.27 4.11 9.5 8a11.8 11.8 0 01-3.17 5.06M6.23 6.23C4.16 7.64 2.77 9.75 2.5 12c.45 1.43 1.3 2.96 2.59 4.25" /></svg>
                          ) : (
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 4 12 4s9.5 8 9.5 8-3.5 8-9.5 8-9.5-8-9.5-8z" /><circle cx="12" cy="12" r="2.5" /></svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Confirm New Password</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={profileForm.confirmPassword}
                        onChange={(e) => handleProfileFieldChange('confirmPassword', e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((previous) => !previous)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-emerald-600"
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      >
                        {showConfirmPassword ? (
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 10.58a2 2 0 002.84 2.84M9.88 4.24A10.94 10.94 0 0112 4c5 0 8.27 4.11 9.5 8a11.8 11.8 0 01-3.17 5.06M6.23 6.23C4.16 7.64 2.77 9.75 2.5 12c.45 1.43 1.3 2.96 2.59 4.25" /></svg>
                        ) : (
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 4 12 4s9.5 8 9.5 8-3.5 8-9.5 8-9.5-8-9.5-8z" /><circle cx="12" cy="12" r="2.5" /></svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-2">
                    <button
                      type="submit"
                      disabled={profileLoading}
                      className="btn-primary rounded-full px-6 py-3 text-sm font-bold shadow-sm transition"
                    >
                      {profileLoading ? 'Saving...' : 'Save Profile Changes'}
                    </button>
                  </div>

                  {profileMsg && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                      {profileMsg}
                    </div>
                  )}
                </form>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Session Analytics</h3>
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Last Login</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">{adminProfile.last_login ? new Date(adminProfile.last_login).toLocaleString() : 'Unavailable'}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Local IP Address</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">{adminProfile.sessionIp || 'Unavailable'}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Role</p>
                    <p className="mt-2 text-lg font-bold text-slate-900">{adminProfile.role || 'Unavailable'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'dashboard':
        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            {dashboardMetricsLoading ? (
              // Keep the loading surface compact so it cannot become a blank hero card.
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm" aria-label="Loading dashboard overview">
                <div className="h-7 w-64 animate-pulse rounded-lg bg-slate-200" />
                <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-slate-100" />
              </div>
            ) : dashboardHasData ? (
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black text-slate-950">UniXchange Overview</h2>
                <p className="mt-1 text-slate-500 text-sm font-semibold">Your quick operational overview across UniXchange activity.</p>
              </div>
            ) : (
              // No data gets a short message rather than an empty reserved container.
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-6 py-5 text-sm font-semibold text-slate-500" role="status">
                {dashboardMetricsError ? 'No data available' : 'No data to display'}
              </div>
            )}

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Payment Gateway</p>
                  <h3 className="mt-1 text-xl font-black text-slate-950">{metrics.gatewayStatus?.provider ?? 'Chapa'} Gateway</h3>
                </div>
                <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${metrics.gatewayStatus?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${metrics.gatewayStatus?.configured ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {metrics.gatewayStatus?.status ?? 'Not configured'}
                </span>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Webhook</p>
                  <p className="mt-1 font-bold text-slate-900">{metrics.gatewayStatus?.webhookStatus ?? 'Awaiting successful transaction'}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Latest Successful Transaction</p>
                  <p className="mt-1 font-bold text-slate-900">{metrics.gatewayStatus?.lastSuccessfulTransaction ? new Date(metrics.gatewayStatus.lastSuccessfulTransaction).toLocaleString() : 'None in the last 24 hours'}</p>
                </div>
              </div>
            </div>

            {/* 8 Core KPI Cards Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Total Students</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{metrics.totalStudents}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Active Students</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{metrics.activeStudents}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Total Products</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{metrics.totalProducts}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Pending Products</p>
                <p className="mt-3 text-3xl font-black text-slate-950 text-amber-600">{metrics.pendingProducts}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Total Orders</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{metrics.totalOrders}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Completed Orders</p>
                <p className="mt-3 text-3xl font-black text-slate-950 text-emerald-600">{metrics.completedOrders}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Total Revenue</p>
                <p className="mt-3 text-3xl font-black text-slate-950 text-blue-600">{metrics.totalRevenue}</p>
              </div>
              <div className="rounded-[24px] bg-sky-50/50 border border-sky-100 p-5">
                <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Pending Reports</p>
                <p className="mt-3 text-3xl font-black text-slate-950 text-rose-600">{metrics.pendingReports}</p>
              </div>
            </div>

            {/* 4 Interactive SVG/CSS Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div ref={userGrowthChartRef} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
                <h3 className="text-md font-bold text-slate-900 border-b pb-2 mb-4">User Growth & Product Uploads</h3>
                <div className="relative h-44 w-full mt-2">
                  <svg
                    className="h-full w-full overflow-visible"
                    viewBox={`0 0 ${userGrowthChartWidth} 130`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="User growth and product uploads by month"
                  >
                    <defs>
                      <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {Array.from({ length: userGrowthAxisTickCount + 1 }, (_, tick) => {
                      const ratio = tick / userGrowthAxisTickCount;
                      const y = 8 + ratio * 84;
                      const count = Math.round(userGrowthAxisMax * (1 - ratio));
                      return (
                        <g key={`growth-tick-${tick}`}>
                          <line x1={userGrowthPlotStart} y1={y} x2={userGrowthPlotEnd} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
                          <text x={userGrowthPlotStart - 6} y={y + 3} textAnchor="end" fill="#94a3b8" fontSize="9">{count}</text>
                        </g>
                      );
                    })}
                    <line x1={userGrowthPlotStart} y1="8" x2={userGrowthPlotStart} y2="92" stroke="#94a3b8" />
                    <line x1={userGrowthPlotStart} y1="92" x2={userGrowthPlotEnd} y2="92" stroke="#94a3b8" />
                    <path
                      d={userGrowthAreaSvgPath}
                      fill="url(#growthGrad)"
                      transform={`translate(${userGrowthPlotStart} 0)`}
                    />
                    <path d={userGrowthSvgPath} fill="none" stroke="#3b82f6" strokeWidth="2.5" transform={`translate(${userGrowthPlotStart} 0)`} />
                    <path d={productUploadsSvgPath} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="3,3" transform={`translate(${userGrowthPlotStart} 0)`} />
                    {userGrowthMonthLabels.map((month, index) => {
                      const pointCount = userGrowthMonthLabels.length;
                      const x = userGrowthPlotStart + (pointCount > 1 ? index * userGrowthPlotWidth / (pointCount - 1) : userGrowthPlotWidth / 2);
                      return (
                        <text key={`growth-month-${month}-${index}`} x={x} y="116" textAnchor="middle" fill="#94a3b8" fontSize="9">
                          {month}
                        </text>
                      );
                    })}
                    {[userGrowthTrend, productUploadsTrend].map((series, seriesIndex) => series.map((value, index) => {
                      const pointCount = series.length;
                      const x = userGrowthPlotStart + (pointCount > 1 ? index * userGrowthPlotWidth / (pointCount - 1) : userGrowthPlotWidth / 2);
                      const count = Number(value) || 0;
                      const y = 92 - (count / userGrowthAxisMax) * 84;
                      const monthIndex = Math.max(0, userGrowthMonthLabels.length - series.length + index);
                      const month = userGrowthMonthLabels[monthIndex] ?? '';
                      const userGrowthIndex = monthIndex - (userGrowthMonthLabels.length - userGrowthTrend.length);
                      const productUploadsIndex = monthIndex - (userGrowthMonthLabels.length - productUploadsTrend.length);
                      const userGrowthCount = Number(userGrowthTrend[userGrowthIndex]) || 0;
                      const productUploadsCount = Number(productUploadsTrend[productUploadsIndex]) || 0;
                      return (
                        <circle
                          key={`growth-point-${seriesIndex}-${index}`}
                          cx={x}
                          cy={y}
                          r="3"
                          fill={seriesIndex === 0 ? '#3b82f6' : '#10b981'}
                          stroke="white"
                          strokeWidth="1.5"
                        >
                          <title>{`${month}: User Growth ${userGrowthCount}; Product Uploads ${productUploadsCount}`}</title>
                        </circle>
                      );
                    }))}
                  </svg>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500 font-semibold px-1">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 bg-blue-500 rounded-full inline-block" /> User Growth</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 bg-emerald-500 rounded-full inline-block border-2 border-dashed border-white" /> Product Uploads</span>
                </div>
              </div>

              <div ref={salesTrendChartRef} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-2">
                  <h3 className="text-md font-bold text-slate-900">Sales & Revenue Trend</h3>
                  <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1" aria-label="Sales trend range">
                    {[6, 12].map((months) => (
                      <button
                        key={months}
                        type="button"
                        aria-pressed={salesTrendRange === months}
                        onClick={() => setSalesTrendRange(months)}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${salesTrendRange === months
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white'
                          }`}
                      >
                        {months} months
                      </button>
                    ))}
                  </div>
                </div>
                {salesTrendLoading ? (
                  <div className="flex h-44 items-center justify-center text-center text-sm font-semibold text-slate-500" role="status">
                    Loading sales data...
                  </div>
                ) : salesTrendError ? (
                  <div className="flex h-44 items-center justify-center px-4 text-center text-sm font-semibold text-rose-600" role="alert">
                    Unable to load sales data: {salesTrendError}
                  </div>
                ) : !hasSalesTrendData ? (
                  <div className="flex h-44 items-center justify-center text-center text-sm font-semibold text-slate-500">
                    No sales data
                  </div>
                ) : (
                  <div className="w-full">
                    <svg
                      className="h-44 w-full overflow-visible"
                      viewBox={`0 0 ${salesChartViewWidth} 190`}
                      role="img"
                      aria-label={`Sales revenue and order count for the last ${salesTrendRange} months`}
                    >
                      {[0, 1, 2, 3, 4].map((tick) => {
                        const y = 20 + tick * 35;
                        const revenueTick = salesTrendMaxRevenue * (1 - tick / 4);
                        const ordersTick = Math.round(salesTrendMaxOrders * (1 - tick / 4));
                        const revenueLabel = revenueTick >= 1000
                          ? `ETB ${(revenueTick / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
                          : `ETB ${Math.round(revenueTick).toLocaleString()}`;
                        return (
                          <g key={`sales-tick-${tick}`}>
                            <line x1={salesChartPlotStart} y1={y} x2={salesChartPlotEnd} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                            <text x="52" y={y + 3} textAnchor="end" fill="#64748b" fontSize="9">{revenueLabel}</text>
                            <text x={salesChartPlotEnd + 6} y={y + 3} fill="#64748b" fontSize="9">{ordersTick}</text>
                          </g>
                        );
                      })}
                      {salesTrendData.map((item, index) => {
                        const step = salesChartPlotWidth / salesTrendData.length;
                        const x = salesChartPlotStart + (index + 0.5) * step;
                        const revenue = Number(item.revenue) || 0;
                        const orders = Number(item.orders) || 0;
                        const barHeight = (revenue / salesTrendMaxRevenue) * 140;
                        const orderY = 160 - (orders / salesTrendMaxOrders) * 140;
                        const exactRevenue = revenue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        });
                        return (
                          <g key={item.month} aria-label={`${item.label}: ETB ${exactRevenue} revenue, ${orders} orders`}>
                            <title>{`${item.label}: ETB ${exactRevenue} revenue; ${orders} orders`}</title>
                            <rect
                              x={x - Math.min(26, step * 0.45) / 2}
                              y={160 - barHeight}
                              width={Math.min(26, step * 0.45)}
                              height={barHeight}
                              rx="3"
                              fill="#2563eb"
                              className="transition-colors hover:fill-blue-500"
                            />
                            <circle cx={x} cy={orderY} r="3.5" fill="#10b981" stroke="white" strokeWidth="1.5" />
                            <text x={x} y="179" textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="600">
                              {item.label}
                            </text>
                          </g>
                        );
                      })}
                      {salesTrendData.length > 0 && (
                        <polyline
                          points={salesTrendData.map((item, index) => {
                            const step = salesChartPlotWidth / salesTrendData.length;
                            const x = salesChartPlotStart + (index + 0.5) * step;
                            const orders = Number(item.orders) || 0;
                            const y = 160 - (orders / salesTrendMaxOrders) * 140;
                            return `${x},${y}`;
                          }).join(' ')}
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />
                      )}
                    </svg>
                    <div className="mt-1 flex justify-center gap-5 text-xs font-semibold text-slate-600">
                      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> Revenue</span>
                      <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-emerald-500" /> Orders</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
                <h3 className="text-md font-bold text-slate-900 border-b pb-2 mb-4">Popular Directory Categories</h3>
                <div className="space-y-4 py-2">
                  {overviewCategories.map((category) => (
                    <div key={category.name} className="space-y-1 text-xs font-semibold text-slate-700">
                      <div className="flex items-center justify-between">
                        <span>{category.name}</span>
                        <span>{category.percentage ?? category.value ?? 0}%</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${category.color ?? 'bg-blue-500'}`} style={{ width: `${category.percentage ?? category.value ?? 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
                <h3 className="text-md font-bold text-slate-900 border-b pb-2 mb-4">Order Status Breakdown</h3>
                <div className="flex items-center justify-center gap-6 py-4">
                  <div className="relative h-28 w-28 shrink-0">
                    <svg className="h-full w-full rotate-[-90deg]" viewBox="0 0 36 36">
                      <circle cx="18" cy="16" r="15.915" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                      {metrics.totalOrders === 0 ? (
                        <>
                          <circle cx="18" cy="16" r="15.915" fill="none" stroke="#e2e8f0" strokeWidth="4" strokeDasharray="100 0" />
                          <text x="18" y="17" textAnchor="middle" fill="#94a3b8" fontSize="3.5" fontWeight="600">No Orders</text>
                        </>
                      ) : (
                        overviewOrderStatus.map((status, index) => {
                          const offset = overviewOrderStatus
                            .slice(0, index)
                            .reduce((total, item) => total + Number(item.percentage ?? item.value ?? 0), 0);
                          const value = Number(status.percentage ?? status.value ?? 0);
                          return (
                            <circle
                              key={status.label}
                              cx="18"
                              cy="16"
                              r="15.915"
                              fill="none"
                              stroke={status.color ?? '#64748b'}
                              strokeWidth="4"
                              strokeDasharray={`${value} ${100 - value}`}
                              strokeDashoffset={`${-offset}`}
                            />
                          );
                        })
                      )}
                    </svg>
                  </div>
                  <div className="space-y-2 text-xs font-semibold text-slate-600">
                    {overviewOrderStatus.map((status) => (
                      <div key={status.label} className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color ?? '#64748b' }} />
                        {status.label} ({status.percentage ?? status.value ?? 0}%)
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            <div className="rounded-[30px] border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-600">Audit Feed</p>
                  <h3 className="mt-1 text-xl font-black">Recent UniXchange Administrative Activity</h3>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Live</span>
              </div>
              <div>
                {(metrics.recent_activity ?? []).length === 0 ? (
                  <p className="py-3 text-sm font-medium text-slate-600">No administrative activity has been recorded yet.</p>
                ) : (
                  (metrics.recent_activity ?? []).map((item, index) => (
                    <div key={item.id ?? `${item.time}-${index}`} className="flex flex-wrap items-start gap-x-3 border-b border-slate-100 py-3 last:border-0">
                      <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-y-1">
                        <span className="text-sm font-bold text-slate-900">{item.user || item.username || 'System'}</span>
                        <span className="ml-2 min-w-0 break-words text-sm font-medium text-slate-700">{String(item.description || item.action || item.details || item.message || item.event || 'Administrative action').replace(/\bmarketplace\b/gi, 'UniXchange')}</span>
                      </div>
                      <time className="ml-auto whitespace-nowrap text-xs font-medium text-slate-500">{item.time || '--:--'}</time>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        );
      case 'user-management': {
        const filteredUsers = studentUsers.filter(u => {
          const name = u.name ?? '';
          const studentId = u.student_id ?? '';
          const email = u.email ?? '';
          const matchesSearch =
            name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
            studentId.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
            email.toLowerCase().includes(userSearchTerm.toLowerCase());

          const matchesCollege = userCollegeFilter ? (u.college ?? '') === userCollegeFilter : true;
          const matchesDept = userDeptFilter ? (u.department ?? '') === userDeptFilter : true;

          return matchesSearch && matchesCollege && matchesDept;
        });
        const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
        const displayedUsers = filteredUsers.slice((userPage - 1) * USERS_PER_PAGE, userPage * USERS_PER_PAGE);
        const renderUserAvatar = (student) => {
          const avatarUrl = student.avatar_url || student.avatarUrl;
          return (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-sm font-bold text-slate-600">
              {avatarUrl ? (
                <img src={resolveImageUrl(avatarUrl)} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} />
              ) : String(student.name || '?').trim().charAt(0).toUpperCase()}
            </span>
          );
        };
        const renderVerificationBadge = (student) => {
          const isRejected = !student.is_verified && Boolean(student.verification_reason);
          const label = student.is_verified ? 'Verified' : isRejected ? 'Rejected' : 'Pending';
          const badgeColor = student.is_verified
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : isRejected
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-slate-200 bg-slate-100 text-slate-600';
          return (
            <button
              type="button"
              onClick={() => toggleVerification(student)}
              title={`Change verification for ${student.name}`}
              aria-label={`${label}: change verification for ${student.name}`}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${badgeColor}`}
            >
              {student.is_verified && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {label}
            </button>
          );
        };
        const renderStatusBadge = (student) => {
          return <StatusBadge status={student.status} title={student.status} />;
        };
        const renderUserActions = (student) => (
          <>
            <ActionButton
              type="button"
              onClick={() => setSelectedUser(student)}
              title="Details"
              aria-label={`Details for ${student.name}`}
              className="gap-1 border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Details</span>
            </ActionButton>
            <ActionButton
              type="button"
              onClick={() => {
                setEditingUser({ ...student });
                fetchDepartmentsData(student.college);
              }}
              title="Edit"
              aria-label={`Edit ${student.name}`}
              className="border border-sky-200 bg-sky-50 text-sky-700 transition hover:bg-sky-100"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </ActionButton>
            <ActionButton
              type="button"
              onClick={() => handleDeleteUser(student)}
              title="Delete"
              aria-label={`Delete ${student.name}`}
              className="border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </ActionButton>
          </>
        );
        const renderStatusControl = (student) => (
          <select
            value={student.status}
            onChange={(event) => handleStatusChange(student.id, event.target.value)}
            disabled={statusSavingUserIds.includes(student.id)}
            title="Change enforcement status"
            aria-label={`Change status for ${student.name}`}
            className="h-9 min-w-[110px] shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-wait disabled:opacity-60"
          >
            <option value="Active">Active</option>
            <option value="Suspended">Suspend</option>
            <option value="Deactivated">Deactivate</option>
          </select>
        );
        const handleExportUsersCSV = () => exportCSVFile('users.csv', ['ID', 'Name', 'Email', 'Phone', 'College', 'Department', 'Verified Status', 'Account Status'], filteredUsers.map((student) => [
          String(student.id || ''), String(student.name || ''), String(student.email || ''), String(student.phone || ''),
          String(student.college || ''), String(student.department || ''), String(student.is_verified || ''), String(student.status || ''),
        ]));
        const handleExportUsersPDF = () => exportPDFFile('users.pdf', 'User Management Report', ['ID', 'Name', 'Email', 'Phone', 'College', 'Department', 'Verified', 'Account Status'], filteredUsers.map((student) => [
          String(student.id || ''), String(student.name || ''), String(student.email || ''), String(student.phone || ''),
          String(student.college || ''), String(student.department || ''), String(student.is_verified || ''), String(student.status || ''),
        ]));

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="flex flex-col gap-4 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-950">User Management</h2>
                <p className="mt-1 text-slate-500 text-sm font-semibold">Monitor student profiles, enforce restrictions, and verify academic IDs.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleExportUsersCSV} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer">Export CSV</button>
                <button type="button" onClick={handleExportUsersPDF} className="rounded-full bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer">Export PDF</button>
                <button
                  type="button"
                  onClick={() => {
                    setAddStudentError('');
                    setShowAddStudentModal(true);
                  }}
                  className="btn-primary inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-bold shadow-sm transition"
                >
                  + Add Student
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              {[
                { label: 'Total Students', value: userManagementStats.totalStudents.toLocaleString(), color: 'bg-sky-50 border-sky-200 text-sky-700' },
                { label: 'Active Sellers', value: userManagementStats.activeSellers.toLocaleString(), color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                { label: 'Active Buyers', value: userManagementStats.activeBuyers.toLocaleString(), color: 'bg-violet-50 border-violet-200 text-violet-700' },
                { label: 'Suspended Accounts', value: userManagementStats.suspendedAccounts.toLocaleString(), color: 'bg-amber-50 border-amber-200 text-amber-700' },
              ].map((metric) => (
                <div key={metric.label} className={`rounded-[24px] border p-5 shadow-sm ${metric.color}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{metric.label}</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-3 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Search Directory</label>
                <input
                  type="text"
                  placeholder="Search by name, ID, or email..."
                  value={userSearchTerm}
                  onChange={(e) => setUserSearchTerm(e.target.value)}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Filter by College</label>
                <select
                  value={userCollegeFilter}
                  onChange={(e) => setUserCollegeFilter(e.target.value)}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none"
                >
                  <option value="">All Colleges</option>
                  {dbCollegesList.map(college => (
                    <option key={college} value={college}>{college}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Filter by Department</label>
                <select
                  value={userDeptFilter}
                  onChange={(e) => setUserDeptFilter(e.target.value)}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none"
                >
                  <option value="">All Departments</option>
                  {dbDepartmentsList.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
            </div>

            {selectedUserIds.length > 0 && (
              <div className="sticky bottom-3 z-30 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-slate-600">{selectedUserIds.length} users selected</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleBulkApproveUsers} className="h-9 shrink-0 whitespace-nowrap rounded-full bg-emerald-500 px-4 text-xs font-bold text-white hover:bg-emerald-600">Approve Selected</button>
                  <button type="button" onClick={handleBulkRejectUsers} className="h-9 shrink-0 whitespace-nowrap rounded-full bg-rose-500 px-4 text-xs font-bold text-white hover:bg-rose-600">Reject Selected</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 md:hidden">
              {displayedUsers.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">No users found</div>
              ) : displayedUsers.map((student) => (
                <article key={student.id} className="min-h-[72px] min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    {renderUserAvatar(student)}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 title={student.name} className="truncate text-sm font-semibold text-slate-900">{student.name}</h3>
                        {student.family_alternative_payout_account && <span title="Seller confirmed an alternative payout account name" className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">Family/Alternative Payout Account</span>}
                      </div>
                      <p title={`${student.student_id || ''} · ${student.email || ''}`} className="max-w-[220px] truncate whitespace-nowrap text-xs text-slate-500">{student.student_id} · {student.email}</p>
                    </div>
                    <input type="checkbox" checked={selectedUserIds.includes(student.id)} onChange={(event) => setSelectedUserIds((ids) => event.target.checked ? [...ids, student.id] : ids.filter((id) => id !== student.id))} aria-label={`Select ${student.name}`} className="h-4 w-4 shrink-0 accent-emerald-600" />
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-3 text-sm">
                    <div className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">College</span><p title={student.college || ''} className="line-clamp-2 font-semibold text-slate-700">{student.college || 'Not provided'}</p></div>
                    <div className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Department</span><p title={student.department || ''} className="line-clamp-2 font-semibold text-slate-700">{(student.department ?? '').replace('Department of ', '') || 'Not provided'}</p></div>
                    <div className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Phone</span><p title={student.phone || 'No Phone'} className="truncate whitespace-nowrap font-semibold text-slate-700">{student.phone || 'No Phone'}</p></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {renderVerificationBadge(student)}
                    {renderStatusBadge(student)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {renderUserActions(student)}
                    {renderStatusControl(student)}
                  </div>
                </article>
              ))}
            </div>

            <AdminTable className="hidden max-h-[70vh] overflow-y-auto border border-slate-200 bg-white shadow-sm md:block">
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="min-w-[220px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={filteredUsers.length > 0 && filteredUsers.every((user) => selectedUserIds.includes(user.id))} onChange={(event) => setSelectedUserIds(event.target.checked ? filteredUsers.map((user) => user.id) : [])} aria-label="Select all filtered students" className="h-4 w-4 shrink-0 accent-emerald-600" />
                      <span>Student</span>
                    </div>
                  </th>
                  <th className="min-w-[200px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">College</th>
                  <th className="min-w-[180px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">Department</th>
                  <th className="min-w-[130px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">Phone</th>
                  <th className="min-w-[110px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">Verified</th>
                  <th title="Enforcement status" className="min-w-[110px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">Status</th>
                  <th className="min-w-[110px] text-xs font-bold uppercase tracking-wide whitespace-nowrap px-4 py-3 text-left">Change status</th>
                  <th className="sticky right-0 z-30 min-w-[170px] whitespace-nowrap bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-left shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.4)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedUsers.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm font-semibold text-slate-500">No users found</td></tr>
                ) : displayedUsers.map((student) => (
                  <tr key={student.id} className="h-[72px] border-b border-slate-100 transition hover:bg-slate-50/60">
                    <td className="min-w-[220px] px-4 py-3 align-middle">
                      <div className="flex min-w-0 items-center gap-3">
                        {renderUserAvatar(student)}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p title={student.name} className="truncate font-semibold text-slate-900">{student.name}</p>
                            {student.family_alternative_payout_account && <span title="Seller confirmed an alternative payout account name" className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">Family/Alternative Payout Account</span>}
                          </div>
                          <p title={`${student.student_id || ''} · ${student.email || ''}`} className="max-w-[220px] truncate whitespace-nowrap text-xs text-slate-500">{student.student_id} · {student.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="min-w-[200px] px-4 py-3 align-middle"><p title={student.college || ''} className="line-clamp-2 font-semibold text-slate-700">{student.college || 'Not provided'}</p></td>
                    <td className="min-w-[180px] px-4 py-3 align-middle"><p title={student.department || ''} className="line-clamp-2 font-semibold text-slate-700">{(student.department ?? '').replace('Department of ', '') || 'Not provided'}</p></td>
                    <td className="min-w-[130px] px-4 py-3 align-middle"><p title={student.phone || 'No Phone'} className="truncate whitespace-nowrap font-semibold text-slate-700">{student.phone || 'No Phone'}</p></td>
                    <td className="min-w-[110px] px-4 py-3 align-middle">{renderVerificationBadge(student)}</td>
                    <td className="min-w-[110px] px-4 py-3 align-middle">{renderStatusBadge(student)}</td>
                    <td className="min-w-[110px] px-4 py-3 align-middle">{renderStatusControl(student)}</td>
                    <td className="sticky right-0 z-10 min-w-[170px] whitespace-nowrap bg-white px-4 py-3 align-middle shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.4)]">
                      <div className="flex flex-nowrap items-center justify-center gap-2">{renderUserActions(student)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <button type="button" onClick={() => setUserPage((page) => Math.max(1, page - 1))} disabled={userPage === 1} className="h-9 shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
              <span className="whitespace-nowrap text-sm font-semibold text-slate-500">Page {userPage} of {totalUserPages}</span>
              <button type="button" onClick={() => setUserPage((page) => Math.min(totalUserPages, page + 1))} disabled={userPage === totalUserPages} className="h-9 shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
            </div>

            {selectedUser && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
                <div className="relative bg-white rounded-[28px] p-8 max-w-lg w-full shadow-2xl border border-slate-100 animate-fade-in">
                  <div className="flex items-center justify-between border-b pb-4 mb-6">
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">{selectedUser.name}</h4>
                      <p className="text-xs text-slate-500 mt-1">Full operational log trail • {selectedUser.student_id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-xs font-semibold">
                      <div className="rounded-2xl bg-slate-50 p-4 border">
                        <p className="text-slate-400">Campus Phone</p>
                        <p className="text-sm font-bold text-slate-900 mt-1">{selectedUser.phone || 'Not available'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 border">
                        <p className="text-slate-400">Verification</p>
                        <p className={`text-sm font-bold mt-1 ${selectedUser.is_verified ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {selectedUser.is_verified ? 'Verified' : 'Pending'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 border">
                        <p className="text-slate-400">Wallet Balance</p>
                        <p className="text-sm font-bold text-slate-900 mt-1">{Number(selectedUser.wallet_balance ?? 0).toLocaleString()} ETB</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 border">
                        <p className="text-slate-400">Active Listings</p>
                        <p className="text-sm font-bold text-slate-900 mt-1">{selectedUser.active_listings ?? 0}</p>
                      </div>
                    </div>

                    <div>
                      <h5 className="text-sm font-bold text-slate-900 mb-3 uppercase tracking-wider text-xs text-slate-400">Activity Logs</h5>
                      <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                        {(selectedUser.activity ?? []).length > 0 ? (
                          (selectedUser.activity ?? []).map((act, i) => (
                            <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border text-xs font-semibold">
                              <span className="text-slate-800">{act.action}</span>
                              <span className="text-slate-400">{act.time}</span>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl bg-slate-50 p-3 border text-xs font-semibold text-slate-500">No recent activity recorded.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedUser(null)}
                    className="w-full mt-6 rounded-full bg-slate-900 py-3 font-bold text-white hover:bg-slate-800 transition shadow-md cursor-pointer"
                  >
                    Close Log View
                  </button>
                </div>
              </div>
            )}

            {editingUser && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1002] flex items-center justify-center p-4">
                <form onSubmit={handleUpdateUser} className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-8 shadow-2xl border border-slate-100 animate-fade-in">
                  <div className="flex items-center justify-between border-b pb-4 mb-6">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-600">User Management</p>
                      <h4 className="mt-1 text-xl font-bold text-slate-900">Edit Student Profile</h4>
                      <p className="mt-1 text-xs text-slate-500">{editingUser.student_id}</p>
                    </div>
                    <button type="button" onClick={() => setEditingUser(null)} className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold" aria-label="Close edit user modal">✕</button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Name
                      <input required value={editingUser.name || ''} onChange={(event) => setEditingUser({ ...editingUser, name: event.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal normal-case text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none" />
                    </label>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Email
                      <input required type="email" value={editingUser.email || ''} onChange={(event) => setEditingUser({ ...editingUser, email: event.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal normal-case text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none" />
                    </label>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Phone
                      <input value={editingUser.phone || ''} onChange={(event) => setEditingUser({ ...editingUser, phone: event.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal normal-case text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none" />
                    </label>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      College
                      <select required value={editingUser.college || ''} onChange={(event) => { const college = event.target.value; setEditingUser({ ...editingUser, college, department: '' }); fetchDepartmentsData(college); }} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal normal-case text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none">
                        <option value="">Select college</option>
                        {dbCollegesList.map((college) => <option key={college} value={college}>{college}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Department
                      <select required value={editingUser.department || ''} onChange={(event) => setEditingUser({ ...editingUser, department: event.target.value })} disabled={!editingUser.college || !dbDepartmentsList.length} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal normal-case text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-60">
                        <option value="">Select department</option>
                        {dbDepartmentsList.map((department) => <option key={department} value={department}>{department}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Enforcement Status
                      <select value={editingUser.status || 'Active'} onChange={(event) => setEditingUser({ ...editingUser, status: event.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal normal-case text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none">
                        <option value="Active">Active</option>
                        <option value="Suspended">Suspended</option>
                        <option value="Deactivated">Deactivated</option>
                      </select>
                    </label>
                  </div>

                  <label className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(editingUser.is_verified)} onChange={(event) => setEditingUser({ ...editingUser, is_verified: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                    Student identity is verified
                  </label>

                  <div className="mt-6 flex gap-3">
                    <button type="button" onClick={() => setEditingUser(null)} className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition">Cancel</button>
                    <button type="submit" className="btn-primary flex-1 rounded-full px-4 py-3 text-sm font-bold transition">Save Changes</button>
                  </div>
                </form>
              </div>
            )}

            {showEnforcementModal && enforcementTarget && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1001] flex items-center justify-center p-4">
                <div className="bg-white rounded-[24px] p-6 max-w-md w-full shadow-2xl border border-slate-100">
                  <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Account Restriction</p>
                      <h4 className="text-lg font-black text-slate-900 mt-1">{enforcementTarget.name}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowEnforcementModal(false);
                        setEnforcementTarget(null);
                        setEnforcementReason('Scam attempts');
                      }}
                      className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <label className="block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Reason</label>
                  <select
                    value={enforcementReason}
                    onChange={(e) => setEnforcementReason(e.target.value)}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-amber-500 focus:bg-white focus:outline-none transition appearance-none"
                  >
                    <option value="Scam attempts">Scam attempts</option>
                    <option value="Inappropriate listings">Inappropriate listings</option>
                    <option value="Policy violation">Policy violation</option>
                    <option value="Fraud investigation">Fraud investigation</option>
                    <option value="Other">Other</option>
                  </select>

                  {enforcementReason === 'Other' && (
                    <textarea
                      value={customEnforcementReason}
                      onChange={(e) => setCustomEnforcementReason(e.target.value)}
                      placeholder="Describe the restriction reason..."
                      className="mt-3 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-amber-500 focus:bg-white focus:outline-none transition resize-none"
                    />
                  )}

                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEnforcementModal(false);
                        setEnforcementTarget(null);
                        setEnforcementReason('Scam attempts');
                        setCustomEnforcementReason('');
                      }}
                      className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const finalReason = enforcementReason === 'Other' ? (customEnforcementReason.trim() || 'Other') : enforcementReason;
                        applyAccountStatusChange(enforcementTarget.id, enforcementTarget.status || 'Suspended', finalReason);
                      }}
                      className="flex-1 rounded-full bg-amber-500 px-4 py-3 text-sm font-bold text-white hover:bg-amber-600 transition shadow-sm"
                    >
                      Confirm Restriction
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showAddStudentModal && (
              <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-slate-100 bg-white p-6 shadow-2xl">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600">User Management</p>
                      <h3 className="mt-1 text-2xl font-black text-slate-950">Add Student</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddStudentModal(false)}
                      className="rounded-full bg-slate-100 px-3 py-2 font-bold text-slate-500 transition hover:bg-slate-200"
                      aria-label="Close add student modal"
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleAddStudentSubmit} className="mt-5 space-y-4">
                    {addStudentError && (
                      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{addStudentError}</p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {[
                        ['name', 'Full Name', 'text'],
                        ['student_id', 'Student ID', 'text'],
                        ['email', 'Email', 'email'],
                        ['phone', 'Phone', 'tel'],
                        ['password', 'Password', 'password'],
                      ].map(([field, label, type]) => (
                        <label key={field} className="block text-sm font-semibold text-slate-700">
                          {label}
                          <input
                            type={type}
                            required={field !== 'phone'}
                            value={addStudentForm[field]}
                            onChange={(event) => setAddStudentForm((previous) => ({ ...previous, [field]: event.target.value }))}
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                          />
                        </label>
                      ))}
                      <label className="block text-sm font-semibold text-slate-700">
                        College <span className="text-rose-500">*</span>
                        <select
                          required
                          value={addStudentForm.college}
                          onChange={(event) => setAddStudentForm((previous) => ({ ...previous, college: event.target.value, department: '' }))}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white"
                        >
                          <option value="">Select college</option>
                          {Object.keys(UNIVERSITY_STRUCTURE || {}).map((college) => <option key={college} value={college}>{college}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        Department <span className="text-rose-500">*</span>
                        <select
                          required
                          value={addStudentForm.department}
                          onChange={(event) => setAddStudentForm((previous) => ({ ...previous, department: event.target.value }))}
                          disabled={!addStudentForm.college}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">Select department</option>
                          {((UNIVERSITY_STRUCTURE || {})[addStudentForm.college] || []).map((department) => <option key={department} value={department}>{department}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                      <button type="button" onClick={() => setShowAddStudentModal(false)} className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                      <button type="submit" disabled={addStudentLoading} className="btn-primary rounded-full px-5 py-3 text-sm font-bold transition">
                        {addStudentLoading ? 'Creating...' : 'Create Student'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

          </div>
        );
      }
      case 'student-verification': {
        const pendingVerifications = verifications.filter(v => v.status === 'Pending');
        const filtersActive = Boolean(verificationSearchTerm.trim() || verificationFilterCollege !== 'All' || verificationFilterDept !== 'All');

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black text-slate-950">Student Verification</h2>
              <p className="mt-1 text-slate-500 text-sm font-semibold">Review and verify student identities, academic IDs, and campus emails.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[24px] bg-amber-50/50 border border-amber-100 p-5">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Pending Requests</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{verificationMetrics.pending} Students</p>
              </div>
              <div className="rounded-[24px] bg-emerald-50/50 border border-emerald-100 p-5">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Verified Accounts</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{verificationMetrics.verified} Students</p>
              </div>
              <div className="rounded-[24px] bg-slate-100/50 border border-slate-200/60 p-5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rejected Requests</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{verificationMetrics.rejected} Students</p>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Search student</label>
                  <input
                    type="text"
                    value={verificationSearchTerm}
                    onChange={(e) => setVerificationSearchTerm(e.target.value)}
                    placeholder="Search student name or ID..."
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none transition"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">College</label>
                  <select
                    value={verificationFilterCollege}
                    onChange={(e) => setVerificationFilterCollege(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none"
                  >
                    <option value="All">All Colleges</option>
                    {verificationColleges.map((college) => <option key={college} value={college}>{college}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Department</label>
                  <select
                    value={verificationFilterDept}
                    onChange={(e) => setVerificationFilterDept(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none"
                  >
                    <option value="All">All Departments</option>
                    {verificationDepartments.map((dept) => (
                      <option key={dept} value={dept}>{dept === 'All' ? 'All Departments' : dept}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end text-sm font-semibold text-slate-500">Results update automatically as filters change.</div>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-bold text-slate-950">Pending Identity Verifications</h3>
                <button
                  type="button"
                  onClick={handleBulkApprove}
                  disabled={!selectedVerificationIds.length}
                  className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Approve Selected ({selectedVerificationIds.length})
                </button>
                <button
                  type="button"
                  onClick={handleBulkReject}
                  disabled={!selectedVerificationIds.length}
                  className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Reject Selected ({selectedVerificationIds.length})
                </button>
              </div>

              {pendingVerifications.length === 0 ? (
                <div className="text-center py-10 text-slate-400 font-semibold">
                  <span className="text-4xl">🎓</span>
                  <p className="mt-3">{filtersActive ? 'No pending verification requests match the current filters.' : 'All caught up! No student verifications are pending at this moment.'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-700">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-3"><input type="checkbox" checked={pendingVerifications.length > 0 && pendingVerifications.every((request) => selectedVerificationIds.includes(request.id))} onChange={(event) => setSelectedVerificationIds(event.target.checked ? pendingVerifications.map((request) => request.id) : [])} aria-label="Select all pending verifications" /></th>
                        <th className="px-3 py-3">Student</th>
                        <th className="px-3 py-3">College</th>
                        <th className="px-3 py-3">Department</th>
                        <th className="px-3 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingVerifications.map((req) => (
                        <tr key={req.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-4"><input type="checkbox" checked={selectedVerificationIds.includes(req.id)} onChange={(event) => setSelectedVerificationIds((ids) => event.target.checked ? [...ids, req.id] : ids.filter((id) => id !== req.id))} aria-label={`Select ${req.name}`} /></td>
                          <td className="px-3 py-4"><p className="font-bold text-slate-900">{req.name}</p><p className="text-xs text-slate-500">{req.student_id} • {req.email}</p></td>
                          <td className="px-3 py-4">{req.college || 'Not provided'}</td>
                          <td className="px-3 py-4">{req.department || 'General Studies'}</td>
                          <td className="px-3 py-4"><div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => { setSelectedVerificationRequest(req); setSelectedIDPhoto(req.uploaded_id_card); setVerificationZoom(1); setVerificationRotation(0); }} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">View ID Card</button>
                            <button type="button" onClick={() => handleVerifyAction(req.id, 'Verified')} className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600">Verify</button>
                            <button type="button" onClick={() => { setSelectedVerificationRequest(req); setSelectedIDPhoto(req.uploaded_id_card); setVerificationZoom(1); setVerificationRotation(0); }} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100">Reject</button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {selectedVerificationRequest && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
                <div className="relative grid max-h-[90vh] w-full max-w-5xl grid-cols-1 overflow-y-auto rounded-[28px] bg-white shadow-2xl border border-slate-100 animate-fade-in lg:grid-cols-[1fr_1.3fr]">
                  <div className="col-span-full flex items-center justify-between border-b p-6 pb-3">
                    <h4 className="text-lg font-bold text-slate-900">Student Verification Review</h4>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIDPhoto(null);
                        setSelectedVerificationRequest(null);
                        setVerificationZoom(1);
                        setVerificationRotation(0);
                      }}
                      className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="border-b border-slate-200 p-6 lg:border-b-0 lg:border-r">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Student Profile</p>
                    <dl className="mt-5 space-y-4">
                      {[
                        ['Full Name', selectedVerificationRequest.name],
                        ['Student ID', selectedVerificationRequest.student_id],
                        ['Email', selectedVerificationRequest.email],
                        ['Phone', selectedVerificationRequest.phone || 'Not provided'],
                        ['College', selectedVerificationRequest.college || 'Not provided'],
                        ['Department', selectedVerificationRequest.department || 'Not provided'],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</dt>
                          <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="p-6">
                    {selectedIDPhoto && !selectedIDPhoto.includes('unsplash.com') ? (
                      <>
                        <div className="mb-4 flex items-center justify-between">
                          <h5 className="text-sm font-bold text-slate-900">Uploaded ID Card</h5>
                          <div className="flex items-center justify-center gap-2">
                            <button type="button" onClick={() => setVerificationZoom(prev => Math.max(1, Number((prev - 0.2).toFixed(1))))} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">−</button>
                            <button type="button" onClick={() => setVerificationZoom(prev => Number((prev + 0.2).toFixed(1)))} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">+</button>
                            <button type="button" onClick={() => setVerificationRotation(prev => (prev + 90) % 360)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Rotate</button>
                          </div>
                        </div>
                        <div className="overflow-hidden rounded-2xl border bg-slate-50 p-2 flex items-center justify-center h-[26rem] shadow-xs">
                          <img
                            src={resolveImageUrl(selectedIDPhoto)}
                            alt="Student ID Card"
                            onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                            className="max-h-full max-w-full rounded-xl object-contain border border-slate-200 transition-transform duration-200"
                            style={{ transform: `scale(${verificationZoom}) rotate(${verificationRotation}deg)` }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[26rem] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-3xl text-slate-500">ID</span>
                        <p className="mt-5 text-base font-bold text-slate-800">No verification document uploaded yet</p>
                        <p className="mt-2 text-sm text-slate-500">Student ID: {selectedVerificationRequest.student_id}</p>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => handleVerifyAction(selectedVerificationRequest.id, 'Verified')}
                        className="rounded-full bg-emerald-500 px-5 py-3 font-bold text-white hover:bg-emerald-600 transition shadow-md"
                      >
                        Verify Student ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVerifyAction(selectedVerificationRequest.id, 'Rejected', '')}
                        className="rounded-full bg-rose-500 px-5 py-3 font-bold text-white hover:bg-rose-600 transition shadow-md"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIDPhoto(null);
                          setSelectedVerificationRequest(null);
                          setVerificationZoom(1);
                          setVerificationRotation(0);
                        }}
                        className="ml-auto rounded-full border border-slate-200 bg-white px-5 py-3 font-bold text-slate-700 hover:bg-slate-50 transition"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showRejectReasonModal && selectedVerificationRequest && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1001] flex items-center justify-center p-4">
                <div className="bg-white rounded-[28px] p-6 max-w-md w-full shadow-2xl border border-slate-100 animate-fade-in">
                  <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Reject Submission</p>
                      <h4 className="text-xl font-black text-slate-900 mt-1">{selectedVerificationRequest.name}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowRejectReasonModal(false);
                        setSelectedVerificationRequest(null);
                        setVerificationRejectReason('Blurry Image');
                      }}
                      className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <label className="block text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Select or type a reason</label>
                  <select
                    value={verificationRejectReason}
                    onChange={(e) => setVerificationRejectReason(e.target.value)}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none transition appearance-none"
                  >
                    <option value="Blurry Image">Blurry Image</option>
                    <option value="Expired ID">Expired ID</option>
                    <option value="Name Mismatch">Name Mismatch</option>
                    <option value="Incorrect Department">Incorrect Department</option>
                    <option value="Incomplete Documentation">Incomplete Documentation</option>
                    <option value="Other">Other</option>
                  </select>

                  {verificationRejectReason === 'Other' && (
                    <textarea
                      value={verificationRejectReason === 'Other' ? '' : verificationRejectReason}
                      onChange={(e) => setVerificationRejectReason(e.target.value)}
                      placeholder="Explain the rejection reason..."
                      className="mt-3 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none transition resize-none"
                    />
                  )}

                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRejectReasonModal(false);
                        setSelectedVerificationRequest(null);
                        setVerificationRejectReason('Blurry Image');
                      }}
                      className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVerifyAction(selectedVerificationRequest.id, 'Rejected', verificationRejectReason)}
                      className="flex-1 rounded-full bg-rose-500 px-4 py-3 text-sm font-bold text-white hover:bg-rose-600 transition shadow-sm"
                    >
                      Submit Rejection
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        );
      }
      case 'product-management': {
        const productStatusCounts = adminProductStatusCounts || getAdminProductStatusCounts(productsList);
        const filteredProds = productsList.filter(product => {
          const matchesSearch =
            product.title?.toLowerCase().includes(prodSearch.toLowerCase()) ||
            product.seller?.toLowerCase().includes(prodSearch.toLowerCase()) ||
            product.seller_id?.toLowerCase().includes(prodSearch.toLowerCase());
          const matchesStatus = matchesAdminProductStatusFilter(product, prodStatusFilter);
          const matchesCategory = productCategoryFilter === 'All' || product.category === productCategoryFilter;
          const matchesSubcategory = productSubcategoryFilter === 'All' || product.subcategory === productSubcategoryFilter;
          return matchesSearch && matchesStatus && matchesCategory && matchesSubcategory;
        });
        const totalProductPages = Math.max(1, Math.ceil(filteredProds.length / PRODUCTS_PER_PAGE));
        const displayedProducts = filteredProds.slice((productPage - 1) * PRODUCTS_PER_PAGE, productPage * PRODUCTS_PER_PAGE);
        const displayedPendingProducts = displayedProducts.filter((product) => product.status === 'Pending');
        const handleExportProductsCSV = () => exportCSVFile('products.csv', ['ID', 'Product Title', 'Seller ID', 'Category', 'Subcategory', 'Price', 'Status'], filteredProds.map((product) => [
          String(product.id || ''), String(product.title || ''), String(product.seller_id || product.seller || ''), String(product.category || ''),
          String(product.subcategory || ''), String(product.price || ''), String(product.status || ''),
        ]));
        const handleExportProductsPDF = () => exportPDFFile('products.pdf', 'Product Management Report', ['ID', 'Product Title', 'Seller ID', 'Category', 'Subcategory', 'Price', 'Status'], filteredProds.map((product) => [
          String(product.id || ''), String(product.title || ''), String(product.seller_id || product.seller || ''), String(product.category || ''),
          String(product.subcategory || ''), String(product.price || ''), String(product.status || ''),
        ]));

        return (
          <div className="admin-product-management min-w-0 w-full space-y-6 animate-fade-in text-slate-900">
            <div className="flex flex-col gap-4 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-2xl font-black text-slate-950">Product Moderation</h2>
                <p className="mt-1 text-slate-500 text-sm font-semibold">Curate the campus catalog, review listings, and enforce community standards.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleExportProductsCSV} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer">Export CSV</button>
                <button type="button" onClick={handleExportProductsPDF} className="rounded-full bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer">Export PDF</button>
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-5">
              {[
                { label: 'Total Products', value: productStatusCounts.total, tone: 'bg-sky-50 border-sky-200 text-sky-700' },
                { label: 'Available', value: productStatusCounts.available, tone: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                { label: 'Sold', value: productStatusCounts.sold, tone: 'bg-slate-100 border-slate-300 text-slate-700' },
                { label: 'Pending Review', value: productStatusCounts.pending, tone: 'bg-amber-50 border-amber-200 text-amber-700' },
                { label: 'Flagged', value: productStatusCounts.flagged, tone: 'bg-rose-50 border-rose-200 text-rose-700' },
              ].map((metric) => (
                <div key={metric.label} className={`rounded-[24px] border p-5 shadow-sm ${metric.tone}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em]">{metric.label}</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm min-[420px]:grid-cols-2 md:grid-cols-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Search Products</label>
                <input
                  type="text"
                  placeholder="Search by title or seller..."
                  value={prodSearch}
                  onChange={(e) => setProdSearch(e.target.value)}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Filter by Category</label>
                <select
                  value={productCategoryFilter}
                  onChange={(e) => setProductCategoryFilter(e.target.value)}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none"
                >
                  <option value="All">All Categories</option>
                  {dbCategories.map((category) => (
                    <option key={category.id ?? category.name} value={category.name}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Filter by Subcategory</label>
                <select
                  value={productSubcategoryFilter}
                  onChange={(e) => setProductSubcategoryFilter(e.target.value)}
                  disabled={productCategoryFilter === 'All'}
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="All">All Subcategories</option>
                  {dbSubcategories.map((subcategory) => (
                    <option key={subcategory.id ?? subcategory.name} value={subcategory.name}>
                      {subcategory.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="admin-product-review-queue min-w-0 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm overflow-hidden">
              <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter products by status">
                {[
                  { key: 'all', label: 'All Products', count: productStatusCounts.total },
                  { key: 'available', label: 'Available / Unsold', count: productStatusCounts.available },
                  { key: 'sold', label: 'Sold', count: productStatusCounts.sold },
                  { key: 'pending', label: 'Pending Review', count: productStatusCounts.pending },
                  { key: 'flagged', label: 'Flagged', count: productStatusCounts.flagged },
                ].map((filter) => {
                  const isActive = prodStatusFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setProdStatusFilter(filter.key)}
                      className={`rounded-full border px-4 py-2 text-xs font-bold transition ${isActive ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
                    >
                      {filter.label} <span className={isActive ? 'text-blue-100' : 'text-slate-400'}>({filter.count})</span>
                    </button>
                  );
                })}
              </div>
              <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">
                    {prodStatusFilter === 'pending' ? 'Product Review Queue' : 'UniXchange Product Catalog'}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {prodStatusFilter === 'pending'
                      ? 'Select pending products for a batch moderation action.'
                      : 'Browse UniXchange listings and manage catalog products.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleBulkApproveProducts} disabled={!selectedProductIds.length} className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300">Approve Selected</button>
                  <button type="button" onClick={handleOpenBulkRejectModal} disabled={!selectedProductIds.length} className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300">Reject Selected</button>
                </div>
              </div>
              <div className="admin-data-table-wrapper max-w-full overflow-x-auto overscroll-x-contain">
                <table className="admin-data-table admin-product-review-table w-full min-w-[900px] text-left text-sm text-slate-700">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="min-w-[52px] px-4 py-3 font-bold uppercase tracking-wider text-xs"><input type="checkbox" checked={displayedProducts.length > 0 && displayedProducts.every((product) => selectedProductIds.includes(product.id))} onChange={(event) => setSelectedProductIds(event.target.checked ? displayedProducts.map((product) => product.id) : [])} aria-label="Select visible products" /></th>
                      <th className="min-w-[220px] px-4 py-3 font-bold uppercase tracking-wider text-xs">Product</th>
                      <th className="min-w-[140px] px-4 py-3 font-bold uppercase tracking-wider text-xs">Seller ID</th>
                      <th className="min-w-[110px] px-4 py-3 font-bold uppercase tracking-wider text-xs">Condition</th>
                      <th className="min-w-[110px] px-4 py-3 font-bold uppercase tracking-wider text-xs text-center">Status</th>
                      <th className="min-w-[120px] px-4 py-3 font-bold uppercase tracking-wider text-xs text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedProducts.map((product) => (
                      <tr key={product.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                        <td className="px-4 py-4"><input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={(event) => setSelectedProductIds((ids) => event.target.checked ? [...ids, product.id] : ids.filter((id) => id !== product.id))} aria-label={`Select ${product.title}`} /></td>
                        <td className="admin-table-wrap-cell min-w-[220px] px-4 py-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={getProductImageUrl(product.image)}
                              alt={product.title}
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = PRODUCT_PLACEHOLDER;
                              }}
                              className="h-14 w-14 rounded-xl object-cover border border-slate-200"
                            />
                            <div className="min-w-0">
                              <div className="product-review-title font-bold text-slate-900">{product.title}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{product.category}</div>
                              <div className="text-xs text-emerald-600 mt-1 font-bold">
                                {(() => {
                                  const numericPrice = Number.parseFloat(String(product.price ?? '').replace(/[^\d.-]/g, ''));
                                  return Number.isFinite(numericPrice)
                                    ? `${new Intl.NumberFormat('en-US').format(numericPrice)} ETB`
                                    : `${product.price || '0'} ETB`;
                                })()}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="min-w-[140px] px-4 py-4 font-semibold text-slate-700">
                          <div>{product.seller_id || product.seller || 'Unknown Student'}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{product.seller_verified ? 'Verified Seller' : 'Unverified'}</div>
                        </td>
                        <td className="min-w-[110px] px-4 py-4">
                          <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                            {product.condition || 'New'}
                          </span>
                        </td>
                        <td className="min-w-[110px] px-4 py-4 text-center">
                          <div className="flex flex-col items-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-bold border ${matchesAdminProductStatusFilter(product, 'available') ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : String(product.status || '').trim().toLowerCase() === 'sold' ? 'bg-slate-100 text-slate-700 border-slate-200' : String(product.status || '').trim().toLowerCase() === 'flagged' ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                              {product.status || 'Pending'}
                            </span>
                            {product.status === 'Flagged' && (product.moderation_reason || product.rejection_reason) && (
                              <span className="mt-1 max-w-[180px] text-xs italic text-gray-500">
                                {product.moderation_reason || product.rejection_reason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="min-w-[120px] px-4 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedProductDetails(product)}
                              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                            >
                              View Details
                            </button>
                            {['pending', 'approved', 'flagged'].includes(String(product.status || '').trim().toLowerCase()) && (
                              <button
                                type="button"
                                onClick={() => handleOpenRejectModal(product)}
                                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                              >
                                Reject/Flag
                              </button>
                            )}
                            {String(product.status || '').trim().toLowerCase() === 'sold' && (
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
                                Item Sold Out
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(product)}
                              className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                            >
                              Delete
                            </button>
                            {['pending', 'flagged'].includes(String(product.status || '').trim().toLowerCase()) && (
                              <button
                                type="button"
                                onClick={() => handleProductApproval(product.id)}
                                className="rounded-full bg-emerald-500 hover:bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition"
                              >
                                Approve
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setProductPage((page) => Math.max(1, page - 1))} disabled={productPage === 1} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="text-sm font-semibold text-slate-500">Page {productPage} of {totalProductPages}</span>
                <button type="button" onClick={() => setProductPage((page) => Math.min(totalProductPages, page + 1))} disabled={productPage === totalProductPages} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
            </div>

            {selectedProductDetails && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4">
                <div className="relative bg-white rounded-[28px] p-6 max-w-2xl w-full shadow-2xl border border-slate-100 animate-fade-in">
                  <div className="flex items-center justify-between border-b pb-3 mb-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold">Product Preview</p>
                      <h4 className="text-xl font-black text-slate-900 mt-1">{selectedProductDetails.title}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedProductDetails(null)}
                      className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
                    <div className="overflow-hidden rounded-2xl border bg-slate-50 p-2">
                      <img
                        src={getProductImageUrl(selectedProductDetails.image)}
                        alt={selectedProductDetails.title}
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = PRODUCT_PLACEHOLDER;
                        }}
                        className="h-72 w-full rounded-xl object-cover"
                      />
                    </div>

                    <div className="space-y-4 text-sm">
                      <div className="rounded-2xl bg-slate-50 border p-4">
                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Price</p>
                        <p className="mt-1 text-xl font-black text-emerald-600">{selectedProductDetails.price}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 border p-4">
                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Condition</p>
                        <p className="mt-1 text-base font-bold text-slate-900">{selectedProductDetails.condition || 'New'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 border p-4">
                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Seller Verification</p>
                        <p className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${selectedProductDetails.seller_verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {selectedProductDetails.seller_verified ? 'Verified' : 'Pending Review'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Complete Description</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{selectedProductDetails.description || 'No description provided.'}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedProductDetails(null)}
                    className="w-full mt-6 rounded-full bg-slate-900 py-3 font-bold text-white hover:bg-slate-800 transition shadow-md cursor-pointer"
                  >
                    Close Preview
                  </button>
                </div>
              </div>
            )}

            {showRejectModal && pendingRejectProduct && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[1001] flex items-center justify-center p-4">
                <div className="bg-white rounded-[24px] p-6 max-w-md w-full shadow-2xl border border-slate-100">
                  <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold">Flag Listing</p>
                      <h4 className="text-lg font-black text-slate-900 mt-1">{pendingRejectProduct.title}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowRejectModal(false);
                        setPendingRejectProduct(null);
                      }}
                      className="rounded-full bg-slate-100 p-2 hover:bg-slate-200 transition text-slate-500 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Choose a reason</label>
                  <select
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none transition appearance-none"
                  >
                    <option value="Inappropriate Image">Inappropriate Image</option>
                    <option value="Incorrect Pricing">Incorrect Pricing</option>
                    <option value="Misleading Description">Misleading Description</option>
                    <option value="Duplicate Listing">Duplicate Listing</option>
                    <option value="Fraudulent / Scam">Fraudulent / Scam</option>
                    <option value="Policy Violation">Policy Violation</option>
                  </select>

                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRejectModal(false);
                        setPendingRejectProduct(null);
                        setRejectReason('Inappropriate Image');
                      }}
                      className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitProductFlag}
                      className="flex-1 rounded-full bg-rose-500 px-4 py-3 text-sm font-bold text-white hover:bg-rose-600 transition cursor-pointer"
                    >
                      Submit Flag
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'categories':
        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black text-slate-950">Category Management</h2>
              <p className="mt-1 text-slate-500 text-sm font-semibold">Organize, modify, and disable UniXchange catalog categories.</p>
            </div>

            {editingCategory && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                <form onSubmit={handleUpdateCategory} role="dialog" aria-modal="true" aria-labelledby="edit-category-title" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
                  <h3 id="edit-category-title" className="text-xl font-black text-slate-950">Edit Main Category</h3>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Category Name
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={categoryEditForm.name}
                      onChange={(event) => setCategoryEditForm((form) => ({ ...form, name: event.target.value }))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Icon (Emoji)
                    <input
                      type="text"
                      maxLength={3}
                      value={categoryEditForm.icon}
                      onChange={(event) => setCategoryEditForm((form) => ({ ...form, icon: event.target.value }))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                    />
                  </label>
                  <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={categoryEditForm.is_active}
                      onChange={(event) => setCategoryEditForm((form) => ({ ...form, is_active: event.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Active
                  </label>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={() => setEditingCategory(null)} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                    <button type="submit" className="btn-primary rounded-full px-5 py-3 text-sm font-bold">Save Changes</button>
                  </div>
                </form>
              </div>
            )}

            {editingSubcategory && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
                <form onSubmit={handleUpdateSubcategory} role="dialog" aria-modal="true" aria-labelledby="edit-subcategory-title" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
                  <h3 id="edit-subcategory-title" className="text-xl font-black text-slate-950">Edit Subcategory</h3>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Subcategory Name
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={subcategoryEditForm.name}
                      onChange={(event) => setSubcategoryEditForm((form) => ({ ...form, name: event.target.value }))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Icon (Emoji)
                    <input
                      type="text"
                      maxLength={3}
                      value={subcategoryEditForm.icon}
                      onChange={(event) => setSubcategoryEditForm((form) => ({ ...form, icon: event.target.value }))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Parent Category
                    <select
                      required
                      value={subcategoryEditForm.parent_category_id}
                      onChange={(event) => setSubcategoryEditForm((form) => ({ ...form, parent_category_id: event.target.value }))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                    >
                      {categoriesList.map((category) => (
                        <option key={category.id} value={category.id}>{category.icon} {category.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={() => setEditingSubcategory(null)} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                    <button type="submit" className="btn-primary rounded-full px-5 py-3 text-sm font-bold">Save Changes</button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_400px] items-start">

              {/* Left Column: Active Categories with Nested Subcategories */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-950 border-b pb-3 mb-4">UniXchange Directories</h3>
                <div className="space-y-4">
                  {categoriesList.map((cat) => (
                    <div key={cat.id} className="rounded-2xl border border-slate-200/50 bg-slate-50/50 p-4 space-y-3">
                      {/* Main Category Header */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCategoryExpand(cat.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') toggleCategoryExpand(cat.id);
                        }}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{cat.icon || '📁'}</span>
                          <div>
                            <div className="flex items-center gap-2 font-bold text-slate-900">
                              <span>{cat.name}</span>
                              <span className={`text-xs transition-transform ${expandedCategoryId === cat.id ? 'rotate-180' : ''}`}>
                                ▼
                              </span>
                            </div>
                            <div className="text-xs text-slate-400">{cat.ads}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold border ${cat.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                            {cat.status}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCategoryEditor(cat);
                            }}
                            className="text-xs font-bold text-blue-600 hover:text-blue-800 transition"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCategory(cat.id);
                            }}
                            className="text-xs font-bold text-rose-600 hover:text-rose-800 transition"
                          >
                            Delete 🗑️
                          </button>
                        </div>
                      </div>

                      {/* Nested Subcategories */}
                      {expandedCategoryId === cat.id && (
                        <>
                          {cat.subcategories && cat.subcategories.length > 0 && (
                            <div className="ml-8 space-y-2 border-l-2 border-slate-200 pl-4">
                              {cat.subcategories.map((sub) => (
                                <div key={sub.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white border border-slate-100">
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{sub.icon || '📂'}</span>
                                    <div>
                                      <div className="text-sm font-semibold text-slate-800">{sub.name}</div>
                                      <div className="text-xs text-slate-400">{sub.ads}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => openSubcategoryEditor(cat, sub)}
                                      className="text-xs font-bold text-blue-600 hover:text-blue-800 transition"
                                    >
                                      ✏️ Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSubcategory(cat.id, sub.id)}
                                      className="text-xs font-bold text-rose-500 hover:text-rose-700 transition"
                                    >
                                      Remove ×
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {(!cat.subcategories || cat.subcategories.length === 0) && (
                            <div className="ml-8 text-xs text-slate-400 italic py-2">No subcategories yet</div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {categoriesList.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
                      No categories yet. Create one using the form on the right.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Forms for Creating Categories & Subcategories */}
              <div className="space-y-4">

                {/* Create Main Category Form */}
                <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-950 border-b pb-3 mb-4">Create Main Category</h3>
                  <form onSubmit={handleAddCategory} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Category Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Laboratory Equipment"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Icon (Emoji)</label>
                      <input
                        type="text"
                        placeholder="e.g. 📁"
                        value={newCatIcon}
                        onChange={(e) => setNewCatIcon(e.target.value)}
                        maxLength={3}
                        className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none transition"
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn-primary w-full rounded-full py-3 font-bold transition shadow-md cursor-pointer"
                    >
                      ✓ Add Category
                    </button>
                  </form>
                </div>

                {/* Create Subcategory Form */}
                <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-950 border-b pb-3 mb-4">Create Subcategory</h3>
                  <form onSubmit={handleAddSubcategory} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Parent Category</label>
                      <select
                        required
                        value={newSubParentId}
                        onChange={(e) => setNewSubParentId(e.target.value)}
                        className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none transition cursor-pointer"
                      >
                        <option value="">Select a category...</option>
                        {categoriesList.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.icon} {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Subcategory Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Microscopes"
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none transition"
                      />
                    </div>
                    <button
                      type="submit"
                      className="btn-primary w-full rounded-full py-3 font-bold transition shadow-md cursor-pointer"
                    >
                      ✓ Add Subcategory
                    </button>
                  </form>
                </div>

              </div>

            </div>

          </div>
        );
      case 'orders': {
        const filteredOrders = ordersList.filter((order) => {
          const query = orderSearch.toLowerCase();
          const matchesSearch = !query ||
            order.id.toLowerCase().includes(query) ||
            (order.buyer_id || order.buyer || '').toLowerCase().includes(query) ||
            (order.seller_id || order.seller || '').toLowerCase().includes(query) ||
            (order.product_title || order.item || '').toLowerCase().includes(query);

          const matchesStatus = orderFilterStatus === 'All' || getAdminOrderStatusLabel(order.order_status) === orderFilterStatus;
          const matchesRefund = orderFilterRefund === 'All' || (
            orderFilterRefund === 'Expired / Refund failed' &&
            (['Expired', 'Refunded'].includes(order.order_status) || order.refund_status === 'failed')
          );
          const matchesPayment = orderFilterPayment === 'All' || order.payment_status === orderFilterPayment;

          return matchesSearch && matchesStatus && matchesRefund && matchesPayment;
        });
        const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
        const displayedOrders = filteredOrders.slice((orderPage - 1) * ORDERS_PER_PAGE, orderPage * ORDERS_PER_PAGE);
        const handleExportOrdersCSV = () => exportCSVFile('orders.csv', ['Order ID', 'Buyer ID', 'Seller ID', 'Product Title', 'Total Amount', 'Order Status', 'Payment Status', 'Date'], filteredOrders.map((order) => [
          String(order.id || ''), String(order.buyer_id || order.buyer || ''), String(order.seller_id || order.seller || ''),
          String(order.product_title || order.item || ''), String(order.total_amount || order.price || ''), String(order.order_status || ''),
          String(order.payment_status || order.pay_status || ''), String(order.date || ''),
        ]));
        const handleExportOrdersPDF = () => exportPDFFile('orders.pdf', 'Orders Report', ['Order ID', 'Buyer ID', 'Seller ID', 'Product Title', 'Total Amount', 'Order Status', 'Payment Status', 'Date'], filteredOrders.map((order) => [
          String(order.id || ''), String(order.buyer_id || order.buyer || ''), String(order.seller_id || order.seller || ''),
          String(order.product_title || order.item || ''), String(order.total_amount || order.price || ''), String(order.order_status || ''),
          String(order.payment_status || order.pay_status || ''), String(order.date || ''),
        ]));

        const getOrderStatusBadge = (status) => {
          if (status === 'Completed') return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
          if (status === 'Disputed') return 'bg-rose-100 text-rose-700 border border-rose-200';
          if (status === 'Legacy order') return 'bg-slate-100 text-slate-600 border border-slate-200';
          return 'bg-slate-100 text-slate-600 border border-slate-200';
        };

        const getPaymentStatusBadge = (status) => {
          if (status === 'Successful') return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
          if (status === 'Pending') return 'bg-amber-100 text-amber-700 border border-amber-200';
          if (status === 'Failed') return 'bg-red-100 text-red-700 border border-red-200';
          if (status === 'Refunded') return 'bg-slate-100 text-slate-700 border border-slate-200';
          return 'bg-sky-100 text-sky-700 border border-sky-200';
        };

        return (
          <div className="min-w-0 w-full space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">Order Operations Dashboard</h2>
                  <p className="mt-1 text-sm text-slate-600">Review completed wallet payments, post-payment disputes, and historical orders.</p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                  <span>💰</span>
                  <span>{calculatedOrderMetrics.totalSales}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleExportOrdersCSV} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer">Export CSV</button>
                  <button type="button" onClick={handleExportOrdersPDF} className="rounded-full bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer">Export PDF</button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-[24px] border border-slate-200 bg-slate-100/70 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Total Orders</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedOrderMetrics.totalOrders.toLocaleString()}</p>
              </div>
              <div className="rounded-[24px] border border-amber-100 bg-amber-50 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Legacy Orders</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedOrderMetrics.legacyOrders.toLocaleString()}</p>
              </div>
              <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Completed</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedOrderMetrics.completed.toLocaleString()}</p>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-lg font-black text-slate-950">
                Total Sales: <span className="text-sky-700">{calculatedOrderMetrics.totalSales}</span>
              </p>
            </div>

            {disputeResolutionMessage && (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
                {disputeResolutionMessage}
              </div>
            )}

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-3">
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search Order ID / Student ID..."
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                />

                <select
                  value={orderFilterStatus}
                  onChange={(e) => setOrderFilterStatus(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Order Status: All</option>
                  <option value="Legacy order">Legacy order</option>
                  <option value="Completed">Completed</option>
                  <option value="Disputed">Disputed</option>
                </select>

                <select
                  value={orderFilterPayment}
                  onChange={(e) => setOrderFilterPayment(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Payment Status: All</option>
                  <option value="Pending">Pending</option>
                  <option value="Successful">Successful</option>
                  <option value="Failed">Failed</option>
                  <option value="Refunded">Refunded</option>
                </select>
                <select
                  value={orderFilterRefund}
                  onChange={(e) => setOrderFilterRefund(e.target.value)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Legacy expiry / refund: All</option>
                  <option value="Expired / Refund failed">Expired / Refund failed</option>
                </select>
              </div>

              <div className="admin-data-table-wrapper mt-6 w-full max-w-full overflow-x-auto">
                <table className="admin-data-table w-full min-w-[860px] text-left text-sm text-slate-700">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="min-w-[130px] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em]">Order ID</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em]">Buyer & Seller IDs</th>
                      <th className="min-w-[180px] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em]">Product Title</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em]">Total Amount</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em]">Order Status</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em]">Payment Status</th>
                      <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedOrders.map((order) => (
                      <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                        <td className="px-4 py-4 font-mono font-black text-slate-900">{order.id}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1">
                            <button type="button" onClick={() => setSelectedOrderDetails(order)} className="text-left text-sm font-semibold text-sky-700 underline-offset-2 hover:underline">{order.buyer_id || order.buyer}</button>
                            <button type="button" onClick={() => setSelectedOrderDetails(order)} className="text-left text-xs text-slate-500 underline-offset-2 hover:underline">{order.seller_id || order.seller}</button>
                          </div>
                        </td>
                        <td className="admin-table-wrap-cell min-w-[180px] px-4 py-4">
                          <div className="admin-table-wrap-cell font-semibold text-slate-800">{order.product_title || order.item}</div>
                          <div className="mt-1 text-xs text-slate-500">{new Date(order.date).toLocaleDateString()}</div>
                        </td>
                        <td className="px-4 py-4 font-black text-slate-950">{order.price || `${Number(order.total_amount ?? 0).toLocaleString('en-ET')} ETB`}</td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${getOrderStatusBadge(order.order_status)}`}>
                            {getAdminOrderStatusLabel(order.order_status)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${getPaymentStatusBadge(order.payment_status || order.pay_status)}`}>
                            {order.payment_status || order.pay_status}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedOrderDetails(order)}
                              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setOrderPage((page) => Math.max(1, page - 1))} disabled={orderPage === 1} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="text-sm font-semibold text-slate-500">Page {orderPage} of {totalOrderPages}</span>
                <button type="button" onClick={() => setOrderPage((page) => Math.min(totalOrderPages, page + 1))} disabled={orderPage === totalOrderPages} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>

              {filteredOrders.length === 0 && (
                <div className="mt-6 text-center text-slate-500">
                  <p className="font-semibold">No orders match the selected filters.</p>
                </div>
              )}
            </div>

            {selectedOrderDetails && (
              <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
                <div className="w-full max-w-3xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-sky-600">Order Details</p>
                      <h3 className="mt-1 text-2xl font-black text-slate-950">{selectedOrderDetails.id}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedOrderDetails(null)}
                      className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-600"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Buyer</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.buyer_id || selectedOrderDetails.buyer}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Seller</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.seller_id || selectedOrderDetails.seller}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Product</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.product_title || selectedOrderDetails.item}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Price</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.price || `${Number(selectedOrderDetails.total_amount ?? 0).toLocaleString('en-ET')} ETB`}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Date</p>
                      <p className="mt-2 text-base font-black text-slate-900">{new Date(selectedOrderDetails.date).toLocaleString()}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Pickup Location</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.pickup_location || 'Main Library'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Payment Status</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.payment_status || selectedOrderDetails.pay_status}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Fulfillment Status</p>
                      <p className="mt-2 text-base font-black text-slate-900">{getAdminOrderStatusLabel(selectedOrderDetails.order_status)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Refund Status</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.refund_status || 'none'}</p>
                      {selectedOrderDetails.refund_reference && <p className="mt-1 break-all text-xs text-slate-500">{selectedOrderDetails.refund_reference}</p>}
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Legacy Expiry Reason</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedOrderDetails.expiry_reason || 'Not expired'}</p>
                      {selectedOrderDetails.expired_at && <p className="mt-1 text-xs text-slate-500">{new Date(selectedOrderDetails.expired_at).toLocaleString()}</p>}
                    </div>
                  </div>

                  {selectedOrderDetails.dispute_status && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-600">Dispute Details</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div><p className="text-xs font-bold text-slate-500">Reason</p><p className="mt-1 font-black text-slate-900">{selectedOrderDetails.dispute_reason || 'Not provided'}</p></div>
                      <div><p className="text-xs font-bold text-slate-500">Status</p><p className="mt-1 font-black text-slate-900">{selectedOrderDetails.dispute_status}</p></div>
                      <div><p className="text-xs font-bold text-slate-500">Created date</p><p className="mt-1 font-black text-slate-900">{selectedOrderDetails.dispute_created_at ? new Date(selectedOrderDetails.dispute_created_at).toLocaleString() : 'Unavailable'}</p></div>
                      <div><p className="text-xs font-bold text-slate-500">Legacy escrow status</p><p className="mt-1 font-black text-slate-900">{selectedOrderDetails.escrow_status || 'Unavailable'}</p></div>
                      <div><p className="text-xs font-bold text-slate-500">Seller payout status</p><p className="mt-1 font-black text-slate-900">{selectedOrderDetails.seller_payout_status || 'Unavailable'}</p></div>
                    </div>
                    <div className="mt-4 rounded-xl bg-white p-4"><p className="text-xs font-bold text-slate-500">Description</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedOrderDetails.dispute_description || 'No description provided.'}</p></div>
                    {selectedOrderDetails.seller_response && <div className="mt-4 rounded-xl bg-white p-4"><p className="text-xs font-bold text-slate-500">Seller response</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedOrderDetails.seller_response}</p></div>}
                  </div>}

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedOrderDetails(null)}
                      className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'payments': {
        const filteredPayments = paymentsList.filter((payment) => {
          const searchValue = paymentSearchTerm.toLowerCase();
          const searchMatch = !searchValue ||
            String(payment.transaction_id || '').toLowerCase().includes(searchValue) ||
            String(payment.buyer_id || '').toLowerCase().includes(searchValue) ||
            String(payment.seller_id || '').toLowerCase().includes(searchValue) ||
            String(payment.order_id || '').toLowerCase().includes(searchValue);

          const statusMatch = paymentStatusFilter === 'All' || payment.status === paymentStatusFilter;
          const methodMatch = paymentMethodFilter === 'All' || payment.payment_method === paymentMethodFilter;
          const paymentDate = new Date(payment.created_date || payment.date);
          const dateMatch = !paymentDateFilter || paymentDate.toDateString() === new Date(`${paymentDateFilter}T00:00:00`).toDateString();

          return searchMatch && statusMatch && methodMatch && dateMatch;
        });
        const totalPaymentPages = Math.max(1, Math.ceil(filteredPayments.length / PAYMENTS_PER_PAGE));
        const displayedPayments = filteredPayments.slice((paymentPage - 1) * PAYMENTS_PER_PAGE, paymentPage * PAYMENTS_PER_PAGE);
        const handleExportPaymentsCSV = () => exportCSVFile('payments.csv', ['Transaction ID', 'Buyer ID', 'Seller ID', 'Order ID', 'Amount', 'Payment Type', 'Payment Method', 'Status', 'Date'], filteredPayments.map((payment) => [
          String(payment.transaction_id || ''), String(payment.buyer_id || ''), String(payment.seller_id || ''), String(payment.order_id || ''),
          String(payment.amount || ''), String(payment.payment_type || ''), String(payment.payment_method || ''), String(payment.status || ''), String(payment.date || ''),
        ]));
        const handleExportPaymentsPDF = () => exportPDFFile('payments.pdf', 'Payments Report', ['Transaction ID', 'Buyer ID', 'Seller ID', 'Order ID', 'Amount', 'Payment Type', 'Payment Method', 'Status', 'Date'], filteredPayments.map((payment) => [
          String(payment.transaction_id || ''), String(payment.buyer_id || ''), String(payment.seller_id || ''), String(payment.order_id || ''),
          String(payment.amount || ''), String(payment.payment_type || ''), String(payment.payment_method || ''), String(payment.status || ''), String(payment.date || ''),
        ]));
        const renderPaymentId = (value, label) => (
          <div className="flex min-w-0 items-center gap-2">
            <span title={String(value ?? '')} className="max-w-[180px] truncate whitespace-nowrap font-mono text-xs">{value || '—'}</span>
            {value && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(String(value));
                    notifySuccess(`${label} copied.`, 'admin-payment-id-copy');
                  } catch (error) {
                    notifyError(error, 'admin-payment-id-copy');
                  }
                }}
                title={`Copy ${label}`}
                aria-label={`Copy ${label}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        );
        const formatPaymentAmount = (payment) => {
          const amount = Math.abs(Number(payment.amount) || 0);
          const isWithdrawal = /withdraw|refund|payout|debit/i.test(String(payment.payment_type || '')) || Number(payment.amount) < 0;
          const isDeposit = /deposit|load|credit/i.test(String(payment.payment_type || ''));
          return {
            text: `${isWithdrawal ? '-' : ''}${new Intl.NumberFormat(undefined).format(amount)} ETB`,
            color: isWithdrawal ? 'text-red-600' : isDeposit ? 'text-emerald-600' : 'text-slate-950',
          };
        };

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
              <h2 className="text-2xl font-black text-slate-900">Payment Operations Dashboard</h2>
              <p className="mt-1 text-sm text-slate-600">Monitor digital payments, payout flows, wallet loads, refunds, and operational risk across UniXchange.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              {[
                ['Gateway', gatewayStatus.gateway],
                ['Webhook', gatewayStatus.webhook],
                ['Settlement Currency', gatewayStatus.currency],
                ['Heartbeat', gatewayStatus.last_checked ? new Date(gatewayStatus.last_checked).toLocaleString() : 'Checking...'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
                  <p className="mt-3 flex items-center gap-2 text-base font-black text-slate-950">
                    {(label === 'Gateway' || label === 'Webhook') && (
                      <span className={`h-2.5 w-2.5 rounded-full ${/active|connected|configured|ok|healthy/i.test(String(value)) ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} />
                    )}
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Today\'s Revenue', calculatedPaymentMetrics.todayRevenue],
                ['Monthly Revenue', calculatedPaymentMetrics.monthlyRevenue],
                ['Successful Payments', calculatedPaymentMetrics.successful],
                ['Refunded Amount', calculatedPaymentMetrics.refunded],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{typeof value === 'number' && label !== 'Successful Payments' ? `${value.toLocaleString('en-ET')} ETB` : Number(value).toLocaleString('en-ET')}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-950">Transaction Registry</h3>
                  <p className="text-sm text-slate-500">Search and filter the latest UniXchange payment records.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={handleExportPaymentsCSV} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer">Export CSV</button>
                  <button type="button" onClick={handleExportPaymentsPDF} className="rounded-full bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer">Export PDF</button>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <input
                  type="text"
                  value={paymentSearchTerm}
                  onChange={(e) => { setPaymentSearchTerm(e.target.value); setPaymentPage(1); }}
                  placeholder="Search transaction, buyer, seller, or order ID..."
                  className="min-w-0 flex-1 basis-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                />

                <select
                  value={paymentStatusFilter}
                  onChange={(e) => { setPaymentStatusFilter(e.target.value); setPaymentPage(1); }}
                  className="min-w-[140px] shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Status: All</option>
                  <option value="Successful">Successful</option>
                  <option value="Pending">Pending</option>
                  <option value="Failed">Failed</option>
                </select>

                <select
                  value={paymentMethodFilter}
                  onChange={(e) => { setPaymentMethodFilter(e.target.value); setPaymentPage(1); }}
                  className="min-w-[200px] shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Payment Method: All</option>
                  <option value="Chapa">Chapa</option>
                  <option value="Wallet">Wallet</option>
                </select>
                <input
                  type="date"
                  value={paymentDateFilter}
                  onChange={(e) => { setPaymentDateFilter(e.target.value); setPaymentPage(1); }}
                  aria-label="Filter by date"
                  className="w-[180px] shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 md:hidden">
                {displayedPayments.map((payment) => {
                  const amount = formatPaymentAmount(payment);
                  return (
                    <article key={payment.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Transaction ID</p>
                          {renderPaymentId(payment.transaction_id, 'Transaction ID')}
                        </div>
                        <StatusBadge status={payment.status || 'Pending'} />
                      </div>
                      <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 text-sm">
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Buyer ID</p>{renderPaymentId(payment.buyer_id, 'Buyer ID')}</div>
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Seller ID</p>{renderPaymentId(payment.seller_id, 'Seller ID')}</div>
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Order ID</p><p className="truncate whitespace-nowrap font-mono text-xs" title={payment.order_id}>{payment.order_id || '—'}</p></div>
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Amount</p><p className={`whitespace-nowrap font-semibold ${amount.color}`}>{amount.text}</p></div>
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Payment Type</p><p className="break-words">{payment.payment_type || '—'}</p></div>
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Payment Method</p><p className="break-words">{payment.payment_method || '—'}</p></div>
                      </div>
                      <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Date</p>
                          <p className="whitespace-nowrap text-sm">{new Date(payment.created_date || payment.date).toLocaleDateString()}</p>
                          <p className="whitespace-nowrap text-xs text-slate-500">{new Date(payment.created_date || payment.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                        </div>
                        <ActionButton type="button" onClick={() => { setPaymentVerificationMessage(''); setSelectedPaymentDetail(payment); }} className="border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100">View Details</ActionButton>
                      </div>
                    </article>
                  );
                })}
              </div>

              <AdminTable className="mt-6 hidden border border-slate-200 md:block">
                <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="min-w-[190px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Transaction ID</th>
                    <th className="min-w-[130px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Buyer ID</th>
                    <th className="min-w-[130px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Seller ID</th>
                    <th className="min-w-[100px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Order ID</th>
                    <th className="min-w-[120px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Amount</th>
                    <th className="min-w-[150px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Payment Type</th>
                    <th className="min-w-[140px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Payment Method</th>
                    <th className="min-w-[130px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Status</th>
                    <th className="min-w-[170px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Date</th>
                    <th className="sticky right-0 z-30 min-w-[140px] bg-slate-50 px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.4)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPayments.map((payment) => {
                    const amount = formatPaymentAmount(payment);
                    const transactionDate = new Date(payment.created_date || payment.date);
                    return (
                      <tr key={payment.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                        <td className="min-w-[190px] px-4 py-3 align-middle">{renderPaymentId(payment.transaction_id, 'Transaction ID')}</td>
                        <td className="min-w-[130px] px-4 py-3 align-middle">{renderPaymentId(payment.buyer_id, 'Buyer ID')}</td>
                        <td className="min-w-[130px] px-4 py-3 align-middle">{renderPaymentId(payment.seller_id, 'Seller ID')}</td>
                        <td className="min-w-[100px] px-4 py-3 align-middle"><span className="whitespace-nowrap font-mono text-xs">{payment.order_id || '—'}</span></td>
                        <td className="min-w-[120px] px-4 py-3 align-middle"><span className={`whitespace-nowrap font-semibold ${amount.color}`}>{amount.text}</span></td>
                        <td className="min-w-[150px] px-4 py-3 align-middle">{payment.payment_type}</td>
                        <td className="min-w-[140px] px-4 py-3 align-middle">{payment.payment_method}</td>
                        <td className="min-w-[130px] px-4 py-3 align-middle"><StatusBadge status={payment.status || 'Pending'} /></td>
                        <td className="min-w-[170px] px-4 py-3 align-middle text-slate-500">
                          <time className="block whitespace-nowrap text-sm">{transactionDate.toLocaleDateString()}</time>
                          <time className="block whitespace-nowrap text-xs text-slate-400">{transactionDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                        </td>
                        <td className="sticky right-0 z-10 min-w-[140px] bg-white px-4 py-3 align-middle shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.4)]">
                          <ActionButton type="button" onClick={() => { setPaymentVerificationMessage(''); setSelectedPaymentDetail(payment); }} className="border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100">View Details</ActionButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </AdminTable>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setPaymentPage((page) => Math.max(1, page - 1))} disabled={paymentPage === 1} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="text-sm font-semibold text-slate-500">Page {paymentPage} of {totalPaymentPages}</span>
                <button type="button" onClick={() => setPaymentPage((page) => Math.min(totalPaymentPages, page + 1))} disabled={paymentPage === totalPaymentPages} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>

              {filteredPayments.length === 0 && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                  <p className="text-base font-bold">No matching transactions found.</p>
                </div>
              )}
            </div>

            {selectedPaymentDetail && (
              <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm md:items-center">
                <div className="my-auto w-full max-w-2xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-sky-600">Transaction Detail</p>
                      <h3 className="mt-1 text-2xl font-black text-slate-950">{selectedPaymentDetail.transaction_id}</h3>
                    </div>
                    <button type="button" onClick={() => { setPaymentVerificationMessage(''); setSelectedPaymentDetail(null); }} className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-600">✕</button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Transaction ID</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.transaction_id}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Buyer ID</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.buyer_id}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Seller</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.seller_id}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Order ID</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.order_id}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Amount</p>
                      <p className="mt-2 text-base font-black text-slate-900">{new Intl.NumberFormat('en-ET').format(selectedPaymentDetail.amount)} ETB</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Payment Method</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.payment_method}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.status}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Created Date</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.created_date ? new Date(selectedPaymentDetail.created_date).toLocaleString() : 'Unavailable'}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Completed Date</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.completed_date ? new Date(selectedPaymentDetail.completed_date).toLocaleString() : 'Not completed'}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Chapa Reference</p>
                      <p className="mt-2 break-words text-base font-black text-slate-900">{selectedPaymentDetail.chapa_reference || 'Not applicable'}</p>
                    </div>
                  </div>

                  {selectedPaymentDetail.status !== 'Successful' && (
                    <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-bold text-red-700">🔴 Failed verification status</p>
                      <button type="button" onClick={handleRetryPaymentVerification} disabled={paymentVerificationLoading} className="mt-3 rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                        {paymentVerificationLoading ? 'Verifying...' : 'Retry Verification'}
                      </button>
                      {paymentVerificationMessage && <p className="mt-2 text-xs font-semibold text-red-700">{paymentVerificationMessage}</p>}
                    </div>
                  )}

                  {selectedPaymentDetail.payment_type && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Payment Type</p>
                      <p className="mt-2 text-base font-black text-slate-900">{selectedPaymentDetail.payment_type}</p>
                    </div>
                  )}
                  <div className="mt-6 flex justify-end border-t border-slate-100 pt-4">
                    <button type="button" onClick={() => { setPaymentVerificationMessage(''); setSelectedPaymentDetail(null); }} className="btn-primary rounded-full px-5 py-2.5 text-sm font-bold">
                      Back
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'support':
        return <AdminSupportInbox onItemsSeen={optimisticallyMarkAdminItemsSeen} />;
      case 'product-reviews':
        return <AdminProductReviewsPage onNavigate={(target, params) => {
          if (target === 'product-details') {
            onNavigate?.(target, params);
            return;
          }
          handleTabClick(target);
        }} />;
      case 'reports': {
        const enrichedReports = reportsList.map((report) => ({
          ...report,
          inferredType: getComplaintType(report.issue),
          priority: getReportPriority(report.issue),
        }));
        const filteredReports = enrichedReports.filter((report) => {
          const searchValue = reportSearchTerm.toLowerCase();
          const matchesSearch = !searchValue ||
            report.report_id.toLowerCase().includes(searchValue) ||
            report.student.toLowerCase().includes(searchValue) ||
            report.product_name.toLowerCase().includes(searchValue) ||
            report.issue.toLowerCase().includes(searchValue) ||
            report.inferredType.toLowerCase().includes(searchValue);

          const matchesType = reportTypeFilter === 'All' || report.inferredType === reportTypeFilter;
          const matchesStatus = reportStatusFilter === 'All' || report.status === reportStatusFilter;
          const matchesPriority = reportPriorityFilter === 'All' || report.priority.label === reportPriorityFilter;

          return matchesSearch && matchesType && matchesStatus && matchesPriority;
        });
        const totalReportPages = Math.max(1, Math.ceil(filteredReports.length / REPORTS_PER_PAGE));
        const displayedReports = filteredReports.slice((reportPage - 1) * REPORTS_PER_PAGE, reportPage * REPORTS_PER_PAGE);

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">Reports & Complaints Dashboard</h2>
                  <p className="mt-1 text-sm text-slate-600">Monitor UniXchange disputes, fraud, content violations, and moderation outcomes.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={markAllReportsSeen} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Mark all as seen</button>
                  <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
                    <span>🚨</span>
                    <span>High Priority: {calculatedReportMetrics.highPriority}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-[24px] border border-slate-200 bg-slate-100/70 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Total Reports</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedReportMetrics.total}</p>
              </div>
              <div className="rounded-[24px] border border-sky-100 bg-sky-50 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">Open Reports</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedReportMetrics.open}</p>
              </div>
              <div className="rounded-[24px] border border-violet-100 bg-violet-50 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">Under Review</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedReportMetrics.underReview}</p>
              </div>
              <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Resolved Reports</p>
                <p className="mt-3 text-3xl font-black text-slate-950">{calculatedReportMetrics.resolved}</p>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={reportSearchTerm}
                  onChange={(e) => { setReportSearchTerm(e.target.value); setReportPage(1); }}
                  placeholder="Search report/student..."
                  className="min-w-0 flex-1 basis-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                />

                <select
                  value={reportTypeFilter}
                  onChange={(e) => { setReportTypeFilter(e.target.value); setReportPage(1); }}
                  className="min-w-0 flex-1 basis-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Complaint Type: All</option>
                  <option value="Product Issue">Product Issue</option>
                  <option value="Fraud/Scam">Fraud/Scam</option>
                  <option value="Seller Misconduct">Seller Misconduct</option>
                  <option value="Buyer Misconduct">Buyer Misconduct</option>
                  <option value="Payment Problem">Payment Problem</option>
                  <option value="Order Problem">Order Problem</option>
                  <option value="Fake Product">Fake Product</option>
                  <option value="Inappropriate Content">Inappropriate Content</option>
                  <option value="Other">Other</option>
                </select>

                <select
                  value={reportStatusFilter}
                  onChange={(e) => { setReportStatusFilter(e.target.value); setReportPage(1); }}
                  className="min-w-0 flex-1 basis-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Status: All</option>
                  <option value="Open">Open</option>
                  <option value="Review">Review</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>

                <select
                  value={reportPriorityFilter}
                  onChange={(e) => { setReportPriorityFilter(e.target.value); setReportPage(1); }}
                  className="min-w-0 flex-1 basis-[180px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none"
                >
                  <option value="All">Priority: All</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {displayedReports.map((rep) => (
                  <article key={rep.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Report ID</p>
                        <p className={`truncate font-mono text-xs ${ADMIN_REPORT_ITEM_STYLES[rep.is_unseen ? 'unseen' : 'seen']}`} title={rep.report_id}>
                          {rep.is_unseen && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500" aria-label="Unseen" />}
                          {rep.report_id}
                        </p>
                        <p className="mt-1 whitespace-nowrap text-sm font-semibold text-slate-700">{rep.inferredType}</p>
                      </div>
                      <time className="shrink-0 whitespace-nowrap text-xs text-slate-500">{new Date(rep.date).toLocaleDateString()}</time>
                    </div>
                    <div className="mt-3 min-w-0">
                      <p className="truncate font-semibold text-slate-900" title={rep.product_name}>{rep.product_name || 'Report details'}</p>
                      <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-slate-600" title={rep.issue}>{rep.issue}</p>
                      <p className="mt-2 truncate text-sm font-semibold text-slate-700" title={`${rep.student || ''} ${rep.student_id || ''}`}>{rep.student} <span className="text-xs text-slate-500">{rep.student_id}</span></p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <StatusBadge status={rep.priority.label} />
                      <StatusBadge status={rep.status === 'Review' ? 'In Review' : rep.status} />
                    </div>
                    <div className="mt-4 flex justify-end">
                      <ActionButton type="button" onClick={() => handleOpenReportModal(rep)} className="border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">Review</ActionButton>
                    </div>
                  </article>
                ))}
              </div>
              <AdminTable className="hidden border border-slate-200 md:block">
                <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="min-w-[110px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Report ID</th>
                    <th className="min-w-[140px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Type</th>
                    <th className="min-w-[260px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Issue / Details</th>
                    <th className="min-w-[170px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Reporter</th>
                    <th className="min-w-[110px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Priority</th>
                    <th className="min-w-[120px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Status</th>
                    <th className="min-w-[120px] px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left">Date</th>
                    <th className="sticky right-0 z-30 min-w-[120px] bg-slate-50 px-4 py-3 text-xs uppercase tracking-wide whitespace-nowrap text-left shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.4)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedReports.map((rep) => (
                    <tr key={rep.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                      <td className="min-w-[110px] px-4 py-3 align-middle">
                        <span className={`inline-flex items-center whitespace-nowrap font-mono text-xs ${ADMIN_REPORT_ITEM_STYLES[rep.is_unseen ? 'unseen' : 'seen']}`}>
                          {rep.is_unseen && <span className="mr-1.5 h-2 w-2 rounded-full bg-rose-500" aria-label="Unseen" />}
                          {rep.report_id}
                        </span>
                      </td>
                      <td className="min-w-[140px] px-4 py-3 align-middle"><span className="whitespace-nowrap font-semibold text-slate-700">{rep.inferredType}</span></td>
                      <td className="admin-table-wrap-cell min-w-[260px] px-4 py-3 align-middle text-slate-700">
                        <p title={rep.product_name} className="font-semibold text-slate-900">{rep.product_name || 'Report details'}</p>
                        <p title={rep.issue} className="mt-1 line-clamp-2 break-words text-xs leading-5 text-slate-600">{rep.issue}</p>
                      </td>
                      <td className="min-w-[170px] px-4 py-3 align-middle font-semibold text-slate-600">
                        <div className="text-sm font-semibold text-slate-900">{rep.student}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{rep.student_id}</div>
                      </td>
                      <td className="min-w-[110px] px-4 py-3 align-middle"><StatusBadge status={rep.priority.label} /></td>
                      <td className="min-w-[120px] px-4 py-3 align-middle"><StatusBadge status={rep.status === 'Review' ? 'In Review' : rep.status} /></td>
                      <td className="min-w-[120px] px-4 py-3 align-middle"><time className="whitespace-nowrap text-xs text-slate-500">{new Date(rep.date).toLocaleDateString()}</time></td>
                      <td className="sticky right-0 z-10 min-w-[120px] bg-white px-4 py-3 align-middle shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.4)]">
                        <ActionButton type="button" onClick={() => handleOpenReportModal(rep)} className="border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50">Review</ActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setReportPage((page) => Math.max(1, page - 1))} disabled={reportPage === 1} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="text-sm font-semibold text-slate-500">Page {reportPage} of {totalReportPages}</span>
                <button type="button" onClick={() => setReportPage((page) => Math.min(totalReportPages, page + 1))} disabled={reportPage === totalReportPages} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
              {filteredReports.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  <p className="font-semibold">No reports match the selected filters.</p>
                </div>
              )}
            </div>

            {selectedReport && (() => {
              const reportErrorDetail = typeof reportError === 'string'
                ? reportError
                : reportError?.response?.data?.detail || reportError?.detail;
              const reportErrorMessage = typeof reportErrorDetail === 'string'
                ? reportErrorDetail
                : reportErrorDetail?.message || reportError?.message || t('adminReports.contextError');
              const generalReport = /general/i.test(selectedReport.category || '');
              const noContextLabel = generalReport ? t('adminReports.notSpecified') : t('adminReports.notRecorded');
              const productId = reportContext?.product?.id || selectedReport.product_id;
              const productTitle = reportContext?.product?.title || selectedReport.product_name;
              const sellerName = reportContext?.seller?.seller_name || selectedReport.seller_name || selectedReport.seller_id;
              const linkedOrderId = reportContext?.order?.id || selectedReport.order_id;
              const hasLinkedTargets = Boolean(sellerName || productId || productTitle || linkedOrderId);
              const closedReport = ['Resolved', 'Dismissed'].includes(selectedReport.status);
              const decisionAvailability = reportContext?.decision_availability?.[reportDecision];
              const selectedDecisionEnabled = Boolean(reportDecision && decisionAvailability?.enabled);
              const resolveRequirements = [];
              if (!reportDecision) resolveRequirements.push('Select a decision');
              else if (!selectedDecisionEnabled && decisionAvailability?.reason) resolveRequirements.push(decisionAvailability.reason);
              if (reportReason.trim().length < 10) resolveRequirements.push('Reason needs 10+ characters');
              if (reportReason.trim().length > 1000) resolveRequirements.push('Reason must be 1000 characters or fewer');
              const canResolve = Boolean(
                reportReviewOwned
                && !reportReviewLoading
                && !reportActionLoading
                && !closedReport
                && selectedDecisionEnabled
                && reportReason.trim().length >= 10
                && reportReason.trim().length <= 1000,
              );
              const optionLabel = (decision) => (
                reportDecisionOptions.find((option) => option.key === decision)?.label || decision
              );
              const accountAgeLabel = (createdAt) => {
                if (!createdAt) return noContextLabel;
                const ageInDays = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
                if (ageInDays >= 365) return `${Math.floor(ageInDays / 365)} ${t('adminReports.years')}`;
                if (ageInDays >= 30) return `${Math.floor(ageInDays / 30)} ${t('adminReports.months')}`;
                return `${ageInDays} ${t('adminReports.days')}`;
              };
              const closeReportModal = () => {
                if (reportActionLoading) return;
                setSelectedReport(null);
                setShowReportModal(false);
                setReportContext(null);
                setReportError('');
              };

              return (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-2 backdrop-blur-sm sm:p-4">
                  <div className="flex max-h-[96dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-[32px]">
                    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-7 sm:py-5">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-sky-600">{t('adminReports.title')}</p>
                        <h3 className="mt-1 text-2xl font-black text-slate-950">{selectedReport.report_id}</h3>
                      </div>
                      <button type="button" onClick={closeReportModal} disabled={reportActionLoading} aria-label={t('adminReports.close')} className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-600 disabled:opacity-50">✕</button>
                    </div>

                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
                      {reportError && (
                        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                          <p>{reportErrorMessage}</p>
                          <button type="button" onClick={() => handleOpenReportModal(selectedReport)} disabled={reportReviewLoading} className="rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
                            Retry
                          </button>
                        </div>
                      )}
                      {reportReviewLoading && <p role="status" className="rounded-2xl bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">{t('adminReports.openingReview')}</p>}
                      {reportContext?.auto_linked_from_product && (
                        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                          Linked automatically from product
                        </p>
                      )}
                      {reportContext?.review_by && (
                        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                          Review by {new Date(`${reportContext.review_by}T00:00:00`).toLocaleDateString()}
                          {reportContext.review_overdue ? ' · Overdue' : ''}
                        </p>
                      )}
                      {reportContext?.internal_notes?.length > 0 && (
                        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <h4 className="text-sm font-bold text-amber-900">Internal admin notes</h4>
                          {reportContext.internal_notes.map((note, index) => (
                            <p key={`${note.created_at}-${index}`} className="mt-2 whitespace-pre-wrap text-sm text-amber-950">{note.body}</p>
                          ))}
                        </section>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.reporter')}</p>
                          <p className="mt-2 font-black text-slate-900">{selectedReport.student || noContextLabel}</p>
                          <p className="mt-1 text-xs text-slate-600">{t('adminReports.studentId')}: {selectedReport.student_id || noContextLabel}</p>
                          <p className="mt-1 text-xs text-slate-600">{t('adminReports.reportCount')}: {reportContext?.reporter?.report_count ?? noContextLabel}</p>
                          <p className="mt-1 text-xs text-slate-600">{t('adminReports.verified')}: {reportContext?.reporter?.verified_student == null ? noContextLabel : reportContext.reporter.verified_student ? t('adminReports.yes') : t('adminReports.no')}</p>
                          <p className="mt-1 text-xs text-slate-600">{t('adminReports.accountAge')}: {accountAgeLabel(reportContext?.reporter?.account_created_at)}</p>
                        </div>
                        {!hasLinkedTargets ? (
                          <p role="status" className="self-start rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
                            ⚠️ Unlinked Report: Reporter did not specify a seller or order.
                          </p>
                        ) : (
                          <>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.reportedSeller')}</p>
                              <p className="mt-2 font-black text-slate-900">{sellerName || noContextLabel}</p>
                              {reportContext?.seller && (
                                <>
                                  <p className="mt-1 text-xs text-slate-600">{t('adminReports.complaints')}: {reportContext.seller.complaint_count}</p>
                                  <p className="mt-1 text-xs text-slate-600">{t('adminReports.rating')}: {reportContext.seller.average_rating == null ? t('adminReports.noRatings') : `${reportContext.seller.average_rating.toFixed(1)} / 5 (${reportContext.seller.rating_count})`}</p>
                                  <p className="mt-1 text-xs text-slate-600">{t('adminReports.verified')}: {reportContext.seller.verified_student ? t('adminReports.yes') : t('adminReports.no')}</p>
                                  <p className="mt-1 text-xs text-slate-600">{t('adminReports.accountAge')}: {accountAgeLabel(reportContext.seller.account_created_at)}</p>
                                  <p className="mt-1 text-xs text-slate-600">{t('adminReports.walletStatus')}: {reportContext.seller.wallet_status?.join(', ') || noContextLabel}</p>
                                </>
                              )}
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.product')}</p>
                              {productId && productTitle ? (
                                <button
                                  type="button"
                                  onClick={() => onNavigate?.('product-details', { productId })}
                                  className="mt-2 text-left font-black text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900"
                                >
                                  {productTitle}
                                </button>
                              ) : <p className="mt-2 font-black text-slate-900">{noContextLabel}</p>}
                              {reportContext?.product?.owner_student_id && (
                                <p className="mt-2 text-xs text-slate-600">
                                  Verified owner: {reportContext.product.owner_name || 'Unknown'} ({reportContext.product.owner_student_id})
                                </p>
                              )}
                              <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.order')}</p>
                              {reportContext?.order ? (
                                <p className="mt-2 font-black text-slate-900">#{reportContext.order.id} · {reportContext.order.title}</p>
                              ) : linkedOrderId ? (
                                <p className="mt-2 font-black text-slate-900">#{linkedOrderId}</p>
                              ) : <p className="mt-2 font-black text-slate-900">{noContextLabel}</p>}
                              {reportContext?.order?.paid_amount && <p className="mt-1 text-xs text-slate-600">{t('adminReports.paidAmount')}: {Number(reportContext.order.paid_amount).toFixed(2)} ETB</p>}
                            </div>
                          </>
                        )}
                      </div>

                      {reportContextLoading && <p role="status" className="text-sm font-semibold text-slate-500">{t('adminReports.loadingContext')}</p>}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.complaintType')}</p>
                          <p className="mt-2 font-black text-slate-900">{getComplaintType(selectedReport.issue)}</p>
                          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.status')}</p>
                          <p className="mt-1 font-black text-slate-900">{selectedReport.status}</p>
                          {selectedReport.reviewed_by_name && <p className="mt-2 text-xs text-slate-600">{t('adminReports.reviewedBy')}: {selectedReport.reviewed_by_name} · {selectedReport.reviewed_at ? new Date(selectedReport.reviewed_at).toLocaleString() : ''}</p>}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{t('adminReports.issueDetails')}</p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{selectedReport.issue}</p>
                          <p className="mt-3 text-xs text-slate-500">{selectedReport.date ? new Date(selectedReport.date).toLocaleString() : noContextLabel}</p>
                        </div>
                      </div>

                      {reportContext?.seller_response && (
                        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-700">{t('adminReports.sellerResponse')}</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{reportContext.seller_response}</p>
                          {reportContext.seller_response_at && <p className="mt-2 text-xs text-slate-500">{new Date(reportContext.seller_response_at).toLocaleString()}</p>}
                          {reportContext.seller_response_image && <img src={resolveImageUrl(reportContext.seller_response_image)} alt={t('adminReports.sellerResponsePhoto')} className="mt-3 max-h-64 rounded-xl object-contain" />}
                        </div>
                      )}
                      {reportContext?.appeal && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-800">{t('adminReports.appeal')}</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{reportContext.appeal.text}</p>
                          <p className="mt-2 text-xs text-slate-600">{reportContext.appeal.by} · {new Date(reportContext.appeal.at).toLocaleString()}</p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={handleViewEvidence} className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-700 hover:bg-sky-100">{t('adminReports.viewEvidence')}</button>
                        <button type="button" onClick={handleViewConversationLogs} disabled={conversationLoading} className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60">{conversationLoading ? t('adminReports.loadingLogs') : t('adminReports.viewConversation')}</button>
                      </div>

                      {closedReport ? (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                          <p className="font-black text-emerald-900">{t('adminReports.resolvedDecision')}: {selectedReport.decision === 'Refund' ? 'Refund' : optionLabel(selectedReport.decision)}</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{selectedReport.decision_reason}</p>
                          <p className="mt-2 text-xs text-emerald-800">
                            {selectedReport.resolved_by_name || noContextLabel}
                            {selectedReport.resolved_at ? ` · ${new Date(selectedReport.resolved_at).toLocaleString()}` : ''}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                          <div>
                            <label className="block text-sm font-bold text-slate-700" htmlFor="admin-report-decision">{t('adminReports.decision')}</label>
                            <select id="admin-report-decision" value={reportDecision} onChange={(event) => setReportDecision(event.target.value)} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none">
                              <option value="">{t('adminReports.selectDecision')}</option>
                              {reportDecisionOptions.map((option) => {
                                const availability = reportContext?.decision_availability?.[option.key];
                                const disabled = !availability?.enabled;
                                return (
                                  <option key={option.key} value={option.key} disabled={disabled}>
                                    {option.label}{disabled && availability?.reason ? ` — ${availability.reason}` : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                          {linkedOrderId && (
                            <p className="text-xs font-medium text-slate-500">
                              To refund a buyer, use the order&apos;s{' '}
                              <button
                                type="button"
                                onClick={() => {
                                  closeReportModal();
                                  handleTabClick('disputes');
                                }}
                                className="font-bold text-sky-700 underline underline-offset-2 hover:text-sky-900"
                              >
                                dispute (order #{linkedOrderId})
                              </button>
                              .
                            </p>
                          )}
                          {reportDecision === 'escalate' && (
                            <div className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:grid-cols-2">
                              <label className="block text-xs font-semibold text-slate-700" htmlFor="report-review-by">
                                Optional review-by date
                                <input id="report-review-by" type="date" value={reportReviewBy} onChange={(event) => setReportReviewBy(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" />
                              </label>
                              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2" htmlFor="report-reporter-message">
                                Optional message to reporter
                                <textarea id="report-reporter-message" rows="2" maxLength={5000} value={reportReporterMessage} onChange={(event) => setReportReporterMessage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Request additional information from the reporter" />
                              </label>
                              <p className="text-xs text-amber-900 sm:col-span-2">Escalation records the internal note and leaves this report Under Review.</p>
                            </div>
                          )}
                          {reportContext?.reporter?.flagged_for_admin_attention && (
                            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                              Reporter has {reportContext.reporter.dismissed_report_count} dismissed reports. Flagged for admin attention only; no automatic action is taken.
                            </p>
                          )}
                          <div>
                            <label className="block text-sm font-bold text-slate-700" htmlFor="admin-report-reason">{reportDecision === 'escalate' ? 'Internal admin note' : t('adminReports.reason')}</label>
                            <textarea id="admin-report-reason" rows="3" maxLength={1000} value={reportReason} onChange={(event) => setReportReason(event.target.value)} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:border-sky-500 focus:outline-none" placeholder={reportDecision === 'escalate' ? 'Internal note (not visible to students)' : t('adminReports.reasonPlaceholder')} />
                            <p className={`mt-1 text-xs ${reportReason.trim().length < 10 ? 'text-rose-600' : 'text-slate-500'}`}>{t('adminReports.reasonMinLength')}: {reportReason.trim().length}/1000</p>
                          </div>
                          {resolveRequirements.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs font-semibold text-slate-600">{resolveRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>}
                        </div>
                      )}
                    </div>

                    <div className="sticky bottom-0 flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-16px_rgba(15,23,42,0.45)] sm:px-7">
                      <button type="button" onClick={closeReportModal} disabled={reportActionLoading} className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t('adminReports.close')}</button>
                      {!closedReport && (
                        <button type="button" onClick={() => handleResolveReport(selectedReport.id)} disabled={!canResolve} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                          {reportActionLoading ? t('adminReports.resolving') : t('adminReports.resolve')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
            {reportToast && (
              <div role="alert" className="fixed right-6 top-6 z-[1200] rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-800 shadow-lg">
                {reportToast}
              </div>
            )}
            {evidenceImage && (
              <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setEvidenceImage(null)}>
                <div className="relative max-h-[90vh] max-w-3xl rounded-2xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <button type="button" onClick={() => setEvidenceImage(null)} className="absolute right-3 top-3 rounded-full bg-slate-900/75 px-3 py-1 text-sm font-bold text-white" aria-label="Close evidence photo">✕</button>
                  <img src={resolveImageUrl(evidenceImage)} alt="Report evidence" className="max-h-[82vh] max-w-full rounded-xl object-contain" onError={() => { setEvidenceImage(null); setReportToast('The evidence photo could not be loaded.'); window.setTimeout(() => setReportToast(''), 3000); }} />
                </div>
              </div>
            )}
            {conversationLogs && (
              <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setConversationLogs(null)}>
                <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
                    <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-500">Conversation Logs</p><h3 className="mt-1 text-xl font-black text-slate-950">Buyer and Seller Transcript</h3></div>
                    <button type="button" onClick={() => setConversationLogs(null)} className="rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-600" aria-label="Close conversation logs">✕</button>
                  </div>
                  <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
                    {conversationLogs.messages?.length ? conversationLogs.messages.map((message) => (
                      <div key={message.id} className={`rounded-2xl p-3 ${message.sender_id === conversationLogs.reporter_id ? 'bg-sky-50' : 'bg-indigo-50'}`}>
                        <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500"><span>{message.sender_id === conversationLogs.reporter_id ? 'Reporter' : 'Reported Seller'} ({message.sender_id})</span><time>{message.created_at ? new Date(message.created_at).toLocaleString() : 'Unknown time'}</time></div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{message.message}</p>
                        {message.attachment_url && <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-indigo-700 underline">View attachment</a>}
                      </div>
                    )) : <p className="py-10 text-center text-sm font-semibold text-slate-500">No conversation messages were found between these users.</p>}
                  </div>
                  <button type="button" onClick={() => setConversationLogs(null)} className="mt-5 w-full rounded-full bg-slate-900 py-3 font-bold text-white hover:bg-slate-800">Close Logs</button>
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'analytics': {
        const analyticsRegistrations = Array.isArray(metrics.registrations) ? metrics.registrations : userGrowthTrend;
        const analyticsRevenue = analyticsSalesData.revenue;
        const registrationChartMax = Math.max(...analyticsRegistrations.map((value) => Number(value) || 0), 1);
        const registrationPath = generateSvgPath(analyticsRegistrations, registrationChartMax, 560, 130, 20);
        const registrationAreaPath = generateSvgAreaPath(analyticsRegistrations, registrationChartMax, 560, 130, 20);
        const { pts, path: revenuePath, areaPath: revenueAreaPath } = buildAnalyticsRevenueChart(
          analyticsSalesData.labels,
          analyticsRevenue,
        );
        const registrationLabels = metrics.registrationLabels?.length ? metrics.registrationLabels : analyticsRegistrations.map((_, index) => `Day ${index + 1}`);
        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-600">UniXchange Analytics</p>
                  <h2 className="mt-2 text-3xl font-black text-slate-900">Analytics </h2>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Metrics
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {analyticsSummaryCards.map((item) => {
                const growth = getAnalyticsGrowthPresentation(item.growth);
                const toneClasses = {
                  up: 'bg-emerald-100 text-emerald-700',
                  down: 'bg-rose-100 text-rose-700',
                  neutral: 'bg-slate-100 text-slate-600',
                  blue: 'bg-sky-100 text-sky-700',
                }[growth.tone];
                const trendTextClasses = {
                  up: 'text-emerald-600',
                  down: 'text-rose-600',
                  neutral: 'text-slate-500',
                  blue: 'text-sky-600',
                }[growth.tone];
                const trendDotClasses = {
                  up: 'bg-emerald-500',
                  down: 'bg-rose-500',
                  neutral: 'bg-slate-400',
                  blue: 'bg-sky-500',
                }[growth.tone];
                return (
                  <div key={item.label} className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{item.label}</p>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${toneClasses}`}>{growth.percentage}</span>
                    </div>
                    <p className="mt-4 text-3xl font-black text-slate-950">{typeof item.value === 'number' ? item.value.toLocaleString() : item.value}</p>
                    <div className={`mt-4 flex items-center gap-2 text-xs font-semibold ${trendTextClasses}`}>
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${trendDotClasses}`} />
                      {growth.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.5fr_0.95fr]">
              <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Sales Overview</p>
                    <h3 className="mt-1 text-xl font-black text-slate-950">Sales & Revenue</h3>
                  </div>
                  <div className="flex w-fit items-center gap-1 rounded-2xl bg-slate-100 p-1">
                    {analyticsSalesPeriods.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={period === key}
                        onClick={() => changeAnalyticsPeriod(key, setPeriod)}
                        className={getAnalyticsPeriodButtonClass(period, key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {analyticsSalesLoading ? (
                  <div className="flex h-64 items-center justify-center text-center text-sm font-semibold text-slate-500" role="status">
                    Loading sales data...
                  </div>
                ) : analyticsSalesError ? (
                  <div className="flex h-64 items-center justify-center px-4 text-center text-sm font-semibold text-rose-600" role="alert">
                    Unable to load sales data: {analyticsSalesError}
                  </div>
                ) : !pts.length ? (
                  <div className="flex h-64 items-center justify-center text-center text-sm font-semibold text-slate-500">
                    No sales data
                  </div>
                ) : (
                  <svg viewBox="0 0 640 160" className="h-64 w-full">
                    <defs>
                      <linearGradient id="salesBg" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>

                    {[0, 1, 2, 3, 4].map((line) => (
                      <line key={line} x1="20" x2="600" y1={30 + line * 25} y2={30 + line * 25} stroke="#e2e8f0" strokeDasharray="4 8" />
                    ))}

                    <path d={revenueAreaPath} fill="url(#salesBg)" opacity="0.7" />
                    <path d={revenuePath} fill="none" stroke="#4f46e5" strokeWidth="4" strokeLinecap="round" />

                    {pts.map(({ x, y, label }, index) => (
                      <g key={`${label}-${index}`}>
                        <circle cx={x} cy={y} r="4" fill="#4f46e5" />
                        <text x={x} y="155" fill="#64748b" fontSize="11" textAnchor="middle">{label}</text>
                      </g>
                    ))}
                  </svg>
                )}
              </div>

              <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Order Distribution</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">Order Status</h3>

                <div className="mt-5 flex items-center justify-center">
                  <svg viewBox="0 0 220 220" className="h-52 w-52">
                    <circle cx="110" cy="110" r="66" fill="none" stroke="#e2e8f0" strokeWidth="26" />
                    {overviewOrderStatus.map((status, index) => {
                      const offset = overviewOrderStatus
                        .slice(0, index)
                        .reduce((total, item) => total + Number(item.value ?? 0), 0);
                      const value = Number(status.value ?? 0);
                      const circumference = 2 * Math.PI * 66;
                      return (
                        <circle
                          key={status.label}
                          cx="110"
                          cy="110"
                          r="66"
                          fill="none"
                          stroke={status.color ?? '#64748b'}
                          strokeWidth="26"
                          strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
                          strokeLinecap="round"
                          strokeDashoffset={`${-(offset / 100) * circumference}`}
                          transform="rotate(-90 110 110)"
                        />
                      );
                    })}
                    <text x="110" y="108" textAnchor="middle" className="fill-slate-900 text-4xl font-black">{metrics.totalOrders.toLocaleString()}</text>
                    <text x="110" y="128" textAnchor="middle" className="fill-slate-500 text-[10px] font-bold uppercase tracking-[0.2em]">Orders</text>
                  </svg>
                </div>

                <div className="mt-5 space-y-2">
                  {overviewOrderStatus.map((status) => (
                    <div key={status.label} className="flex items-center justify-between text-sm font-semibold text-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color ?? '#64748b' }} />
                        {status.label}
                      </div>
                      <span>{typeof status.value === 'number' ? `${status.value}%` : status.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-2">
              <div className="min-w-0 w-full rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Student Growth</p>
                <h3 className="mt-1 break-normal text-xl font-black text-slate-950">New Student Registrations</h3>

                <svg viewBox="0 0 640 160" className="mt-4 h-56 w-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="regBg" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <line key={index} x1="20" x2="600" y1={30 + index * 25} y2={30 + index * 25} stroke="#e2e8f0" strokeDasharray="4 8" />
                  ))}
                  <path d={registrationAreaPath} fill="url(#regBg)" />
                  <path d={registrationPath} fill="none" stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round" />

                  {registrationLabels.map((label, index) => (
                    <g key={label}>
                      <circle cx={analyticsRegistrations.length > 1 ? 40 + index * (520 / (analyticsRegistrations.length - 1)) : 300} cy={110 - ((Number(analyticsRegistrations[index]) || 0) / registrationChartMax) * 90} r="4" fill="#0ea5e9" />
                      <text x={40 + index * 104} y="155" textAnchor="middle" fill="#64748b" fontSize="11">{label}</text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="min-w-0 w-full rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Performance</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">Category Performance</h3>

                <div className="admin-data-table-wrapper mt-5 max-w-full overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="admin-data-table w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-slate-100 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Category</th>
                        <th className="px-3 py-3">Products</th>
                        <th className="px-3 py-3">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewCategories.map((category) => (
                        <tr key={category.name} className="border-t border-slate-200 bg-white">
                          <td className="px-3 py-3 font-semibold text-slate-800">{category.name}</td>
                          <td className="px-3 py-3 text-slate-600">{category.product_count}</td>
                          <td className="px-3 py-3 font-bold text-emerald-600">{category.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
              <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">User Distribution</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">UniXchange Activity by College</h3>

                <div className="mt-5 space-y-5">
                  {collegeActivity.map((college) => (
                    <div key={college.name}>
                      <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-700">
                        <span>{college.name}</span>
                        <span>{college.percentage}%</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${college.color}`} style={{ width: `${college.percentage}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[30px] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
                <h3 className="mt-1 text-xl font-black">Performance Overview</h3>

                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-600">Active Students</div>
                    <div className="mt-2 text-3xl font-black text-emerald-700">{Number(metrics.active_students ?? metrics.activeStudents ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-600">Completed Orders</div>
                    <div className="mt-2 text-3xl font-black text-sky-700">{Number(metrics.completed_orders ?? metrics.completedOrders ?? 0).toLocaleString()}</div>
                  </div>
                  <p className="text-slate-700 text-xs sm:text-sm font-medium leading-relaxed bg-slate-50 border border-slate-200/80 rounded-xl p-3 mt-4">
                    Live overview of student activity and completed UniXchange orders from the current database snapshot.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-600">System Feed</p>
                  <h3 className="mt-1 text-xl font-black">Recent UniXchange Activity</h3>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">
                  Live
                </span>
              </div>

              <div>
                {(metrics.recent_activity ?? []).map((item, index) => (
                  <div key={item.id ?? `${item.time}-${index}`} className="flex flex-wrap items-start gap-x-3 border-b border-slate-100 py-3 last:border-0">
                    <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-y-1">
                      <span className="text-sm font-bold text-slate-900">{item.user || item.username || 'System'}</span>
                      <span className="ml-2 min-w-0 break-words text-sm font-medium text-slate-700">{String(item.description || item.action || item.details || item.message || item.event || 'Administrative action').replace(/\bmarketplace\b/gi, 'UniXchange')}</span>
                    </div>
                    <time className="ml-auto whitespace-nowrap text-xs font-medium text-slate-500">{item.time || '--:--'}</time>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }
      case 'notifications': {
        var broadcastTotals = announcementLog.reduce((totals, campaign) => ({
          sent: totals.sent + 1,
          delivered: totals.delivered + Number(campaign.delivered || 0),
          read: totals.read + Number(campaign.read || 0),
          unread: totals.unread + Number(campaign.unread || 0),
        }), { sent: 0, delivered: 0, read: 0, unread: 0 });

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-600">Broadcast center</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">Campus Notification Dashboard</h2>
                </div>
                <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">
                  Live Campaigns
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Campaigns Sent', value: broadcastTotals.sent, accent: 'bg-violet-50 text-violet-700', icon: '📣' },
                { label: 'Delivered', value: broadcastTotals.delivered, accent: 'bg-emerald-50 text-emerald-700', icon: '✅' },
                { label: 'Read', value: broadcastTotals.read, accent: 'bg-sky-50 text-sky-700', icon: '👁️' },
                { label: 'Unread', value: broadcastTotals.unread, accent: 'bg-amber-50 text-amber-700', icon: '🔔' }
              ].map((card) => (
                <div key={card.label} className={`rounded-[28px] border border-slate-200 p-5 shadow-sm ${card.accent}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] opacity-70">{card.label}</p>
                      <p className="mt-3 text-3xl font-black">{card.value}</p>
                    </div>
                    <div className="text-2xl">{card.icon}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
              <div className="min-w-0 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
                  <div className="min-w-0 flex-1 basis-full whitespace-normal">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Archive</p>
                    <h3 className="mt-1 whitespace-normal text-xl font-black text-slate-950">Historical Announcements</h3>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                    <input
                      type="text"
                      value={notificationsSearch}
                      onChange={(e) => setNotificationsSearch(e.target.value)}
                      placeholder="Search notifications"
                      className="min-w-0 flex-1 basis-[220px] rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none"
                    />
                    <select
                      value={notificationsFilter}
                      onChange={(e) => setNotificationsFilter(e.target.value)}
                      className="min-w-[140px] shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none"
                    >
                      <option value="All">All</option>
                      {Array.from(new Map(announcementLog.map((item) => [
                        normalizeTarget(item.target),
                        item.target,
                      ])).entries()).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[760px] w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        <th className="px-3 py-3">Title</th>
                        <th className="px-3 py-3">Target Audience</th>
                        <th className="px-3 py-3">Delivery Type</th>
                        <th className="px-3 py-3">Sent Date</th>
                        <th className="px-3 py-3">Read Rate</th>
                        <th className="px-3 py-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAnnouncements.map((log) => {
                        const readRate = Number(log.read_rate)
                          || (Number(log.delivered) > 0 ? Number(log.read || 0) / Number(log.delivered) * 100 : 0);
                        return (
                          <tr key={log.id} className="align-top text-sm text-slate-700">
                            <td className="max-w-[240px] px-3 py-4">
                              <p className="font-bold text-slate-950">{log.title}</p>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{log.message}</p>
                            </td>
                            <td className="px-3 py-4">{log.target}</td>
                            <td className="max-w-[190px] px-3 py-4">
                              {log.delivery_type || (log.delivery_channels || ['in_app'])
                                .map((channel) => ({
                                  in_app: 'In-App Notification',
                                  banner: 'Urgent Top Banner',
                                  email: 'Email Dispatch',
                                })[channel] || channel)
                                .join(', ')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-xs text-slate-500">
                              {log.date ? new Date(log.date).toLocaleString() : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 font-semibold">
                              {readRate.toFixed(1)}%
                            </td>
                            <td className="px-3 py-4">
                              <div className="flex gap-2">
                                <ActionButton
                                  type="button"
                                  onClick={() => {
                                    setPreviewAnnouncement(log);
                                    setShowPreviewModal(true);
                                  }}
                                  className="border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:border-violet-200 hover:text-violet-700"
                                >
                                  View
                                </ActionButton>
                                <ActionButton
                                  type="button"
                                  onClick={() => handleDeleteAnnouncement(log.id)}
                                  className="border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700 hover:bg-rose-100"
                                >
                                  Delete
                                </ActionButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredAnnouncements.length === 0 && (
                        <tr>
                          <td colSpan="6" className="px-3 py-10 text-center text-sm font-medium text-slate-500">
                            No announcements found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="min-w-0 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="border-b border-slate-200 pb-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Composer</p>
                  <h3 className="mt-1 text-xl font-black text-slate-950">Compose Broadcast</h3>
                </div>

                <form onSubmit={handlePreviewAnnouncement} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Title</label>
                    <input
                      type="text"
                      maxLength={200}
                      value={announcementForm.title}
                      onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                      placeholder="User message schedule update"
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Target</label>
                    <select
                      value={announcementForm.target}
                      onChange={(e) => setAnnouncementForm((previous) => ({
                        ...previous,
                        target: e.target.value,
                        department: e.target.value === 'department' ? previous.department : '',
                      }))}
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                    >
                      <option value="everyone">All Campus Students (Everyone)</option>
                      <option value="active_sellers">Active Sellers Only</option>
                      <option value="active_buyers">Active Buyers Only</option>
                      <option value="department">Specific Department</option>
                    </select>
                  </div>

                  {announcementForm.target === 'department' && (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Department</label>
                      <select
                        value={announcementForm.department}
                        onChange={(e) => setAnnouncementForm((previous) => ({ ...previous, department: e.target.value }))}
                        className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                      >
                        <option value="">Select a department</option>
                        {Array.from(new Set(verificationDeptsList.filter(Boolean))).map((department) => (
                          <option key={department} value={department}>{department}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Message</label>
                    <textarea
                      rows="5"
                      maxLength={500}
                      value={announcementForm.message}
                      onChange={(e) => setAnnouncementForm({ ...announcementForm, message: e.target.value })}
                      placeholder="Write your announcement for the campus community..."
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                      Attach Banner / Image (Optional)
                    </label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleAnnouncementImageChange}
                      disabled={announcementImageUploading}
                      className="mt-2 block w-full cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {announcementForm.image_preview_url && (
                      <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                        <img
                          src={announcementForm.image_preview_url}
                          alt="Broadcast image preview"
                          className="h-16 w-24 rounded-lg object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-700">
                            {announcementImageUploading ? 'Uploading image…' : 'Image attached'}
                          </p>
                          {announcementImageError && (
                            <p role="alert" className="mt-1 text-xs text-rose-600">{announcementImageError}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={removeAnnouncementImage}
                          disabled={announcementImageUploading}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-rose-700 disabled:opacity-50"
                        >
                          ✕ Remove
                        </button>
                      </div>
                    )}
                    {!announcementForm.image_preview_url && announcementImageError && (
                      <p role="alert" className="mt-2 text-xs text-rose-600">{announcementImageError}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Delivery</label>
                    <div className="mt-2 space-y-2">
                      {[
                        { value: 'in_app', label: 'In-App Notification', hint: 'Bell icon + dashboard feed', icon: '🔔' },
                        { value: 'banner', label: 'Urgent Top Banner', hint: 'Pin an announcement on UniXchange', icon: '📌' },
                        { value: 'email', label: 'Email Dispatch', hint: 'Send a branded email to student inboxes', icon: '✉️' },
                      ].map((channel) => (
                        <label key={channel.value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={announcementForm.deliveryChannels.includes(channel.value)}
                            onChange={(event) => setAnnouncementForm((previous) => ({
                              ...previous,
                              deliveryChannels: event.target.checked
                                ? [...new Set([...previous.deliveryChannels, channel.value])]
                                : previous.deliveryChannels.filter((item) => item !== channel.value),
                            }))}
                            className="mt-1"
                          />
                          <span className="text-lg" aria-hidden="true">{channel.icon}</span>
                          <span>
                            <span className="block font-semibold">{channel.label}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{channel.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pb-4 pt-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                    <button
                      type="submit"
                      className="order-1 flex w-full items-center justify-center rounded-xl bg-slate-100 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 sm:order-2 sm:w-auto sm:px-4 sm:text-sm"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendBroadcast()}
                      disabled={broadcastSending || announcementImageUploading}
                      className="order-[-1] col-span-2 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 text-sm font-bold text-white shadow-md transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 sm:order-3 sm:col-span-1 sm:w-auto sm:px-4"
                    >
                      {broadcastSending ? 'Sending…' : '🚀 Send Broadcast'}
                    </button>
                    <button
                      type="button"
                      onClick={resetAnnouncementForm}
                      disabled={announcementImageUploading}
                      className="order-2 flex w-full items-center justify-center rounded-xl bg-slate-100 py-2.5 text-xs font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600 sm:order-1 sm:w-auto sm:justify-self-start sm:px-5 sm:text-sm"
                    >
                      Clear
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {showPreviewModal && previewAnnouncement && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
                <div className="w-full max-w-lg rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-600">Preview</p>
                      <h3 className="mt-1 text-2xl font-black text-slate-950">Notification Card</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPreviewModal(false)}
                      className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-sm font-bold text-slate-600"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-5 rounded-[28px] border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-5 shadow-sm">
                    {(previewAnnouncement.image_preview_url || previewAnnouncement.image_url) && (
                      <img
                        src={previewAnnouncement.image_preview_url || previewAnnouncement.image_url}
                        alt="Broadcast image preview"
                        className="mb-4 max-h-64 w-full rounded-2xl object-cover"
                      />
                    )}
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white">
                        {previewAnnouncement.target === 'department'
                          ? `Specific Department: ${previewAnnouncement.department}`
                          : ({
                            everyone: 'All Campus Students (Everyone)',
                            active_sellers: 'Active Sellers Only',
                            active_buyers: 'Active Buyers Only',
                          })[previewAnnouncement.target] || previewAnnouncement.target}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                        Ready to publish
                      </span>
                    </div>
                    <h4 className="mt-4 text-xl font-black text-slate-950">{previewAnnouncement.title}</h4>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{previewAnnouncement.message}</p>
                    <p className="mt-4 text-xs font-semibold text-slate-500">
                      Delivery: {previewAnnouncement.delivery_type || (previewAnnouncement.deliveryChannels || previewAnnouncement.delivery_channels || [])
                        .map((channel) => ({
                          in_app: 'In-App Notification',
                          banner: 'Urgent Top Banner',
                          email: 'Email Dispatch',
                        })[channel] || channel)
                        .join(', ')}
                    </p>
                  </div>

                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      onClick={handleEditPreview}
                      className="flex-1 rounded-full border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmBroadcast}
                      disabled={broadcastSending || announcementImageUploading}
                      className="btn-primary flex-1 rounded-full px-4 py-3 text-sm font-bold"
                    >
                      {broadcastSending ? 'Sending…' : 'Confirm Send'}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        );
      }
      case 'audit-logs': {
        var filteredAuditLogs = auditLogs;
        var auditLogMetrics = {
          total: auditLogSummary?.total_events || 0,
          successfulLogins: auditLogSummary?.logins?.success || 0,
          failedLogins: auditLogSummary?.logins?.failed || 0,
          adminActions: auditLogSummary?.admin_actions || 0,
          alertsTotal: auditLogSummary?.alerts?.total || 0,
          alerts: {
            critical: auditLogSummary?.alerts?.critical || 0,
            warning: auditLogSummary?.alerts?.warning || 0,
            informational: auditLogSummary?.alerts?.informational || 0,
          },
        };
        var totalAuditPages = Math.max(1, Math.ceil(auditLogTotal / auditLogPageSize));
        var displayedAuditLogs = auditLogs;
        var selectedAuditContext = selectedLogDetails ? parseAuditDescription(selectedLogDetails.rawDescription) : null;
        var selectedAuditChanges = selectedLogDetails ? getAuditChanges(selectedLogDetails) : [];
        const handleExportAuditLogsPDF = async () => {
          try {
            const logs = await fetchAllFilteredAuditLogs();
            exportPDFFile(
              `audit-logs-${new Date().toISOString().slice(0, 10)}.pdf`,
              'Security & Action Audit Report',
              ['Event Type', 'Category', 'Severity', 'Performed By', 'Entity', 'IP Address', 'Date & Time'],
              logs.map((log) => [
                String(log.event_type || log.action || 'System'),
                String(log.category || 'SYSTEM'),
                String(log.severity || 'INFO'),
                String(log.actor_name || log.full_name || log.username || 'System'),
                `${String(log.entity_type || 'Unknown')} #${String(log.entity_id || '')}`,
                String(log.ip_address || 'Unknown'),
                String(log.created_at || ''),
              ])
            );
          } catch (error) {
            setAuditLogsError(getErrorMessage(error));
          }
        };

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-sky-600">Security console</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">Security & Action Audit Logs</h2>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold tracking-[0.12em] text-emerald-700">
                  🟢 System Secure
                </span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleExportAuditLogsCSV} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer">Export CSV</button>
                  <button type="button" onClick={handleExportAuditLogsPDF} className="rounded-full bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer">Export PDF</button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Total Events', value: auditLogMetrics.total, accent: 'bg-slate-100 text-slate-800', icon: '📊' },
                { label: 'Logins', value: auditLogMetrics.successfulLogins + auditLogMetrics.failedLogins, detail: `${auditLogMetrics.successfulLogins} successful · ${auditLogMetrics.failedLogins} failed`, accent: 'bg-sky-50 text-sky-700', icon: '🔐' },
                { label: 'Admin Actions', value: auditLogMetrics.adminActions, accent: 'bg-violet-50 text-violet-700', icon: '🛡️' },
                { label: 'Security Alerts', value: auditLogMetrics.alertsTotal, detail: `${auditLogMetrics.alerts.critical} critical · ${auditLogMetrics.alerts.warning} warning · ${auditLogMetrics.alerts.informational} informational`, accent: 'bg-rose-50 text-rose-700', icon: '🚨' }
              ].map((card) => (
                <div key={card.label} className={`rounded-[28px] border border-slate-200 p-5 shadow-sm ${card.accent}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] opacity-70">{card.label}</p>
                      <p className="mt-3 text-3xl font-black">{card.value}</p>
                      {card.detail && <p className="mt-2 text-[10px] font-bold leading-4 opacity-75">{card.detail}</p>}
                    </div>
                    <div className="text-2xl">{card.icon}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Activity stream</p>
                  <h3 className="mt-1 text-xl font-black text-slate-950">Access & Enforcement Timeline</h3>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={auditLogSearch}
                    onChange={(e) => { setAuditLogPage(1); setAuditLogSearch(e.target.value); }}
                    placeholder="Search action, actor, entity or IP..."
                    aria-label="Search audit logs"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none sm:w-auto sm:flex-1 sm:min-w-64"
                  />
                  <select
                    value={auditLogFilterSeverity}
                    onChange={(e) => { setAuditLogPage(1); setAuditLogFilterSeverity(e.target.value); }}
                    aria-label="Filter audit logs by severity"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none"
                  >
                    <option value="All">All Severities</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="WARNING">Warning</option>
                    <option value="INFO">Info</option>
                  </select>
                  <select
                    value={auditLogFilterCategory}
                    onChange={(e) => { setAuditLogPage(1); setAuditLogFilterCategory(e.target.value); }}
                    aria-label="Filter audit logs by category"
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none"
                  >
                    <option value="All">All Categories</option>
                    <option value="AUTH">Auth &amp; Logins</option>
                    <option value="ADMIN">Admin Actions</option>
                    <option value="FINANCIAL">Financial &amp; Payments</option>
                    <option value="SECURITY">Security Alerts</option>
                  </select>
                  <select
                    value={auditLogFilterStatus}
                    onChange={(e) => { setAuditLogPage(1); setAuditLogFilterStatus(e.target.value); }}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none"
                  >
                    <option value="All">Status: All</option>
                    <option value="SUCCESS">Success</option>
                    <option value="FAILED">Failed</option>
                  </select>
                  <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    From
                    <input aria-label="Audit logs start date" type="date" value={auditLogStartDate} onChange={(e) => { setAuditLogPage(1); setAuditLogStartDate(e.target.value); }} className="min-w-0 bg-transparent text-sm text-slate-800 focus:outline-none" />
                  </label>
                  <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    To
                    <input aria-label="Audit logs end date" type="date" value={auditLogEndDate} onChange={(e) => { setAuditLogPage(1); setAuditLogEndDate(e.target.value); }} className="min-w-0 bg-transparent text-sm text-slate-800 focus:outline-none" />
                  </label>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {auditLogsLoading ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-medium text-slate-500" role="status">
                    Loading audit events...
                  </div>
                ) : auditLogsError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center" role="alert">
                    <p className="text-sm font-semibold text-rose-800">{auditLogsError}</p>
                    <button
                      type="button"
                      onClick={() => setAuditLogsRetry((retry) => retry + 1)}
                      className="mt-3 rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100"
                    >
                      Retry
                    </button>
                  </div>
                ) : filteredAuditLogs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-medium text-slate-500">
                    No audit events yet.
                  </div>
                ) : (
                  displayedAuditLogs.map((log) => {
                    const isFailedAuthLogin = log.event_type === 'AUTH_LOGIN_FAILED' || log.action === 'AUTH_LOGIN_FAILED';
                    const isSuccessfulAuthLogin = ['ADMIN_LOGIN_SUCCESS', 'USER_LOGIN_SUCCESS'].includes(log.action);
                    const severityPresentation = {
                      INFO: { label: 'INFO', badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200', marker: 'bg-emerald-500 ring-4 ring-emerald-100', icon: '✓' },
                      WARNING: { label: 'WARNING', badge: 'bg-amber-100 text-amber-800 border border-amber-200', marker: 'bg-amber-100 text-amber-700', icon: '⚠' },
                      CRITICAL: { label: 'CRITICAL', badge: 'bg-rose-100 text-rose-800 border border-rose-200', marker: 'bg-rose-100 text-rose-700', icon: '!' },
                    }[log.severity] || { label: 'INFO', badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200', marker: 'bg-emerald-500 ring-4 ring-emerald-100', icon: '✓' };
                    if (isFailedAuthLogin) {
                      severityPresentation.label = 'LOGIN FAILED';
                      severityPresentation.badge = 'bg-rose-100 text-rose-800 border border-rose-200';
                      severityPresentation.marker = 'bg-rose-100 text-rose-700';
                      severityPresentation.icon = '!';
                    } else if (isSuccessfulAuthLogin) {
                      severityPresentation.label = 'LOGIN SUCCESS';
                      severityPresentation.badge = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
                      severityPresentation.marker = 'bg-emerald-500 ring-4 ring-emerald-100';
                      severityPresentation.icon = '✓';
                    }

                    return (
                      <div key={log.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="flex items-start gap-3">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${severityPresentation.marker}`}>
                              {severityPresentation.icon}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] ${severityPresentation.badge}`}>
                                  {severityPresentation.label}
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{log.category}</span>
                              </div>
                              <p className="mt-2 text-base font-black text-slate-950">{log.action}</p>
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{log.event_type}</p>
                              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                                {isFailedAuthLogin
                                  ? `Attempted: ${log.attempted_identifier || log.performed_by} · IP: ${log.ip_address}`
                                  : isSuccessfulAuthLogin
                                    ? `${log.performed_by} · ${log.actor_role}${log.actor_id !== null && log.actor_id !== undefined && String(log.actor_id).trim() ? ` · ${log.actor_id}` : ''} · IP: ${log.ip_address}`
                                    : log.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2 xl:flex-col">
                            <button
                              type="button"
                              onClick={() => setSelectedLogDetails(log)}
                              className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100"
                            >
                              View Details
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-white p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Performed By</p>
                            <p className="mt-2 text-sm font-bold text-slate-800">
                              {log.is_system_actor ? (
                                <span className="font-semibold text-gray-800">System <span className="text-xs font-normal text-gray-500">(Automated Task)</span></span>
                              ) : (
                                <span className="font-semibold text-gray-800">
                                  {log.performed_by} <span className="text-xs font-normal text-gray-500">({log.actor_role}{log.actor_id !== null && log.actor_id !== undefined && String(log.actor_id).trim() ? ` · #${log.actor_id}` : ''})</span>
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Entity</p>
                            <p className="mt-2 text-sm font-bold text-slate-800">{log.entity_type} #{log.entity_id}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Client IP</p>
                            <p className="mt-2 break-all text-sm font-bold text-slate-800">IP: {log.ip_address}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Date & Time</p>
                            <p className="mt-2 text-sm font-bold text-slate-800">{log.date_time ? new Date(log.date_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : 'Unknown'}</p>
                          </div>
                          <div className="rounded-2xl bg-white p-3 md:col-span-2 xl:col-span-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Device</p>
                            <p className="mt-2 truncate text-sm text-slate-700" title={log.user_agent}>{log.user_agent}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <nav className="flex items-center justify-between gap-3 border-t border-slate-200 pt-5" aria-label="Audit log pagination">
              <button type="button" onClick={() => setAuditLogPage((page) => Math.max(1, page - 1))} disabled={auditLogPage === 1 || auditLogsLoading} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
              <span className="text-sm font-semibold text-slate-500">Page {auditLogPage} of {totalAuditPages}</span>
              <button type="button" onClick={() => setAuditLogPage((page) => Math.min(totalAuditPages, page + 1))} disabled={auditLogPage === totalAuditPages || auditLogsLoading} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
            </nav>

            {selectedLogDetails && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
                <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-sky-600">Diagnostic</p>
                      <h3 className="mt-1 text-2xl font-black text-slate-950">Technical Log Details</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedLogDetails(null)}
                      aria-label="Close audit log details"
                      title="Close"
                      className="rounded-full border border-slate-200 bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                    >
                      <X size={18} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                    <div className="mt-5 space-y-3">
                      {[
                        ['Event ID', selectedLogDetails.id],
                        ['Event Type', selectedLogDetails.event_type],
                        ['Category', selectedLogDetails.category],
                        ['Severity', selectedLogDetails.severity],
                        ['Action', selectedLogDetails.action],
                        ['Performed By', selectedLogDetails.performed_by],
                        ['Actor ID', selectedLogDetails.actor_id],
                        ['Actor Role', selectedLogDetails.actor_role],
                        ['Entity Type', selectedLogDetails.entity_type],
                        ['Entity ID', selectedLogDetails.entity_id],
                        ['IP Address', selectedLogDetails.ip_address],
                        ['Device / User Agent', selectedLogDetails.user_agent],
                        ['Date & Time', new Date(selectedLogDetails.date_time).toLocaleString()],
                        ['Status', selectedLogDetails.status]
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{label}</span>
                          <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Full JSON Metadata</p>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-slate-800">{selectedLogDetails.rawDescription}</pre>
                    </div>

                    {selectedAuditContext && (
                      <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">Change Context</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Field Changed</p>
                            <p className="mt-1 break-words text-sm font-bold text-slate-900">{selectedAuditContext.field}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Previous Value</p>
                            <p className="mt-1 break-words text-sm font-semibold text-slate-700">{selectedAuditContext.previousValue}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">New Value</p>
                            <p className="mt-1 break-words text-sm font-semibold text-emerald-700">{selectedAuditContext.newValue}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedAuditChanges.length > 0 && (
                      <div className="mt-5 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50">
                        <div className="border-b border-amber-200 px-4 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">Detected Changes</p>
                          <p className="mt-1 text-xs text-amber-800">Review the values changed by this event.</p>
                        </div>
                        <div className="admin-data-table-wrapper w-full max-w-full overflow-x-auto">
                          <table className="admin-data-table w-full min-w-[860px] text-left text-sm">
                            <thead className="bg-amber-100/70 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-800">
                              <tr>
                                <th className="px-4 py-3">Field</th>
                                <th className="px-4 py-3">Previous</th>
                                <th className="px-4 py-3">New</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-200">
                              {selectedAuditChanges.map((change, index) => {
                                const previousValue = formatAuditValue(change.previousValue);
                                const newValue = formatAuditValue(change.newValue);
                                const isRemoved = newValue === 'empty' || newValue === 'Unknown';

                                return (
                                  <tr key={`${change.field}-${index}`} className={isRemoved ? 'bg-rose-50' : 'bg-yellow-50/60'}>
                                    <td className="px-4 py-3 align-top font-bold text-slate-900">{change.field}</td>
                                    <td className="admin-table-wrap-cell min-w-[180px] px-4 py-3 align-top font-medium text-slate-600">{previousValue}</td>
                                    <td className={`admin-table-wrap-cell min-w-[180px] px-4 py-3 align-top font-bold ${isRemoved ? 'text-rose-700' : 'text-amber-800'}`}>
                                      {change.field} changed from {previousValue} to {newValue}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex shrink-0 justify-end border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={() => setSelectedLogDetails(null)}
                      className="rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        );
      }
      case 'settings': {
        var toggleCard = (label, checked, description = '') => {
          const settingKey = SETTINGS_TOGGLE_PATHS[label];
          const isSecuritySetting = settingKey?.startsWith('securitySettings.');
          return <SettingsToggle
            label={label}
            checked={checked}
            description={description}
            disabled={settingsLoading || (isSecuritySetting && securitySettingsSaving)}
            onChange={(value) => {
              if (label === 'Auto Approve Students' && value && !window.confirm('Enable automatic approval for new student registrations?')) return;
              if (label === 'Require University Email' && value && !isValidEmailDomain(studentVerificationSettings.allowedEmailDomain)) {
                notifyError(new Error('Enter a valid Allowed Email Domain before enabling this setting.'), 'admin-settings-domain');
                return;
              }
              if (isSecuritySetting) {
                const field = settingKey.split('.').at(-1);
                saveSecuritySettings({ ...securitySettingsRef.current, [field]: value });
                return;
              }
              updateSetting(settingKey, value);
            }}
          />;
        };

        return (
          <div className="space-y-6 animate-fade-in text-slate-900">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-600">Platform controls</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">System Configuration Dashboard</h2>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">
                  Settings
                </span>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">General</h3>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Market Name</label>
                    <input value={generalSettings.marketplaceName} onChange={(e) => setGeneralSettings({ ...generalSettings, marketplaceName: e.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Description</label>
                    <textarea rows="3" value={generalSettings.description} onChange={(e) => setGeneralSettings({ ...generalSettings, description: e.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Support Email</label>
                      <input value={generalSettings.supportEmail} onChange={(e) => setGeneralSettings({ ...generalSettings, supportEmail: e.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Currency</label>
                      <select value="ETB" disabled className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <option value="ETB">ETB</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Timezone</label>
                    <select value="Africa/Addis_Ababa" disabled className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                      <option value="Africa/Addis_Ababa">Africa/Addis_Ababa</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Product</h3>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Max Image Size</label>
                      <input value={productSettings.maxImageSize} onChange={(e) => setProductSettings({ ...productSettings, maxImageSize: e.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Max Images / Product</label>
                      <input type="number" value={productSettings.maxImagesPerProduct} onChange={(e) => setProductSettings({ ...productSettings, maxImagesPerProduct: Number(e.target.value) || 0 })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                    </div>
                  </div>
                  {toggleCard('Require Approval', productSettings.requireApproval)}
                  {toggleCard('Allow Editing', productSettings.allowEditing)}
                  {toggleCard('Auto Hide Sold', productSettings.autoHideSold, 'When enabled, sold or out-of-stock products are hidden from public listings. Save system settings to apply.')}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">AI Recommendation</h3>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Recommendation Engine</label>
                    <select value={aiSettings.recommendationEngine} onChange={(e) => setAiSettings({ ...aiSettings, recommendationEngine: e.target.value })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                      <option>Content-Based Filtering (TF-IDF)</option>
                      <option>Collaborative Filtering</option>
                      <option>Hybrid Recommendation</option>
                    </select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Recommendations</label>
                      <input type="number" value={aiSettings.numRecommendations} onChange={(e) => setAiSettings({ ...aiSettings, numRecommendations: Number(e.target.value) || 0 })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Min Similarity Score</label>
                      <input type="number" step="0.01" value={aiSettings.minSimilarityScore} onChange={(e) => setAiSettings({ ...aiSettings, minSimilarityScore: Number(e.target.value) || 0 })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                    </div>
                  </div>
                  {toggleCard('Enable AI', aiSettings.enableAI)}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Payment</h3>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Provider</label>
                      <select value="Chapa" disabled className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <option>Chapa</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Currency</label>
                      <select value="ETB" disabled className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                        <option value="ETB">ETB</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Verification</label>
                    <select value="Automatic" disabled className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                      <option>Automatic</option>
                    </select>
                  </div>
                  {toggleCard('Enable Online Payment', paymentSettings.enableOnlinePayment)}
                  {toggleCard('Refunds Enabled', paymentSettings.refundsEnabled)}
                  {paymentSettings.refundsEnabled && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                      <h4 className="text-sm font-black text-slate-900">Refund Policy</h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <select value={paymentSettings.refundPolicy} onChange={(e) => setPaymentSettings({ ...paymentSettings, refundPolicy: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                          <option>Admin approval required</option>
                          <option>Automatic</option>
                        </select>
                        <select value={paymentSettings.maximumRefund} onChange={(e) => setPaymentSettings({ ...paymentSettings, maximumRefund: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                          <option>100%</option>
                          <option>75%</option>
                          <option>50%</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-black text-slate-900">Chapa Configuration</h4>
                      <span className="text-xs font-bold text-emerald-700">🟢 Connected</span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-bold text-slate-600">Public Key<input type="password" value={paymentSettings.publicKey || ''} onChange={(e) => setPaymentSettings({ ...paymentSettings, publicKey: e.target.value })} placeholder="pk_test_••••••" aria-label="Public Key" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-xs font-bold text-slate-600">Secret Key<input type="password" value={paymentSettings.secretKey || ''} onChange={(e) => setPaymentSettings({ ...paymentSettings, secretKey: e.target.value })} placeholder="•••••••••••" aria-label="Secret Key" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                    </div>
                    <button type="button" onClick={handleTestChapaConnection} disabled={chapaConnectionLoading} className="btn-primary mt-3 rounded-full px-4 py-2 text-xs font-bold">{chapaConnectionLoading ? 'Testing...' : 'Test Connection'}</button>
                    {chapaConnectionMessage && <p className="mt-2 text-xs font-semibold text-slate-600">{chapaConnectionMessage}</p>}
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                    <h4 className="text-sm font-black text-slate-900">Commission</h4>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SettingsToggle
                        label="Enable platform commission"
                        checked={Boolean(paymentSettings.commission?.commission_enabled)}
                        disabled={settingsLoading}
                        onChange={(value) => updateSetting('paymentSettings.commission.commission_enabled', value)}
                      />
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Type</label>
                        <select
                          value={paymentSettings.commission?.commission_type || 'percentage'}
                          onChange={(e) => setPaymentSettings({
                            ...paymentSettings,
                            commission: { ...paymentSettings.commission, commission_type: e.target.value },
                          })}
                          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="percentage">Percentage</option>
                          <option value="flat">Flat ETB</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Rate</label>
                        <input
                          type="number"
                          step={paymentSettings.commission?.commission_type === 'flat' ? '0.01' : '0.01'}
                          value={paymentSettings.commission?.commission_rate ?? '1.0'}
                          onChange={(e) => setPaymentSettings({
                            ...paymentSettings,
                            commission: { ...paymentSettings.commission, commission_rate: e.target.value },
                          })}
                          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Minimum</label>
                        <input
                          type="number"
                          step="0.01"
                          value={paymentSettings.commission?.commission_min_fee ?? ''}
                          onChange={(e) => setPaymentSettings({
                            ...paymentSettings,
                            commission: { ...paymentSettings.commission, commission_min_fee: e.target.value === '' ? null : e.target.value },
                          })}
                          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          placeholder="Optional"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Maximum</label>
                        <input
                          type="number"
                          step="0.01"
                          value={paymentSettings.commission?.commission_max_fee ?? ''}
                          onChange={(e) => setPaymentSettings({
                            ...paymentSettings,
                            commission: { ...paymentSettings.commission, commission_max_fee: e.target.value === '' ? null : e.target.value },
                          })}
                          className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h4 className="text-sm font-black text-slate-900">Payment Security</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {[
                        ['automaticVerification', 'Automatic payment verification (checks Chapa webhook signature)'],
                        ['duplicateTransactionProtection', 'Duplicate transaction protection (prevents repeat wallet payments)'],
                        ['adminApprovalForRefunds', 'Admin approval for refunds'],
                        ['auditLogging', 'Payment changes recorded in Audit Logs'],
                      ].map(([key, label]) => (
                        <SettingsToggle
                          key={key}
                          label={label}
                          checked={Boolean(paymentSettings.security?.[key])}
                          disabled={settingsLoading}
                          onChange={(value) => updateSetting(`paymentSettings.security.${key}`, value)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Notifications</h3>
                <div className="mt-4 space-y-3">
                  {toggleCard('Email Notifications', notificationSettings.emailNotifs)}
                  {toggleCard('Order Notifications', notificationSettings.orderNotifs)}
                  {toggleCard('Message Notifications', notificationSettings.messageNotifs)}
                  {toggleCard('Approval Notifications', notificationSettings.approvalNotifs)}
                  {toggleCard('Payment Notifications', notificationSettings.paymentNotifs)}
                  {toggleCard('Announcement Notifications', notificationSettings.announcementNotifs)}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Security</h3>
                <div className="mt-4 space-y-4">
                  {toggleCard('Require Student Verification', securitySettings.requireStudentVerification)}
                  {toggleCard(
                    'Require 2FA for all admins',
                    securitySettings.admin2FA,
                    'System login policy. This does not show whether your own authenticator is configured.'
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Max Login Attempts</label>
                      <input type="number" min="1" value={securitySettings.maxLoginAttempts} disabled={settingsLoading} onChange={(e) => scheduleSecuritySettingsSave('maxLoginAttempts', Number(e.target.value) || 0)} onBlur={flushSecuritySettingsSave} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm disabled:opacity-60" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Session Timeout (min)</label>
                      <input type="number" min="1" value={securitySettings.sessionTimeout} disabled={settingsLoading} onChange={(e) => scheduleSecuritySettingsSave('sessionTimeout', Number(e.target.value) || 0)} onBlur={flushSecuritySettingsSave} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm disabled:opacity-60" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Min Password Length</label>
                      <input type="number" min="8" value={securitySettings.minPasswordLength} disabled={settingsLoading} onChange={(e) => scheduleSecuritySettingsSave('minPasswordLength', Number(e.target.value) || 0)} onBlur={flushSecuritySettingsSave} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm disabled:opacity-60" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Audit Logging</label>
                      <div className="mt-2">
                        {toggleCard('Audit Logging', securitySettings.auditLogging)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Student Verification</h3>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Allowed Email Domain</label>
                    <input value={studentVerificationSettings.allowedEmailDomain} onChange={(e) => updateSetting('studentVerificationSettings.allowedEmailDomain', e.target.value)} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                  </div>
                  {toggleCard('Require University Email', studentVerificationSettings.requireUniversityEmail)}
                  {toggleCard('Auto Approve Students', studentVerificationSettings.autoApproveStudents)}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Moderation</h3>
                <div className="mt-4 space-y-4">
                  {toggleCard('Auto Hide Reported', moderationSettings.autoHideReported)}
                  {toggleCard('Require Admin Approval', moderationSettings.requireAdminApproval)}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Max Reports Before Review</label>
                    <input type="number" value={moderationSettings.maxReportsBeforeReview} onChange={(e) => setModerationSettings({ ...moderationSettings, maxReportsBeforeReview: Number(e.target.value) || 0 })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm" />
                  </div>
                  {toggleCard('Allow Student Reports', moderationSettings.allowStudentReports)}
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Chat</h3>
                <div className="mt-4 space-y-4">
                  {toggleCard('Enable Chat', chatSettings.enabled)}
                  {toggleCard('Allow Attachments', chatSettings.allowAttachments)}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Max Message Length</label>
                    <input type="number" min="1" value={chatSettings.maxMessageLength} onChange={(e) => setChatSettings({ ...chatSettings, maxMessageLength: Number(e.target.value) || 1 })} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
                <h3 className="text-lg font-black text-slate-950">Maintenance</h3>
                <div className="mt-4 space-y-4">
                  {toggleCard('Maintenance Mode', maintenanceSettings.maintenanceMode)}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Maintenance Message</label>
                    <textarea rows="3" value={maintenanceSettings.maintenanceMessage} onChange={(e) => setMaintenanceSettings({ ...maintenanceSettings, maintenanceMessage: e.target.value })} className="mt-2 block w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm" />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-black text-slate-950">Ready to apply?</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">These values will be persisted to the admin settings store and logged for review.</p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveSystemSettings}
                  disabled={settingsLoading || securitySettingsSaving}
                  className="btn-primary rounded-full px-6 py-3 text-sm font-bold shadow-sm"
                >
                  {settingsLoading ? 'Saving...' : securitySettingsSaving ? 'Saving security...' : 'Save System Configurations'}
                </button>
              </div>

            </div>
          </div>
        );
      }
      case 'disputes':
        return <AdminDisputeReview user={user} onCountChange={setOpenDisputeCount} />;
      default:
        return (
          <div className="space-y-4 rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm" role="alert">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600">Admin section unavailable</p>
            <h2 className="text-3xl font-black text-slate-950">Page not found</h2>
            <p className="mt-2 text-sm text-slate-600">The requested section could not be found or is no longer available.</p>
            <button
              type="button"
              onClick={() => handleTabClick('dashboard')}
              className="mt-5 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              Go to Dashboard
            </button>
          </div>
        );
    }
  };

  const toggleAdminGroup = (groupKey, collapsed) => {
    if (collapsed) {
      setIsDesktopSidebarCollapsed(false);
      setExpandedGroups((current) => current.includes(groupKey) ? current : [...current, groupKey]);
      return;
    }
    setExpandedGroups((current) => current.includes(groupKey)
      ? current.filter((key) => key !== groupKey)
      : [...current, groupKey]);
  };

  return (
    <div className="admin-dashboard-shell flex h-full min-h-0 flex-col bg-slate-50 text-slate-900">
      <div
        className="admin-dashboard-layout flex min-h-0 flex-1 flex-col lg:flex-row"
        data-admin-sidebar-layout
        data-sidebar-collapsed={isDesktopSidebarCollapsed}
      >
        <aside
          id="admin-sidebar"
          data-collapsed={isDesktopSidebarCollapsed}
          className={`admin-dashboard-sidebar fixed bottom-0 left-0 top-[72px] z-40 flex h-[calc(100dvh-72px)] w-72 shrink-0 flex-col overflow-visible rounded-none rounded-r-2xl bg-[#111c3a] p-4 text-white shadow-2xl transition-[transform,width] duration-200 lg:sticky lg:top-[72px] lg:h-[calc(100dvh-72px)] lg:shadow-none ${isDesktopSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'} ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
        >
          <div className="admin-sidebar-brand flex shrink-0 items-center justify-between gap-2 border-b border-white/10 pb-4">
            <img src={logs} alt="UniXchange Admin" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
            <span className={`min-w-0 flex-1 text-sm font-black ${isDesktopSidebarCollapsed ? 'lg:hidden' : ''}`}>Admin Console</span>
            <button
              type="button"
              onClick={() => {
                setIsDesktopSidebarCollapsed((collapsed) => !collapsed);
              }}
              className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 lg:grid"
              aria-label={isDesktopSidebarCollapsed ? 'Expand admin navigation' : 'Collapse admin navigation'}
              aria-expanded={!isDesktopSidebarCollapsed}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isDesktopSidebarCollapsed
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5l-7 7 7 7" />}
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 lg:hidden"
              aria-label="Close admin navigation"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <nav className="admin-sidebar-menu mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain pb-4 pr-1 [scrollbar-width:thin]">
            <AdminSidebarNavigation
              navigation={visibleNavigation}
              activePath={activeTab}
              counts={sidebarCounts}
              collapsed={isDesktopSidebarCollapsed}
              expandedGroups={expandedGroups}
              onNavigate={handleTabClick}
              onGroupToggle={toggleAdminGroup}
            />
          </nav>
          <div className="relative mt-auto shrink-0 border-t border-white/10 p-3">
            <AdminProfileMenu
              key={activeTab}
              user={{
                ...user,
                username: adminProfile.username || user?.username,
                full_name: adminProfile.fullName || user?.full_name,
                email: adminProfile.email || user?.email,
                avatarUrl: user?.avatarUrl || user?.avatar_url || adminProfile.avatarUrl,
              }}
              onLogout={onLogout}
              onNavigate={() => handleTabClick('profile')}
              onSettings={() => handleTabClick('settings')}
              collapsed={isDesktopSidebarCollapsed}
            />
          </div>
        </aside>
        {isSidebarOpen && <button type="button" aria-label="Close admin navigation" onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}

        <main className="admin-dashboard-content min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 lg:p-6">
          <section className="min-w-0 overflow-hidden">
            <AdminDashboardErrorBoundary>
              {isReady ? renderTabContent() : (
                <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
                  Loading admin tools...
                </div>
              )}
            </AdminDashboardErrorBoundary>
          </section>
        </main>
      </div>

      {showProfileModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[32px] border border-slate-700/60 bg-[#0f172a] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/80 px-6 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-sky-300">Admin Profile</p>
                <h3 className="mt-2 text-2xl font-black text-white">Single Administrator Console</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="rounded-full border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_1.1fr]">
              <div className="space-y-6 rounded-[28px] border border-slate-700 bg-slate-900/80 p-5 shadow-inner">
                <div className="flex items-center gap-4 border-b border-slate-700 pb-5">
                  <img
                    src={resolveImageUrl(adminProfile.avatarUrl || ADMIN_AVATAR_PLACEHOLDER)}
                    alt="Admin avatar"
                    onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                    className="h-20 w-20 rounded-full border-4 border-sky-400 object-cover shadow-lg shadow-sky-500/20"
                  />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Overview</p>
                    <h4 className="mt-2 text-2xl font-black text-white">{profileForm.username || adminProfile.username}</h4>
                    <p className="mt-1 text-sm text-slate-300">{profileForm.email || adminProfile.email}</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Role</p>
                    <p className="mt-2 text-base font-bold text-white">{adminProfile.role}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status</p>
                    <p className="mt-2 inline-flex rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                      {adminProfile.status}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Last Login</p>
                    <p className="mt-2 text-sm font-semibold text-slate-100">{new Date(adminProfile.last_login || new Date().toISOString()).toLocaleString()}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Total Actions</p>
                    <p className="mt-2 text-2xl font-black text-white">{adminProfile.total_actions || auditLogs.length || 0}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Two-Factor Authentication</p>
                    <button
                      type="button"
                      onClick={() => handleProfileFieldChange('twoFactorEnabled', !profileForm.twoFactorEnabled)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${profileForm.twoFactorEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                    >
                      <span className={`inline-block h-5 w-5 rounded-full bg-white transition ${profileForm.twoFactorEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <p className="text-sm text-slate-300">Security status: {profileForm.twoFactorEnabled ? 'Enabled' : 'Disabled'} • Session IP: {adminProfile.sessionIp || 'Unavailable'}</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-700 bg-slate-900/80 p-5 shadow-inner">
                <div className="mb-5 flex items-center justify-between border-b border-slate-700 pb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Profile Settings</p>
                    <h4 className="mt-2 text-xl font-black text-white">Update Access Details</h4>
                  </div>
                </div>

                <form onSubmit={handleProfileSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Username</label>
                    <input
                      type="text"
                      value={profileForm.username}
                      onChange={(e) => handleProfileFieldChange('username', e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Email</label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => handleProfileFieldChange('email', e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Current Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={profileForm.currentPassword}
                        onChange={(e) => handleProfileFieldChange('currentPassword', e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">New Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={profileForm.newPassword}
                        onChange={(e) => handleProfileFieldChange('newPassword', e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Confirm Password</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={profileForm.confirmPassword}
                        onChange={(e) => handleProfileFieldChange('confirmPassword', e.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Avatar Upload</p>
                        <p className="mt-2 text-sm text-slate-300">Upload a new profile photo from your device.</p>
                      </div>
                      <label className="cursor-pointer rounded-full bg-sky-500 px-4 py-2 text-xs font-bold text-white hover:bg-sky-400">
                        Browse
                        <input type="file" accept="image/*" className="hidden" onChange={handleProfileAvatarUpload} />
                      </label>
                    </div>
                  </div>

                  {profileMsg && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300">
                      {profileMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={profileLoading}
                    className="btn-primary w-full rounded-full px-5 py-3 text-sm font-bold transition"
                  >
                    {profileLoading ? 'Saving profile...' : 'Save Profile'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )
      }
    </div >
  );
}

export default AdminDashboard;
