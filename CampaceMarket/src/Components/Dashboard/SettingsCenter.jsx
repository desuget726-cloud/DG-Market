import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { BadgeCheck, Bell, Camera, Check, ChevronDown, CreditCard, Eye, EyeOff, KeyRound, Laptop, LoaderCircle, LockKeyhole, LogOut, Mail, MessageSquare, Package, ShieldCheck, Smartphone, Tablet, Upload, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { notifyError, notifySuccess } from '../../utils/notify';
import { formatSessionTimestamp } from '../../utils/sessionTimestamp';
import PayoutAccountPanel from './PayoutAccountPanel';
import { API_BASE_URL, IMAGE_PLACEHOLDER, resolveImageUrl } from '../../config';

const settingsSections = [
    ['account', 'Account'],
    ['payout', 'Payouts'],
    ['security', 'Security'],
    ['notifications', 'Notifications'],
];

const DEFAULT_NOTIFICATION_PREFERENCES = {
    messagesInApp: true,
    messagesEmail: true,
    ordersInApp: true,
    ordersEmail: true,
    paymentsInApp: true,
    paymentsEmail: true,
};

const notificationPreferencesFromApi = (preferences) => ({
    messagesInApp: Boolean(preferences?.new_messages?.in_app ?? DEFAULT_NOTIFICATION_PREFERENCES.messagesInApp),
    messagesEmail: Boolean(preferences?.new_messages?.email ?? DEFAULT_NOTIFICATION_PREFERENCES.messagesEmail),
    ordersInApp: Boolean(preferences?.order_updates?.in_app ?? DEFAULT_NOTIFICATION_PREFERENCES.ordersInApp),
    ordersEmail: Boolean(preferences?.order_updates?.email ?? DEFAULT_NOTIFICATION_PREFERENCES.ordersEmail),
    paymentsInApp: true,
    paymentsEmail: Boolean(preferences?.payment_success?.email ?? DEFAULT_NOTIFICATION_PREFERENCES.paymentsEmail),
});

function NotificationChannelToggle({ label, ariaLabel, checked, onChange, disabled = false, title }) {
    return (
        <button
            type="button"
            role="switch"
            aria-label={ariaLabel}
            aria-checked={checked}
            disabled={disabled}
            title={title}
            onClick={onChange}
            onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    onChange();
                }
            }}
            className="group inline-flex min-h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-80 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
        >
            <span className="hidden items-center gap-1.5 whitespace-nowrap sm:inline-flex">{label}</span>
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-emerald-500' : 'bg-slate-300 group-hover:bg-slate-400 dark:bg-slate-600'}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </span>
            {disabled && <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
        </button>
    );
}

const inputClass = 'mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-100 dark:focus:bg-slate-900';

const Field = ({ label, badge, children }) => (
    <label className="block">
        <span className="flex min-h-4 items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            <span>{label}</span>
            {badge}
        </span>
        {children}
    </label>
);

function PasswordInput({ value, onChange, visible, onToggle, autoComplete, placeholder }) {
    const VisibilityIcon = visible ? EyeOff : Eye;
    return (
        <span className="relative mt-2 block">
            <input
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className={`${inputClass} mt-0 pr-12`}
                autoComplete={autoComplete}
                placeholder={placeholder}
            />
            <button
                type="button"
                onClick={onToggle}
                className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:text-slate-400 dark:hover:text-white"
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
            >
                <VisibilityIcon size={17} aria-hidden="true" />
            </button>
        </span>
    );
}

