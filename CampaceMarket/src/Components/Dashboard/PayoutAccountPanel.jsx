/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Clock3, LockKeyhole, PencilLine, ShieldCheck } from 'lucide-react';
import { notifyError, notifySuccess } from '../../utils/notify';
import { API_BASE_URL } from '../../config';
import {
    getEssentialPayoutProviders,
    payoutNameNeedsAcknowledgement,
} from '../../utils/payoutSetupValidation';
import PaymentProviderLogo from '../PaymentProviderLogo';
import { PAYMENT_PROVIDER_LOGOS } from '../paymentProviderData';

const inputClass = 'mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white';
const providerOptions = [
    { key: 'cbe', payoutType: 'bank' },
    { key: 'telebirr', payoutType: 'mobile_wallet' },
    { key: 'cbeBirr', payoutType: 'mobile_wallet' },
];

const emptyForm = {
    business_name: '',
    account_name: '',
    bank_code: '',
    account_number: '',
};

const getRegisteredName = (user) => String(user?.full_name || user?.fullName || user?.name || '').trim();
const getBusinessName = (user) => String(
    user?.business_name
    || user?.businessName
    || user?.shop_name
    || user?.shopName
    || user?.store_name
    || user?.storeName
    || getRegisteredName(user),
).trim();
const getDefaultForm = (user) => ({
    ...emptyForm,
    business_name: getBusinessName(user),
    account_name: getRegisteredName(user),
});

const getSessionToken = (user) => {
    try {
        const savedSession = JSON.parse(window.localStorage.getItem('campaceSession') || '{}');
        return savedSession?.user?.access_token || savedSession?.access_token || user?.access_token || '';
    } catch {
        return user?.access_token || '';
    }
};

const Field = ({ label, children }) => (
    <label className="block">
        <span className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span>
        {children}
    </label>
);