function SettingsCenter({
    settingsTab,
    onNotificationPrefsDirtyChange,
    setSettingsTab,
    profileForm,
    handleProfileFieldChange,
    handleProfileReset,
    handleProfileSubmit,
    profileMessage,
    profileSaving,
    profileLastUpdated,
    user,
    avatarUrl,
    avatarFile,
    setAvatarFile,
    handleAvatarUploadSubmit,
    handleAvatarRemoveSubmit,
    avatarRemoving,
    avatarUploadMessage,
    avatarUploading,
    universityStructure,
    setSellerData,
    onPayoutAccountUpdated,
}) {
    const { t } = useLanguage();
    const studentToast = (key) => t(`studentToast.${key}`);
    const safeUniversityStructure = universityStructure || {};
    const avatarInputRef = useRef(null);
    const [avatarFileError, setAvatarFileError] = useState('');
    const verifiedStudent = [true, 1, '1', 'true'].includes(user?.is_verified);
    const studentIdLocked = Boolean(user?.student_id_locked || user?.studentIdLocked);
    useEffect(() => {
        if (!avatarFile && avatarInputRef.current) avatarInputRef.current.value = '';
    }, [avatarFile]);
    const handleAvatarFileSelection = (file) => {
        setAvatarFileError('');
        if (!file) {
            setAvatarFile(null);
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setAvatarFileError('Choose a JPG, PNG, or WebP image.');
            setAvatarFile(null);
            if (avatarInputRef.current) avatarInputRef.current.value = '';
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            setAvatarFileError('The selected photo must be 2MB or smaller.');
            setAvatarFile(null);
            if (avatarInputRef.current) avatarInputRef.current.value = '';
            return;
        }
        setAvatarFile(file);
    };
    const [notificationPrefs, setNotificationPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
    const [savedNotificationPrefs, setSavedNotificationPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
    const notificationPrefsDirty = Object.keys(notificationPrefs).some((key) => notificationPrefs[key] !== savedNotificationPrefs[key]);
    const [notificationPrefsLoadState, setNotificationPrefsLoadState] = useState('idle');
    const [notificationPrefsLoadError, setNotificationPrefsLoadError] = useState('');
    const [notificationPrefsRetryKey, setNotificationPrefsRetryKey] = useState(0);
    const [twoFactor, setTwoFactor] = useState(Boolean(user?.two_factor_enabled));
    const [isSavingNotificationPrefs, setIsSavingNotificationPrefs] = useState(false);
    const [securityForm, setSecurityForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    });
    const [securityMessage, setSecurityMessage] = useState('');
    const [securityError, setSecurityError] = useState('');
    const [securitySaving, setSecuritySaving] = useState(false);
    const [hasLocalPassword, setHasLocalPassword] = useState(user?.has_password !== false);
    const [visiblePasswords, setVisiblePasswords] = useState({});
    const [twoFactorSaving, setTwoFactorSaving] = useState(false);
    const [showConfirmPasswordModal, setShowConfirmPasswordModal] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [confirmPasswordError, setConfirmPasswordError] = useState('');
    const [activeSessions, setActiveSessions] = useState([]);
    const [activeSessionsLoadState, setActiveSessionsLoadState] = useState('idle');
    const [activeSessionsError, setActiveSessionsError] = useState('');
    const [sessionActionId, setSessionActionId] = useState('');
    const [isRevokingOtherSessions, setIsRevokingOtherSessions] = useState(false);
    const [sessionInfo, setSessionInfo] = useState({
        ip_address: 'Unavailable',
        user_agent: 'Unavailable',
        browser: 'Unavailable',
        operating_system: 'Unavailable',
    });
    const updatePref = (key) => setNotificationPrefs((previous) => ({ ...previous, [key]: !previous[key] }));

    const handleSettingsTabChange = (nextTab) => {
        if (settingsTab === 'notifications' && notificationPrefsDirty && nextTab !== 'notifications') {
            if (!window.confirm(t('studentToast.discardUnsavedPreferences'))) return;
        }
        setSettingsTab(nextTab);
    };

    const getStudentSessionToken = useCallback(() => {
        try {
            const savedSession = JSON.parse(window.localStorage.getItem('campaceSession') || '{}');
            const storedToken = savedSession?.user?.access_token || savedSession?.access_token || '';
            return storedToken || user?.access_token || '';
        } catch {
            return user?.access_token || '';
        }
    }, [user?.access_token]);

    const loadActiveSessions = useCallback(async ({ showLoading = true, notifyFailure = true } = {}) => {
        if (showLoading) setActiveSessionsLoadState('loading');
        setActiveSessionsError('');
        try {
            const token = getStudentSessionToken();
            if (!token) throw new Error('Your authenticated student session is required.');
            const response = await fetch(`${API_BASE_URL}/api/student/sessions`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data?.detail || 'Unable to load active sessions.');
                error.status = response.status;
                throw error;
            }
            setActiveSessions(Array.isArray(data) ? data : []);
            setActiveSessionsLoadState('ready');
            return true;
        } catch (error) {
            setActiveSessionsLoadState('error');
            setActiveSessionsError(error.message || 'Unable to load active sessions.');
            if (notifyFailure && error.status !== 401) {
                toast.error(error.message || 'Unable to load active sessions.');
            }
            return false;
        }
    }, [getStudentSessionToken]);

    const revokeSession = async (session) => {
        if (!window.confirm(`Log out ${session.device_name || 'this device'}?`)) return;
        setSessionActionId(session.id);
        try {
            const token = getStudentSessionToken();
            if (!token) throw new Error('Your authenticated student session is required.');
            const response = await fetch(`${API_BASE_URL}/api/student/sessions/${encodeURIComponent(session.id)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data?.detail || 'Unable to log out this session.');
                error.status = response.status;
                throw error;
            }
            if (!(await loadActiveSessions({ showLoading: false, notifyFailure: false }))) {
                throw new Error('Session was logged out, but the active-session list could not be refreshed.');
            }
            toast.success('Session logged out.');
        } catch (error) {
            if (error.status !== 401) toast.error(error.message || 'Unable to log out this session.');
        } finally {
            setSessionActionId('');
        }
    };

    const revokeOtherSessions = async () => {
        if (!window.confirm('This will sign you out on all other devices.')) return;
        setIsRevokingOtherSessions(true);
        try {
            const token = getStudentSessionToken();
            if (!token) throw new Error('Your authenticated student session is required.');
            const response = await fetch(`${API_BASE_URL}/api/student/sessions/revoke-others`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data?.detail || 'Unable to log out other sessions.');
                error.status = response.status;
                throw error;
            }
            if (!(await loadActiveSessions({ showLoading: false, notifyFailure: false }))) {
                throw new Error('Other sessions were logged out, but the active-session list could not be refreshed.');
            }
            toast.success('Other sessions logged out.');
        } catch (error) {
            if (error.status !== 401) toast.error(error.message || 'Unable to log out other sessions.');
        } finally {
            setIsRevokingOtherSessions(false);
        }
    };

    useEffect(() => {
        if (settingsTab !== 'notifications') return undefined;
        let active = true;
        const controller = new AbortController();
        const loadNotificationPreferences = async () => {
            setNotificationPrefsLoadState('loading');
            setNotificationPrefsLoadError('');
            try {
                const token = getStudentSessionToken();
                if (!token) throw new Error('Your authenticated student session is required.');
                const response = await fetch(`${API_BASE_URL}/api/notification-preferences`, {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: controller.signal,
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data?.detail || 'Unable to load notification preferences.');

                const savedPreferences = notificationPreferencesFromApi(data?.preferences);
                if (active) {
                    setNotificationPrefs(savedPreferences);
                    setSavedNotificationPrefs(savedPreferences);
                    setNotificationPrefsLoadState('ready');
                }
            } catch (error) {
                if (!active || error.name === 'AbortError') return;
                setNotificationPrefsLoadError(error.message || 'Unable to load notification preferences.');
                setNotificationPrefsLoadState('error');
            }
        };

        loadNotificationPreferences();
        return () => {
            active = false;
            controller.abort();
        };
    }, [settingsTab, notificationPrefsRetryKey, user, getStudentSessionToken]);

    useEffect(() => {
        if (!notificationPrefsDirty) return undefined;
        const warnBeforeLeaving = (event) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warnBeforeLeaving);
        return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
    }, [notificationPrefsDirty]);

    useEffect(() => {
        onNotificationPrefsDirtyChange?.(notificationPrefsDirty);
    }, [notificationPrefsDirty, onNotificationPrefsDirtyChange]);

    useEffect(() => () => onNotificationPrefsDirtyChange?.(false), [onNotificationPrefsDirtyChange]);

    const getBrowserAndOS = (userAgent = '') => {
        const value = userAgent || '';
        const browser = value.includes('Edg') ? 'Edge'
            : value.includes('Chrome') && !value.includes('Edg') ? 'Chrome'
                : value.includes('Firefox') ? 'Firefox'
                    : value.includes('Safari') ? 'Safari'
                        : value.includes('Opera') || value.includes('OPR') ? 'Opera'
                            : 'Browser';

        const os = value.includes('Windows') ? 'Windows'
            : value.includes('Mac OS') ? 'macOS'
                : value.includes('Android') ? 'Android'
                    : value.includes('iPhone') || value.includes('iPad') ? 'iOS'
                        : value.includes('Linux') ? 'Linux'
                            : 'Unknown OS';

        return { browser, os };
    };

    const loadSessionInfo = useCallback(async () => {
        const token = getStudentSessionToken();
        if (!token) {
            setSessionInfo({
                ip_address: 'Unavailable',
                user_agent: 'Unavailable',
                browser: 'Unavailable',
                operating_system: 'Unavailable',
            });
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/student/session-info`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                throw new Error('Unable to load session info.');
            }

            const data = await response.json();
            const browserMetadata = getBrowserAndOS(data.user_agent || data.browser || '');
            setSessionInfo({
                ip_address: data.ip_address || data.client_ip || 'Unavailable',
                user_agent: data.user_agent || data.browser || 'Unavailable',
                browser: browserMetadata.browser,
                operating_system: browserMetadata.os,
            });
        } catch (error) {
            console.error('Session info load failed:', error);
            setSessionInfo({
                ip_address: 'Unavailable',
                user_agent: 'Unavailable',
                browser: 'Unavailable',
                operating_system: 'Unavailable',
            });
        }
    }, [getStudentSessionToken]);

    const handleSaveNotificationPreferences = async () => {
        if (!notificationPrefsDirty || isSavingNotificationPrefs) return;
        setIsSavingNotificationPrefs(true);

        try {
            const payload = {
                new_messages: { in_app: notificationPrefs.messagesInApp, email: notificationPrefs.messagesEmail },
                order_updates: { in_app: notificationPrefs.ordersInApp, email: notificationPrefs.ordersEmail },
                payment_success: { in_app: true, email: notificationPrefs.paymentsEmail },
            };

            const token = getStudentSessionToken();
            const response = await fetch(`${API_BASE_URL}/api/notification-preferences`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data?.detail || data?.message || 'Unable to save notification preferences.');
            }

            const savedPreferences = notificationPreferencesFromApi(data?.preferences);
            setNotificationPrefs(savedPreferences);
            setSavedNotificationPrefs(savedPreferences);
            notifySuccess(studentToast('preferencesSaved'), 'student-notification-preferences');
        } catch (error) {
            console.error('Notification preferences update failed:', error);
            toast.custom((toastItem) => (
                <div role="alert" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700 shadow-lg">
                    <span className="min-w-0 flex-1">{error.message || studentToast('preferencesSaveFailed')}</span>
                    <button
                        type="button"
                        onClick={() => {
                            toast.dismiss(toastItem.id);
                            handleSaveNotificationPreferences();
                        }}
                        className="shrink-0 font-bold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                        {t('home.tryAgain')}
                    </button>
                </div>
            ), { id: 'student-notification-preferences-error', duration: 8000 });
        } finally {
            setIsSavingNotificationPrefs(false);
        }
    };

    const renderPanel = () => {
        if (settingsTab === 'account') {
            return (
                <div className="mt-2">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Student profile</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage the personal and academic details associated with your account.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[240px_minmax(0,1fr)]">
                        <aside className="h-fit rounded-2xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-700 dark:bg-slate-900/50">
                            <div className="flex flex-col items-center text-center">
                                <div className="group relative">
                                    <img
                                        src={resolveImageUrl(avatarUrl || (user?.studentId ? `/static/uploads/avatars/${user.studentId}.jpg` : IMAGE_PLACEHOLDER))}
                                        onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                                        alt="Profile avatar"
                                        className="h-24 w-24 rounded-full border-2 border-white object-cover shadow-sm ring-2 ring-emerald-400 dark:border-slate-800"
                                    />
                                    {verifiedStudent && <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white shadow-sm dark:border-slate-900" title="Verified student"><BadgeCheck size={16} aria-hidden="true" /></span>}
                                    <button
                                        type="button"
                                        onClick={() => avatarInputRef.current?.click()}
                                        className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-slate-950/65 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                                        aria-label="Change profile photo"
                                    >
                                        <Camera size={18} aria-hidden="true" />
                                        Change Photo
                                    </button>
                                </div>
                                <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">Profile photo</p>
                                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Recommended: JPG, PNG or WebP. Max size 2MB.</p>
                                <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={(event) => handleAvatarFileSelection(event.target.files?.[0] || null)}
                                    className="sr-only"
                                    aria-label="Choose a new profile photo"
                                />
                                <div className="mt-4 grid w-full grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => avatarInputRef.current?.click()}
                                        className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-2.5 py-2.5 text-xs font-semibold text-white transition hover:bg-sky-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                                    >
                                        <Upload size={14} className="shrink-0" aria-hidden="true" />
                                        <span className="truncate">Upload New Photo</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (window.confirm('Remove your current profile photo?')) {
                                                handleAvatarFileSelection(null);
                                                handleAvatarRemoveSubmit();
                                            }
                                        }}
                                        disabled={avatarRemoving}
                                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-rose-950/30"
                                    >
                                        {avatarRemoving ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                                        Remove
                                    </button>
                                </div>
                                {avatarFile && (
                                    <div className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-left dark:border-slate-700 dark:bg-slate-800">
                                        <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{avatarFile.name}</p>
                                        <button
                                            type="button"
                                            onClick={handleAvatarUploadSubmit}
                                            disabled={avatarUploading}
                                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 disabled:opacity-60 dark:text-sky-400"
                                        >
                                            {avatarUploading && <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />}
                                            {avatarUploading ? 'Uploading photo…' : 'Save photo'}
                                        </button>
                                    </div>
                                )}
                                {(avatarFileError || avatarUploadMessage) && (
                                    <p role={avatarFileError ? 'alert' : 'status'} className={`mt-3 text-left text-xs ${avatarFileError || /failed|error/i.test(avatarUploadMessage) ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                        {avatarFileError || avatarUploadMessage}
                                    </p>
                                )}
                            </div>
                        </aside>

                        <form onSubmit={handleProfileSubmit} className="min-w-0">
                            <div className="space-y-7">
                                <section aria-labelledby="personal-info-heading">
                                    <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
                                        <h4 id="personal-info-heading" className="text-sm font-bold text-slate-900 dark:text-white">Personal information</h4>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">How you appear to other students on campus.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                                        <Field label="Full Name">
                                            <input value={profileForm.name} onChange={(event) => handleProfileFieldChange('name', event.target.value)} className={inputClass} autoComplete="name" />
                                        </Field>
                                        <Field
                                            label="Student ID"
                                            badge={verifiedStudent && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold tracking-normal text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><Check size={11} aria-hidden="true" />Verified ID</span>}
                                        >
                                            <input value={profileForm.studentId} onChange={(event) => handleProfileFieldChange('studentId', event.target.value)} readOnly={studentIdLocked} maxLength={50} className={`${inputClass} ${studentIdLocked ? 'cursor-not-allowed bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' : ''}`} autoComplete="off" />
                                        </Field>
                                    </div>
                                </section>

                                <section aria-labelledby="academic-info-heading">
                                    <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
                                        <h4 id="academic-info-heading" className="text-sm font-bold text-slate-900 dark:text-white">Academic information</h4>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Keep your current college and department up to date.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                                        <Field label="College">
                                            <span className="relative block">
                                                <select value={profileForm.college} onChange={(event) => handleProfileFieldChange('college', event.target.value)} className={`${inputClass} appearance-none pr-10`}>
                                                    <option value="">Select college</option>
                                                    {Object.keys(safeUniversityStructure).map((college) => <option key={college} value={college}>{college}</option>)}
                                                </select>
                                                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                                            </span>
                                        </Field>
                                        <Field label="Department">
                                            <span className="relative block">
                                                <select value={profileForm.department} onChange={(event) => handleProfileFieldChange('department', event.target.value)} disabled={!profileForm.college} className={`${inputClass} appearance-none pr-10 disabled:cursor-not-allowed disabled:opacity-60`}>
                                                    <option value="">Select department</option>
                                                    {profileForm.college && safeUniversityStructure[profileForm.college]?.map((department) => <option key={department} value={department}>{department}</option>)}
                                                </select>
                                                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                                            </span>
                                        </Field>
                                    </div>
                                </section>

                                <section aria-labelledby="contact-info-heading">
                                    <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
                                        <h4 id="contact-info-heading" className="text-sm font-bold text-slate-900 dark:text-white">Contact details</h4>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Your campus email is managed by your account.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                                        <Field
                                            label="Campus Email"
                                            badge={<span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold tracking-normal text-sky-700 dark:bg-sky-400/10 dark:text-sky-300"><BadgeCheck size={11} aria-hidden="true" />{verifiedStudent ? 'Verified' : 'Campus account'}</span>}
                                        >
                                            <input type="email" value={profileForm.email} disabled className={`${inputClass} cursor-not-allowed bg-slate-100/80 text-slate-500 dark:bg-slate-800/70 dark:text-slate-400`} autoComplete="email" />
                                        </Field>
                                        <Field label="Phone Number">
                                            <span className="mt-2 flex min-w-0 items-center rounded-xl border border-slate-200 bg-slate-50/50 transition focus-within:border-sky-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-800/40 dark:focus-within:bg-slate-900">
                                                <span className="ml-3 flex shrink-0 items-center gap-1.5 border-r border-slate-200 pr-3 text-sm dark:border-slate-700" aria-label="Ethiopia">
                                                    <span aria-hidden="true">🇪🇹</span><span className="text-xs font-medium text-slate-500 dark:text-slate-400">+251</span>
                                                </span>
                                                <input type="tel" value={profileForm.phone} onChange={(event) => handleProfileFieldChange('phone', event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-slate-900 outline-none dark:text-slate-100" autoComplete="tel" />
                                            </span>
                                        </Field>
                                    </div>
                                </section>
                            </div>

                            {profileMessage && <p role="status" className={`mt-5 rounded-xl px-3 py-2 text-sm font-medium ${profileMessage.includes('successfully') ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300'}`}>{profileMessage}</p>}
                            <footer className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-8 flex flex-col gap-3 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:-mb-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 dark:border-slate-700 dark:bg-slate-950/95">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Last updated: {profileLastUpdated && !Number.isNaN(new Date(profileLastUpdated).getTime()) ? new Date(profileLastUpdated).toLocaleString() : 'Not updated yet'}
                                </p>
                                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                                    <button type="button" onClick={handleProfileReset} disabled={profileSaving} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
                                        Cancel / Reset
                                    </button>
                                    <button type="submit" disabled={profileSaving} className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:scale-[1.01] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
                                        {profileSaving && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                                        {profileSaving ? 'Saving changes…' : 'Save Changes'}
                                    </button>
                                </div>
                            </footer>
                        </form>
                    </div>
                </div>
            );
        }
        if (settingsTab === 'security') {
            const handlePasswordSubmit = async (event) => {
                event.preventDefault();
                setSecurityMessage('');
                setSecurityError('');

                if (!securityForm.newPassword || !securityForm.confirmPassword) {
                    setSecurityError('Enter and confirm your new password.');
                    return;
                }

                if (hasLocalPassword && !securityForm.currentPassword) {
                    setSecurityError('Enter your current password.');
                    return;
                }

                if (securityForm.newPassword.length < 8) {
                    setSecurityError('New password must be at least 8 characters long.');
                    return;
                }

                if (securityForm.newPassword !== securityForm.confirmPassword) {
                    setSecurityError('New password and confirmation do not match.');
                    return;
                }

                const token = getStudentSessionToken();
                setSecuritySaving(true);

                try {
                    const response = await fetch(`${API_BASE_URL}/api/student/profile/password`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        body: JSON.stringify({
                            current_password: hasLocalPassword ? securityForm.currentPassword : null,
                            new_password: securityForm.newPassword,
                            confirm_password: securityForm.confirmPassword,
                        }),
                    });

                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(data?.detail || 'Failed to update password.');
                    }

                    setSecurityForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    setHasLocalPassword(true);
                    setSecurityMessage(data?.message || 'Password updated successfully.');
                    notifySuccess(data?.message || 'Password updated successfully.', 'student-password-update');
                } catch (error) {
                    setSecurityError(error.message || 'Password update failed.');
                    notifyError(error, 'student-password-update');
                } finally {
                    setSecuritySaving(false);
                }
            };

            const handle2FAToggle = async () => {
                if (twoFactorSaving) return;
                if (twoFactor) {
                    setTwoFactorSaving(true);
                    const token = getStudentSessionToken();
                    try {
                        const response = await fetch(`${API_BASE_URL}/api/student/profile/2fa`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                            },
                            body: JSON.stringify({ enabled: false }),
                        });

                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) {
                            throw new Error(data?.detail || 'Unable to disable 2FA.');
                        }

                        setTwoFactor(false);
                        notifySuccess('Two-factor authentication disabled.', 'student-2fa-update');
                    } catch (error) {
                        console.error('Disable 2FA failed:', error);
                        setSecurityError(error.message || 'Unable to disable 2FA.');
                        notifyError(error, 'student-2fa-update');
                    } finally {
                        setTwoFactorSaving(false);
                    }
                    return;
                }

                setShowConfirmPasswordModal(true);
                setConfirmPassword('');
                setConfirmPasswordError('');
            };

            const confirmPasswordAndEnable2FA = async (event) => {
                event.preventDefault();
                setConfirmPasswordError('');

                if (!confirmPassword.trim()) {
                    setConfirmPasswordError('Please enter your current password to continue.');
                    return;
                }

                const token = getStudentSessionToken();

                try {
                    const verificationResponse = await fetch(`${API_BASE_URL}/api/login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id_or_email: user?.studentId || user?.student_id || '',
                            password: confirmPassword,
                        }),
                    });

                    const verificationData = await verificationResponse.json().catch(() => ({}));
                    if (!verificationResponse.ok) {
                        throw new Error(verificationData?.detail || 'Password confirmation failed.');
                    }

                    const twoFactorResponse = await fetch(`${API_BASE_URL}/api/student/profile/2fa`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        body: JSON.stringify({ enabled: true }),
                    });

                    const twoFactorData = await twoFactorResponse.json().catch(() => ({}));
                    if (!twoFactorResponse.ok) {
                        throw new Error(twoFactorData?.detail || 'Unable to enable 2FA.');
                    }

                    setTwoFactor(true);
                    setShowConfirmPasswordModal(false);
                    setConfirmPassword('');
                    setSecurityMessage('Two-factor authentication enabled.');
                    notifySuccess('Two-factor authentication enabled.', 'student-2fa-update');
                } catch (error) {
                    setConfirmPasswordError(error.message || 'Password verification failed.');
                    notifyError(error, 'student-2fa-update');
                }
            };

            return (
                <>
                    <PanelHeader eyebrow="Security" title="Protect your account" text="Review password access, two-factor protection, and all devices signed in to your account." />
                    <div className="mt-6 grid gap-6 xl:grid-cols-2">
                        <form onSubmit={handlePasswordSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex items-start gap-3">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300"><KeyRound size={19} aria-hidden="true" /></span>
                                <div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Password</h3>
                                    <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Use a unique password to keep your account secure.</p>
                                </div>
                            </div>
                            {!hasLocalPassword && (
                                <div role="status" className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-5 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                                    Signed in with Google. You can set an optional app password for direct login.
                                </div>
                            )}
                            <div className="mt-4 space-y-4">
                                {hasLocalPassword && (
                                    <Field label="Current Password">
                                        <PasswordInput
                                            value={securityForm.currentPassword}
                                            onChange={(value) => setSecurityForm((previous) => ({ ...previous, currentPassword: value }))}
                                            visible={visiblePasswords.current}
                                            onToggle={() => setVisiblePasswords((previous) => ({ ...previous, current: !previous.current }))}
                                            autoComplete="current-password"
                                            placeholder="Enter current password"
                                        />
                                    </Field>
                                )}
                                <Field label="New Password">
                                    <PasswordInput
                                        value={securityForm.newPassword}
                                        onChange={(value) => setSecurityForm((previous) => ({ ...previous, newPassword: value }))}
                                        visible={visiblePasswords.new}
                                        onToggle={() => setVisiblePasswords((previous) => ({ ...previous, new: !previous.new }))}
                                        autoComplete="new-password"
                                        placeholder="Create a new password"
                                    />
                                </Field>
                                <Field label="Confirm Password">
                                    <PasswordInput
                                        value={securityForm.confirmPassword}
                                        onChange={(value) => setSecurityForm((previous) => ({ ...previous, confirmPassword: value }))}
                                        visible={visiblePasswords.confirm}
                                        onToggle={() => setVisiblePasswords((previous) => ({ ...previous, confirm: !previous.confirm }))}
                                        autoComplete="new-password"
                                        placeholder="Re-enter your new password"
                                    />
                                </Field>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">Use at least 8 characters. A longer, unique passphrase is even better.</p>
                            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                <button type="submit" disabled={securitySaving} className="btn-primary rounded-xl px-5 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">
                                    {securitySaving ? 'Updating…' : hasLocalPassword ? 'Update Password' : 'Set App Password'}
                                </button>
                                {securityMessage && <p role="status" className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{securityMessage}</p>}
                            </div>
                            {securityError && <p role="alert" className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-400">{securityError}</p>}
                        </form>

                        <div className="space-y-6">
                            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <div className="flex items-start gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><ShieldCheck size={20} aria-hidden="true" /></span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Two-Factor Authentication</h3>
                                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${twoFactor ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                                                {twoFactor ? 'Enabled' : 'Off'}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Add an extra layer of protection to your student account.</p>
                                    </div>
                                </div>
                                <div className="mt-4 flex items-center justify-between gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{twoFactor ? 'Your account has extra protection.' : 'Require password verification to enable.'}</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={twoFactor}
                                        aria-label="Two-Factor Authentication"
                                        onClick={handle2FAToggle}
                                        disabled={twoFactorSaving || (!hasLocalPassword && !twoFactor)}
                                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${twoFactor ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${twoFactor ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </section>

                            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Active Sessions</h3>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Devices currently signed in to your account.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => loadActiveSessions()}
                                        disabled={activeSessionsLoadState === 'loading'}
                                        className="rounded-lg px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                                    >
                                        Refresh
                                    </button>
                                </div>
                                {activeSessionsLoadState === 'loading' && (
                                    <div className="mt-4 space-y-3" aria-label="Loading active sessions" aria-busy="true">
                                        {[0, 1].map((row) => <div key={row} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
                                    </div>
                                )}
                                {activeSessionsLoadState === 'error' && (
                                    <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                                        <p>{activeSessionsError || 'Unable to load active sessions.'}</p>
                                        <button type="button" onClick={() => loadActiveSessions()} className="mt-2 font-bold underline">Try again</button>
                                    </div>
                                )}
                                {activeSessionsLoadState === 'ready' && activeSessions.length === 0 && (
                                    <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 dark:border-slate-700">
                                        <p className="text-sm text-slate-600 dark:text-slate-300">No active sessions found.</p>
                                    </div>
                                )}
                                {activeSessionsLoadState === 'ready' && activeSessions.length > 0 && (
                                    <div className="mt-4 space-y-3">
                                        {activeSessions.map((session) => {
                                            const DeviceIcon = /tablet|ipad/i.test(session.device_name || '')
                                                ? Tablet
                                                : /mobile|phone|android|iphone|ios/i.test(session.device_name || '')
                                                    ? Smartphone
                                                    : Laptop;
                                            const deviceParts = String(session.device_name || '').split(/\s*\/\s*/);
                                            const deviceDetails = deviceParts.length > 1
                                                ? `${deviceParts[1]} on ${deviceParts[0]}`
                                                : deviceParts[0] || session.device_browser || '';
                                            return (
                                                <article key={session.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600">
                                                    <div className="flex items-start gap-3">
                                                        <span className="rounded-xl bg-white p-2.5 text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300" aria-hidden="true"><DeviceIcon className="h-5 w-5" /></span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                <h4 className="break-words text-sm font-bold text-slate-900 dark:text-white">{deviceDetails || 'Device details unavailable'}</h4>
                                                                {session.is_current
                                                                    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Current Session</span>
                                                                    : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => revokeSession(session)}
                                                                            disabled={Boolean(sessionActionId) || isRevokingOtherSessions}
                                                                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                                                        >
                                                                            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                                                                            {sessionActionId === session.id ? 'Logging out...' : 'Log out'}
                                                                        </button>
                                                                    )}
                                                            </div>
                                                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                                                                <span className="break-all">{session.location || 'Location unavailable'}</span>
                                                                <span className="break-all">{session.ip_address || (session.is_current ? sessionInfo.ip_address : 'IP unavailable')}</span>
                                                                <span>Last active {session.is_current ? 'now' : formatSessionTimestamp(session.last_active_at)}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                        <button
                                            type="button"
                                            onClick={revokeOtherSessions}
                                            disabled={activeSessions.filter((session) => !session.is_current).length === 0 || Boolean(sessionActionId) || isRevokingOtherSessions}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                        >
                                            <LogOut size={15} aria-hidden="true" />
                                            {isRevokingOtherSessions ? 'Signing out other devices…' : 'Sign out of all other devices'}
                                        </button>
                                    </div>
                                )}
                            </section>
                        </div>
                    </div>

                    {showConfirmPasswordModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-password-title">
                            <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Security check</p>
                                        <h3 id="confirm-password-title" className="mt-2 text-xl font-bold text-slate-900">Confirm Password</h3>
                                    </div>
                                    <button type="button" onClick={() => setShowConfirmPasswordModal(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close password confirmation">✕</button>
                                </div>
                                <form onSubmit={confirmPasswordAndEnable2FA} className="mt-5 space-y-4">
                                    <label className="block text-sm font-semibold text-slate-700">
                                        Enter your current password
                                        <PasswordInput
                                            value={confirmPassword}
                                            onChange={setConfirmPassword}
                                            visible={visiblePasswords.twoFactor}
                                            onToggle={() => setVisiblePasswords((previous) => ({ ...previous, twoFactor: !previous.twoFactor }))}
                                            autoComplete="current-password"
                                            placeholder="Current password"
                                        />
                                    </label>
                                    {confirmPasswordError && <p className="text-sm font-semibold text-rose-600">{confirmPasswordError}</p>}
                                    <div className="flex gap-3 pt-2">
                                        <button type="button" onClick={() => setShowConfirmPasswordModal(false)} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                                        <button type="submit" className="btn-primary flex-1 rounded-full py-3 text-sm font-semibold">Verify</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            );
        }
        if (settingsTab === 'payout') {
            return <PayoutAccountPanel user={user} setSellerData={setSellerData} onPayoutAccountUpdated={onPayoutAccountUpdated} />;
        }
        const notificationCategories = [
            {
                label: 'New Chat Messages',
                description: 'Real-time alerts when a buyer or seller reaches out to coordinate campus meetup.',
                inApp: 'messagesInApp',
                email: 'messagesEmail',
                Icon: MessageSquare,
                iconTone: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
            },
            {
                label: 'Order & Handover Updates',
                description: 'Notifications when orders are placed, accepted, or ready for physical handover.',
                inApp: 'ordersInApp',
                email: 'ordersEmail',
                Icon: Package,
                iconTone: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
            },
            {
                label: 'Payment & Settlements',
                description: 'Instant confirmation when Chapa split payments succeed or settle to your bank.',
                inApp: 'paymentsInApp',
                email: 'paymentsEmail',
                Icon: CreditCard,
                iconTone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
                lockedInApp: true,
            },
        ];
        const optionalPreferenceKeys = ['messagesInApp', 'messagesEmail', 'ordersInApp', 'ordersEmail', 'paymentsEmail'];
        const hasOptionalAlertsEnabled = optionalPreferenceKeys.some((key) => notificationPrefs[key]);
        const toggleOptionalAlerts = () => {
            setNotificationPrefs((previous) => ({
                ...previous,
                messagesInApp: !hasOptionalAlertsEnabled,
                messagesEmail: !hasOptionalAlertsEnabled,
                ordersInApp: !hasOptionalAlertsEnabled,
                ordersEmail: !hasOptionalAlertsEnabled,
                paymentsInApp: true,
                paymentsEmail: !hasOptionalAlertsEnabled,
            }));
        };

        return (
            <>
                <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-600">Notifications</p>
                        <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Notification Preferences</h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">Choose how and when UniXchange keeps you informed about campus orders, chats, and payouts.</p>
                    </div>
                    <button
                        type="button"
                        onClick={toggleOptionalAlerts}
                        disabled={notificationPrefsLoadState !== 'ready' || isSavingNotificationPrefs}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                    >
                        {hasOptionalAlertsEnabled ? 'Turn off optional alerts' : 'Enable all'}
                    </button>
                </div>
                {notificationPrefsLoadState === 'loading' && (
                    <div className="mt-6 space-y-5" aria-label="Loading notification preferences" aria-busy="true">
                        <div className="mb-3 hidden grid-cols-[minmax(0,1fr)_112px_112px] gap-3 px-5 sm:grid" aria-hidden="true">
                            <span />
                            <span className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                            <span className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                        </div>
                        {[0, 1, 2].map((row) => <div key={row} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" />)}
                    </div>
                )}
                {notificationPrefsLoadState === 'error' && (
                    <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                        <span>{notificationPrefsLoadError || studentToast('preferencesLoadFailed')}</span>
                        <button type="button" onClick={() => setNotificationPrefsRetryKey((key) => key + 1)} className="font-bold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
                            {t('home.tryAgain')}
                        </button>
                    </div>
                )}
                {notificationPrefsLoadState === 'ready' && (
                    <div className="mt-6">
                        <div className="mb-3 hidden grid-cols-[minmax(0,1fr)_100px_100px] items-center gap-3 px-5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:grid">
                            <span>Notification type</span>
                            <span className="flex items-center justify-center gap-1.5"><Bell size={13} aria-hidden="true" />In-App Bell</span>
                            <span className="flex items-center justify-center gap-1.5"><Mail size={13} aria-hidden="true" />Email Digest</span>
                        </div>
                        <div className="space-y-3">
                            {notificationCategories.map((preference) => {
                                const Icon = preference.Icon;
                                return (
                                    <article key={preference.label} className="rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 sm:p-5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                                        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_100px_100px] sm:gap-3">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${preference.iconTone}`}>
                                                    <Icon size={19} aria-hidden="true" />
                                                </span>
                                                <div className="min-w-0">
                                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{preference.label}</h4>
                                                    <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-slate-400">{preference.description}</p>
                                                    {preference.lockedInApp && <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"><LockKeyhole size={12} aria-hidden="true" />Required for transaction security</p>}
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 sm:justify-center sm:border-0 sm:pt-0 dark:border-slate-800">
                                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 sm:hidden dark:text-slate-400"><Bell size={14} aria-hidden="true" />In-App Bell</span>
                                                <NotificationChannelToggle
                                                    label="In-App"
                                                    ariaLabel={`${preference.label}: In-app`}
                                                    checked={notificationPrefs[preference.inApp]}
                                                    onChange={() => updatePref(preference.inApp)}
                                                    disabled={preference.lockedInApp}
                                                    title={preference.lockedInApp ? 'Required for transaction security' : undefined}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 sm:justify-center sm:border-0 sm:pt-0 dark:border-slate-800">
                                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 sm:hidden dark:text-slate-400"><Mail size={14} aria-hidden="true" />Email Digest</span>
                                                <NotificationChannelToggle
                                                    label="Email"
                                                    ariaLabel={`${preference.label}: Email`}
                                                    checked={notificationPrefs[preference.email]}
                                                    onChange={() => updatePref(preference.email)}
                                                />
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>

                        <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                            {notificationPrefsDirty && (
                                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300" aria-live="polite">
                                    {studentToast('unsavedPreferences')}
                                </span>
                            )}
                            {!notificationPrefsDirty && <span className="text-xs text-slate-500 dark:text-slate-400">Your preferences are up to date.</span>}
                            <div className="flex flex-col-reverse gap-3 sm:flex-row">
                                <button
                                    type="button"
                                    onClick={() => setNotificationPrefs(DEFAULT_NOTIFICATION_PREFERENCES)}
                                    disabled={!notificationPrefsDirty || isSavingNotificationPrefs}
                                    className="inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                    Reset to Default
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveNotificationPreferences}
                                    disabled={!notificationPrefsDirty || isSavingNotificationPrefs || notificationPrefsLoadState !== 'ready'}
                                    className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold whitespace-nowrap shadow-sm transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                >
                                    {isSavingNotificationPrefs && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" aria-hidden="true" />}
                                    {isSavingNotificationPrefs ? 'Saving Preferences…' : 'Save Preferences'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    };

    useEffect(() => {
        if (settingsTab === 'security') {
            loadSessionInfo();
            loadActiveSessions();
        }
    }, [settingsTab, user, loadSessionInfo, loadActiveSessions]);


    return (
        <div data-dashboard-view="settings" className="min-h-full w-full min-w-0 max-w-none bg-slate-50 px-4 pb-10 pt-16 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-0 lg:pt-8">
            <div className="w-full min-w-0 max-w-none">
                <div className="mb-6">
                    <div className="mt-2 min-w-0">
                        <h2 className="break-words text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">Account Settings</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">Manage your profile, payouts, security, and notification preferences.</p>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <nav className="settings-tabs flex w-full min-w-0 items-center gap-5 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="Account settings sections">
                        {settingsSections.map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                data-settings-tab={id}
                                onClick={() => handleSettingsTabChange(id)}
                                aria-selected={settingsTab === id}
                                className={`shrink-0 border-b-2 px-1 py-3 text-sm transition-colors ${settingsTab === id ? 'border-sky-500 font-semibold text-sky-600 dark:text-sky-400' : 'border-transparent font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </nav>

                    <section role="tabpanel" className="w-full min-w-0 max-w-none rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
                        {renderPanel()}
                    </section>
                </div>
            </div>
        </div>
    );
}

function PanelHeader({ eyebrow, title, text }) {
    return <div className="border-b border-slate-200 pb-5"><p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-600">{eyebrow}</p><h3 className="mt-2 text-2xl font-black text-slate-950">{title}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{text}</p></div>;
}

export default SettingsCenter;