function PayoutAccountPanel({ user, setSellerData, onPayoutAccountUpdated }) {
    const [account, setAccount] = useState(null);
    const [loadingAccount, setLoadingAccount] = useState(true);
    const [loadingProviders, setLoadingProviders] = useState(true);
    const [providers, setProviders] = useState([]);
    const [providerReloadKey, setProviderReloadKey] = useState(0);
    const [providerError, setProviderError] = useState('');
    const [payoutType, setPayoutType] = useState('bank');
    const [nameMismatchAcknowledged, setNameMismatchAcknowledged] = useState(false);
    const [form, setForm] = useState(() => getDefaultForm(user));
    const [savedForm, setSavedForm] = useState(() => getDefaultForm(user));
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [accountNumberError, setAccountNumberError] = useState('');
    const [showReauth, setShowReauth] = useState(false);
    const [reauthPassword, setReauthPassword] = useState('');
    const [reauthError, setReauthError] = useState('');
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        const updateTime = () => setCurrentTime(Date.now());
        updateTime();
        const timerId = window.setInterval(updateTime, 60000);
        return () => window.clearInterval(timerId);
    }, []);

    const loadAccount = useCallback(async () => {
        const token = getSessionToken(user);
        if (!token) {
            setAccount(null);
            setLoadingAccount(false);
            return;
        }
        setLoadingAccount(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/seller/payout-account`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data?.detail || 'Unable to load payout account.');
            setAccount(data?.exists ? data : null);
            if (data?.exists) {
                const accountType = data.payout_type === 'mobile_wallet' ? 'mobile_wallet' : 'bank';
                setPayoutType(accountType);
                setNameMismatchAcknowledged(Boolean(data.name_mismatch_acknowledged));
                const defaults = getDefaultForm(user);
                const nextForm = {
                    business_name: data.business_name || defaults.business_name,
                    account_name: data.account_name || defaults.account_name,
                    bank_code: data.bank_code || '',
                    account_number: '',
                };
                setForm(nextForm);
                setSavedForm(nextForm);
            } else {
                setNameMismatchAcknowledged(false);
                const defaults = getDefaultForm(user);
                setForm(defaults);
                setSavedForm(defaults);
            }
        } catch (loadError) {
            setError(loadError.message || 'Unable to load payout account.');
            setAccount(null);
        } finally {
            setLoadingAccount(false);
        }
    }, [user]);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);

        const loadProviders = async () => {
            setLoadingProviders(true);
            setProviderError('');
            try {
                const banksResponse = await fetch(`${API_BASE_URL}/api/payment/banks`, { signal: controller.signal });
                const banksData = await banksResponse.json().catch(() => ([]));
                if (!banksResponse.ok) throw new Error(banksData?.detail || 'Unable to load payout provider list.');
                if (!Array.isArray(banksData)) throw new Error('Payout provider service returned an invalid list.');
                if (active) {
                    setProviders([
                        ...getEssentialPayoutProviders(banksData, 'bank'),
                        ...getEssentialPayoutProviders(banksData, 'mobile_wallet'),
                    ]);
                }
            } catch (loadError) {
                if (!active) return;
                setProviders([]);
                setProviderError(loadError.message || 'Payout providers are unavailable right now.');
            } finally {
                window.clearTimeout(timeoutId);
                if (active) setLoadingProviders(false);
            }
        };

        loadProviders();
        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(timeoutId);
        };
    }, [providerReloadKey]);

    useEffect(() => {
        loadAccount();
    }, [loadAccount]);

    const dirty = Object.keys(form).some((key) => form[key] !== savedForm[key]);
    const selectedProvider = providers.find((provider) => provider.code === form.bank_code);
    const nameNeedsAcknowledgement = payoutNameNeedsAcknowledgement(
        form.account_name,
        getRegisteredName(user),
    );
    const availableProviderOptions = providerOptions
        .map(({ key, payoutType: providerPayoutType }) => ({
            key,
            payoutType: providerPayoutType,
            logo: PAYMENT_PROVIDER_LOGOS[key],
            provider: providers.find((item) => item.method === providerPayoutType
                && item.name === PAYMENT_PROVIDER_LOGOS[key].name),
        }))
        .filter(({ provider }) => provider);
    const providerChanged = Boolean(account && (form.bank_code !== account.bank_code || payoutType !== account.payout_type));

    const updateForm = (key, value) => {
        setForm((previous) => ({ ...previous, [key]: value }));
        if (key === 'account_number') setAccountNumberError('');
        if (key === 'account_name') setNameMismatchAcknowledged(false);
    };

    const selectProvider = (provider, nextPayoutType) => {
        setPayoutType(nextPayoutType);
        setForm((previous) => ({
            ...previous,
            bank_code: provider.code,
            account_number: previous.bank_code === provider.code ? previous.account_number : '',
        }));
        setAccountNumberError('');
    };

    const beginEdit = () => {
        setEditing(true);
        setMessage('');
        setError('');
    };

    const cancelEdit = () => {
        if (dirty && !window.confirm('Discard your unsaved payout changes?')) return;
        setForm(savedForm);
        setPayoutType(account?.payout_type === 'mobile_wallet' ? 'mobile_wallet' : 'bank');
        setNameMismatchAcknowledged(Boolean(account?.name_mismatch_acknowledged));
        setEditing(false);
        setError('');
        setAccountNumberError('');
    };

    const validateForm = () => {
        const accountNumber = form.account_number.trim();
        if (!(form.business_name.trim() || getBusinessName(user))
            || !(form.account_name.trim() || getRegisteredName(user))
            || !form.bank_code) {
            setError('Business name, account name, and provider are required.');
            return false;
        }
        if (nameNeedsAcknowledgement && !nameMismatchAcknowledged) {
            setError('Confirm that the different payout account name belongs to you or an authorized family member.');
            return false;
        }
        if ((!account || providerChanged) && !accountNumber) {
            setAccountNumberError('Enter the account number for the selected payout provider.');
            return false;
        }
        if (accountNumber) {
            const expectedLength = payoutType === 'mobile_wallet' ? /^\d{10}$/ : form.bank_code.toLowerCase() === 'comari' ? /^\d{13}$/ : /^\d{10,15}$/;
            if (!expectedLength.test(accountNumber)) {
                setAccountNumberError(payoutType === 'mobile_wallet'
                    ? 'Enter a valid 10-digit phone number for the mobile wallet.'
                    : form.bank_code.toLowerCase() === 'comari'
                        ? 'CBE account numbers must be exactly 13 digits.'
                        : 'Account number must be between 10 and 15 digits.');
                return false;
            }
        }
        setError('');
        setAccountNumberError('');
        return true;
    };

    const submitPayout = async (password = '') => {
        const token = getSessionToken(user);
        if (!token) {
            setError('Your authenticated student session is required. Please sign in again.');
            return;
        }
        setSaving(true);
        try {
            const isEdit = Boolean(account);
            const response = await fetch(`${API_BASE_URL}${isEdit ? '/api/seller/payout-account' : '/api/student/seller/setup-payout'}`, {
                method: isEdit ? 'PATCH' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...(isEdit ? { 'x-reauth-password': password } : {}),
                },
                body: JSON.stringify({
                    business_name: form.business_name.trim() || getBusinessName(user),
                    account_name: form.account_name.trim() || getRegisteredName(user),
                    bank_code: form.bank_code,
                    payout_type: payoutType,
                    provider_id: null,
                    provider_name: selectedProvider?.name || account?.provider || '',
                    account_number: form.account_number.trim(),
                    name_mismatch_acknowledged: nameNeedsAcknowledgement && nameMismatchAcknowledged,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data?.detail || 'Unable to save payout account.');
            await loadAccount();
            setEditing(false);
            setShowReauth(false);
            setReauthPassword('');
            setReauthError('');
            setMessage(isEdit ? 'Payout account updated.' : 'Payout account configured successfully.');
            setSellerData?.((previous) => ({ ...previous, account_status: data?.account_status || 'Active' }));
            onPayoutAccountUpdated?.(data);
            notifySuccess(isEdit ? 'Payout account updated.' : (data?.message || 'Payout account configured successfully.'), 'student-payout-account-save');
        } catch (saveError) {
            if (showReauth) setReauthError(saveError.message || 'Password verification failed.');
            else {
                setError(saveError.message || 'Unable to save payout account.');
                notifyError(saveError, 'student-payout-account-save');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        setMessage('');
        if (!validateForm()) return;
        if (account) {
            setReauthPassword('');
            setReauthError('');
            setShowReauth(true);
            return;
        }
        submitPayout();
    };

    const handleReauthSubmit = (event) => {
        event.preventDefault();
        if (!reauthPassword.trim()) {
            setReauthError('Enter your current password to confirm this change.');
            return;
        }
        submitPayout(reauthPassword);
    };

    const accountMask = payoutType === 'mobile_wallet'
        ? account?.phone_number_masked || account?.account_number_masked
        : account?.account_number_masked;
    const holdDate = account?.payout_hold_until ? new Date(account.payout_hold_until) : null;
    const holdActive = holdDate && !Number.isNaN(holdDate.getTime()) && holdDate.getTime() > currentTime;
    const updatedDate = account?.updated_at ? new Date(account.updated_at) : null;
    const accountProviderLabel = String(account?.provider || '').trim();
    const providerIdentity = `${accountProviderLabel} ${account?.bank_code || ''}`.toLowerCase();
    const connectedProviderKey = providerIdentity.includes('telebirr')
        ? 'telebirr'
        : providerIdentity.includes('cbe birr') || providerIdentity.includes('cbebirr')
            ? 'cbeBirr'
            : providerIdentity.includes('commercial bank')
                || providerIdentity.includes('cbe')
                || String(account?.bank_code || '').toLowerCase() === 'comari'
                ? 'cbe'
                : null;
    const connectedProviderName = connectedProviderKey
        ? PAYMENT_PROVIDER_LOGOS[connectedProviderKey].name
        : accountProviderLabel || 'Bank account';
    const isAccountActive = String(account?.account_status || '').toLowerCase() === 'active';

    return (
        <>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5">
                <div>
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-600">Seller Payouts</p>
                    <h3 className="mt-2 text-2xl font-black text-slate-950">Get paid directly from campus sales</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Connect your Ethiopian bank account before publishing products for split payments.</p>
                </div>
            </div>

            {loadingAccount ? (
                <div className="mt-6 animate-pulse space-y-4" aria-label="Loading payout account" aria-busy="true">
                    <div className="h-6 w-1/3 rounded bg-slate-200" />
                    <div className="grid gap-4 sm:grid-cols-2"><div className="h-24 rounded-2xl bg-slate-100" /><div className="h-24 rounded-2xl bg-slate-100" /></div>
                </div>
            ) : account && !editing ? (
                <div className="group relative mt-6 overflow-hidden rounded-[26px] border border-slate-700/80 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-5 text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:p-7">
                    <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
                    <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
                    <div className="relative">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300 sm:text-xs">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${isAccountActive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isAccountActive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                    </span>
                                    Connected payout method
                                </p>
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${isAccountActive ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/20 bg-amber-300/10 text-amber-200'}`}>
                                    <Check size={11} aria-hidden="true" />
                                    {isAccountActive ? 'Active & Verified' : account.account_status || 'Pending'}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={beginEdit}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                            >
                                <PencilLine size={14} aria-hidden="true" />
                                Edit / Change
                            </button>
                        </div>

                        <div className="mt-8 flex min-w-0 items-center gap-4">
                            {connectedProviderKey ? (
                                <PaymentProviderLogo provider={connectedProviderKey} className="h-12 w-12 rounded-2xl border border-white/10 bg-white p-1 shadow-md" />
                            ) : (
                                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-slate-200 shadow-md">
                                    <Building2 size={24} aria-hidden="true" />
                                </span>
                            )}
                            <div className="min-w-0">
                                <h4 className="truncate text-base font-semibold text-white sm:text-lg">{connectedProviderName}</h4>
                                <p className="mt-1 font-mono text-lg font-bold tracking-[0.12em] text-slate-100 sm:text-xl">
                                    {accountMask ? `•••• ${accountMask.replace(/\D/g, '').slice(-4)}` : account?.payout_type === 'mobile_wallet' ? 'Mobile wallet' : 'Bank account'}
                                </p>
                                {account?.payout_type === 'mobile_wallet' && accountMask && (
                                    <p className="mt-1 text-[11px] font-medium tracking-normal text-slate-400">{accountMask}</p>
                                )}
                            </div>
                        </div>

                        <div className="mt-8 grid grid-cols-1 gap-4 border-t border-white/10 pt-5 sm:grid-cols-2">
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Business / Shop name</p>
                                <p className="mt-1.5 truncate text-sm font-semibold text-white">{account.business_name || 'Seller payout account'}</p>
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Legal account name</p>
                                <p className="mt-1.5 truncate text-sm font-semibold text-white">{account.account_name || 'Not provided'}</p>
                            </div>
                        </div>

                        <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-end sm:justify-between">
                            <div className="inline-flex max-w-full items-start gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.07] px-3 py-2.5 text-xs leading-5 text-emerald-100">
                                <LockKeyhole size={15} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true" />
                                <span>Encrypted Chapa Split Subaccount. Direct automatic settlements to this account.</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400 sm:pb-1">
                                <Clock3 size={13} aria-hidden="true" />
                                <span>Last synced {updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toLocaleString() : 'Not available'}</span>
                            </div>
                        </div>
                        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                            <ShieldCheck size={14} className="text-emerald-400" aria-hidden="true" />
                            <span>Protected payout destination</span>
                        </div>
                    </div>
                    {holdActive && <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Payouts are temporarily on hold until {holdDate.toLocaleString()} because these account details were changed.</div>}
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2">
                    {account && holdActive && <div role="status" className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Payouts are temporarily on hold until {holdDate.toLocaleString()} because these account details were changed.</div>}
                    <Field label="Business Name"><input value={form.business_name} onChange={(event) => updateForm('business_name', event.target.value)} className={inputClass} placeholder="Your seller or business name" /></Field>
                    <Field label="Account Name"><input value={form.account_name} onChange={(event) => updateForm('account_name', event.target.value)} className={inputClass} placeholder="Name on bank account" /></Field>
                    {nameNeedsAcknowledgement && (
                        <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">
                            <input
                                type="checkbox"
                                checked={nameMismatchAcknowledged}
                                onChange={(event) => setNameMismatchAcknowledged(event.target.checked)}
                                className="mt-1 h-4 w-4 shrink-0 accent-amber-700"
                            />
                            <span>The name on this bank account differs from your profile name. Please confirm this account belongs to you or an authorized family member.</span>
                        </label>
                    )}
                    <fieldset className="sm:col-span-2 min-w-0">
                        <legend className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Payout Provider</legend>
                        {loadingProviders ? (
                            <p className="mt-2 text-sm text-slate-500">Loading providers...</p>
                        ) : (
                            <div className="mt-2 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Payout provider">
                                {availableProviderOptions.map(({ key, payoutType: providerPayoutType, logo, provider }) => {
                                    const isSelected = form.bank_code === provider.code && payoutType === providerPayoutType;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            role="radio"
                                            aria-checked={isSelected}
                                            onClick={() => selectProvider(provider, providerPayoutType)}
                                            className={`relative flex min-h-20 items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${isSelected ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/20' : 'border-slate-200 bg-white'}`}
                                        >
                                            <PaymentProviderLogo provider={key} className="h-12 w-12 rounded-xl border border-slate-200 bg-white" />
                                            <span className="pr-5 text-sm font-bold leading-5 text-slate-800">{logo.name}</span>
                                            {isSelected && <span aria-hidden="true" className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-xs font-black text-white">✓</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {!loadingProviders && availableProviderOptions.length === 0 && !providerError && (
                            <p className="mt-2 text-sm text-slate-500">No supported payout providers returned.</p>
                        )}
                    </fieldset>
                    <Field label={payoutType === 'mobile_wallet' ? 'Phone Number' : 'Account Number'}>
                        <input inputMode="numeric" required={!account || providerChanged} pattern={payoutType === 'mobile_wallet' ? '\\d{10}' : undefined} minLength={10} maxLength={payoutType === 'mobile_wallet' ? 10 : 15} value={form.account_number} onChange={(event) => updateForm('account_number', event.target.value)} className={inputClass} placeholder={accountMask && !providerChanged ? `Leave blank to keep ending ${accountMask.slice(-4)}` : payoutType === 'mobile_wallet' ? 'Enter phone number (e.g. 0912345678)' : 'Enter CBE account number (e.g. 1000...)'} />
                    </Field>
                    {providerError && <div className="sm:col-span-2 flex items-center gap-3 text-sm font-semibold text-rose-600"><p>{providerError}</p><button type="button" onClick={() => setProviderReloadKey((key) => key + 1)} className="underline underline-offset-2">Retry providers</button></div>}
                    {accountNumberError && <p className="sm:col-span-2 -mt-2 text-sm font-semibold text-rose-600">{accountNumberError}</p>}
                    {error && <p role="alert" className="sm:col-span-2 text-sm font-semibold text-rose-600">{error}</p>}
                    {message && <p role="status" className="sm:col-span-2 text-sm font-semibold text-emerald-600">{message}</p>}
                    <div className="sm:col-span-2 flex flex-wrap items-center gap-3 pt-2">
                        <button type="submit" disabled={saving || loadingProviders || (account ? !dirty : false)} className="btn-primary inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold">{saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" aria-hidden="true" />}{saving ? 'Saving...' : account ? 'Save Changes' : 'Save Payout Account'}</button>
                        {account && <button type="button" onClick={cancelEdit} disabled={saving} className="rounded-full border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>}
                    </div>
                </form>
            )}

            {showReauth && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="payout-reauth-title">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Security check</p>
                        <h4 id="payout-reauth-title" className="mt-2 text-xl font-bold text-slate-900">Confirm payout change</h4>
                        <p className="mt-2 text-sm text-slate-600">Enter your current password to update the payout account.</p>
                        <form onSubmit={handleReauthSubmit} className="mt-5 space-y-4">
                            <label className="block text-sm font-semibold text-slate-700">Current password<input type="password" autoComplete="current-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} className={inputClass} /></label>
                            {reauthError && <p role="alert" className="text-sm font-semibold text-rose-600">{reauthError}</p>}
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowReauth(false)} disabled={saving} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                                <button type="submit" disabled={saving} className="btn-primary flex-1 rounded-full py-3 text-sm font-semibold">{saving ? 'Verifying...' : 'Verify and Save'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

export default PayoutAccountPanel;