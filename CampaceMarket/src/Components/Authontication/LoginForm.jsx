import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import ForgotPasswordModal from './ForgotPasswordModal';
import AuthInfoModal from './AuthInfoModal';
import { useLanguage } from '../../context/LanguageContext';
import { apiUrl } from '../../api/config';
import { API_BASE_URL } from '../../config';
import { notifyInfo } from '../../utils/notify';
import logs from '../../assets/logs.png';
import './LoginForm.css';

function getOAuthSessionToken(callbackUrl) {
  const fragment = new URLSearchParams(callbackUrl.hash.slice(1));
  const callbackToken = callbackUrl.searchParams.get('access_token')
    || callbackUrl.searchParams.get('token')
    || fragment.get('access_token')
    || fragment.get('token');
  if (callbackToken) return callbackToken;

  try {
    const directToken = window.localStorage.getItem('token');
    if (directToken) return directToken;
    const savedSession = JSON.parse(window.localStorage.getItem('campaceSession') || 'null');
    const savedUser = savedSession?.user;
    return savedUser?.access_token
      || savedUser?.accessToken
      || savedUser?.token
      || savedSession?.access_token
      || savedSession?.accessToken
      || savedSession?.token
      || '';
  } catch (storageError) {
    console.error('Unable to read the saved OAuth session token:', storageError);
    return '';
  }
}

function LoginForm({ onLoginSuccess, onToggleRegister, onCancel, sessionExpiredMessage = '' }) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({ studentId: '', password: '' });
  const [error, setError] = useState('');
  const [isLoginPending, setIsLoginPending] = useState(false);
  const submitInFlightRef = useRef(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const googleRedirectStartedRef = useRef(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [otpRole, setOtpRole] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpMode, setOtpMode] = useState('authenticator');
  const [remainingBackupCodes, setRemainingBackupCodes] = useState(null);
  const [adminChallengeToken, setAdminChallengeToken] = useState('');
  const [adminLoginStep, setAdminLoginStep] = useState('');
  const [adminSetupData, setAdminSetupData] = useState(null);
  const [adminSetupCode, setAdminSetupCode] = useState('');
  const [adminSetupBackupCodes, setAdminSetupBackupCodes] = useState([]);
  const [pendingAdminLogin, setPendingAdminLogin] = useState(null);
  const [emailCodeAvailable, setEmailCodeAvailable] = useState(false);
  const [maskedAdminEmail, setMaskedAdminEmail] = useState('');
  const [emailCodeCountdown, setEmailCodeCountdown] = useState(0);
  const [emailCodeSending, setEmailCodeSending] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (sessionExpiredMessage) {
      notifyInfo(sessionExpiredMessage, 'login-redirect-message');
    }
  }, [sessionExpiredMessage]);

  useEffect(() => {
    if (emailCodeCountdown <= 0) return undefined;
    const timerId = window.setTimeout(() => {
      setEmailCodeCountdown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timerId);
  }, [emailCodeCountdown]);

  useEffect(() => {
    const callbackUrl = new URL(window.location.href);
    const callbackError = callbackUrl.searchParams.get('error');
    if (callbackError) {
      const domain = callbackUrl.searchParams.get('domain') || 'your university domain';
      const messageKey = `auth.oauthErrors.${callbackError}`;
      const translatedMessage = t(messageKey);
      callbackUrl.searchParams.delete('error');
      callbackUrl.searchParams.delete('domain');
      window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      queueMicrotask(() => setError(translatedMessage === messageKey
        ? `Social login failed: ${callbackError}`
        : translatedMessage.replace('{domain}', domain)));
      return;
    }

    if (callbackUrl.searchParams.get('oauth') === 'success') {
      const sessionToken = getOAuthSessionToken(callbackUrl);
      callbackUrl.searchParams.delete('oauth');
      callbackUrl.searchParams.delete('access_token');
      callbackUrl.searchParams.delete('token');
      if (new URLSearchParams(callbackUrl.hash.slice(1)).has('access_token')
        || new URLSearchParams(callbackUrl.hash.slice(1)).has('token')) {
        callbackUrl.hash = '';
      }
      window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      fetch(apiUrl('/api/auth/session'), {
        credentials: 'include',
        ...(sessionToken ? { headers: { Authorization: `Bearer ${sessionToken}` } } : {}),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(t('auth.oauthErrors.session_restore_failed'));
          const data = await response.json();
          if (!data.user || !data.role) throw new Error(t('auth.oauthErrors.session_restore_failed'));
          onLoginSuccess?.({ ...data.user, access_token: data.access_token }, data.role);
        })
        .catch((restoreError) => setError(restoreError.message || t('auth.oauthErrors.session_restore_failed')));
      return;
    }

    const oauthFragment = new URLSearchParams(callbackUrl.hash.slice(1));
    const oauthAccessToken = oauthFragment.get('access_token');
    if (oauthFragment.get('oauth') === 'success' && oauthAccessToken) {
      callbackUrl.hash = '';
      window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}`);
      onLoginSuccess?.({
        name: oauthFragment.get('name') || 'Student',
        studentId: oauthFragment.get('student_id') || '',
        email: oauthFragment.get('email') || '',
        access_token: oauthAccessToken,
      }, oauthFragment.get('role') || 'student');
      return;
    }
    const code = callbackUrl.searchParams.get('code');
    const returnedState = callbackUrl.searchParams.get('state');
    const oauthError = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error');
    const provider = sessionStorage.getItem('campaceOAuthProvider');
    const expectedState = sessionStorage.getItem('campaceOAuthState');

    if (!code && !oauthError) {
      return;
    }

    callbackUrl.searchParams.delete('code');
    callbackUrl.searchParams.delete('state');
    callbackUrl.searchParams.delete('error');
    callbackUrl.searchParams.delete('error_description');
    window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);

    if (oauthError) {
      queueMicrotask(() => setError(`Social login failed: ${oauthError}`));
      return;
    }

    if (!code || !provider || !returnedState || returnedState !== expectedState) {
      window.alert('Security verification failed. Please start the login again.');
      queueMicrotask(() => setError('Social login could not be verified. Please try again.'));
      return;
    }

    const codeVerifier = sessionStorage.getItem('campaceOAuthCodeVerifier');
    sessionStorage.removeItem('campaceOAuthProvider');
    sessionStorage.removeItem('campaceOAuthState');
    sessionStorage.removeItem('campaceOAuthCodeVerifier');

    if (!codeVerifier) {
      window.alert('Security verification failed. Please start the login again.');
      queueMicrotask(() => setError('The secure login verifier is missing. Please try again.'));
      return;
    }

    fetch(apiUrl('/api/auth/google-callback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: apiUrl('/auth/google/callback') }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'Social login failed.');
        onLoginSuccess?.({ ...data.user, access_token: data.access_token }, data.role);
        setIsSuccess(true);
      })
      .catch((error) => {
        setError(error.message || 'Social login failed.');
      });
  }, [onLoginSuccess, t]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const validate = () => {
    const identifier = formData.studentId.trim();
    const password = formData.password.trim();

    if (!identifier || !password) {
      return t('auth.fillBoth');
    }

    const looksLikeEmail = identifier.includes('@');
    if (looksLikeEmail) {
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
      if (!validEmail) {
        return 'Please enter a valid student ID or email.';
      }
      return '';
    }

    return '';
  };

  const restartAdminLogin = () => {
    setShowOtpModal(false);
    setAdminChallengeToken('');
    setAdminLoginStep('');
    setAdminSetupData(null);
    setAdminSetupCode('');
    setAdminSetupBackupCodes([]);
    setPendingAdminLogin(null);
    setOtpCode('');
    setEmailCodeAvailable(false);
    setMaskedAdminEmail('');
    setEmailCodeCountdown(0);
    setError('');
  };

  const startRequiredAdminSetup = async (challengeToken) => {
    const response = await fetch(apiUrl('/api/admin/login/2fa/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_token: challengeToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Could not start authenticator setup.');
    setAdminSetupData(data);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      setIsSuccess(false);
      return;
    }

    submitInFlightRef.current = true;
    setIsLoginPending(true);
    try {
      const response = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_or_email: formData.studentId.trim(),
          password: formData.password.trim()
        })
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const detail = data?.detail;
        const message = Array.isArray(detail)
          ? detail[0]?.msg || t('auth.loginFailed')
          : typeof detail === 'string'
            ? detail
            : detail?.message
              ? detail.message
            : t('auth.loginFailed');

        setError(message);
        setIsSuccess(false);
        return;
      }

      if (data.requires_2fa_setup && data.challenge_token) {
        setOtpRole('admin');
        setAdminChallengeToken(data.challenge_token);
        setAdminLoginStep('setup');
        setAdminSetupData(null);
        setAdminSetupCode('');
        setAdminSetupBackupCodes([]);
        setShowOtpModal(true);
        setError('');
        try {
          await startRequiredAdminSetup(data.challenge_token);
        } catch (setupError) {
          setError(setupError.message || 'Could not start authenticator setup.');
        }
        return;
      }

      if (data.requires_2fa && data.challenge_token) {
        setOtpRole('admin');
        setAdminChallengeToken(data.challenge_token);
        setAdminLoginStep('challenge');
        setEmailCodeAvailable(Boolean(data.email_code_available));
        setMaskedAdminEmail('');
        setEmailCodeCountdown(0);
        setOtpEmail('');
        setOtpCode('');
        setOtpMode('authenticator');
        setRemainingBackupCodes(Number.isFinite(Number(data.remaining_backup_codes))
          ? Number(data.remaining_backup_codes)
          : null);
        setShowOtpModal(true);
        setError('');
        return;
      }

      if (data.role === 'admin' && data.access_token && !data.challenge_token) {
        onLoginSuccess?.({ ...data.user, access_token: data.access_token }, data.role);
        setError('');
        return;
      }

      if (data.status === 'otp_required' || data.requires_2fa) {
        const nextRole = data.role || (data.status === 'otp_required' ? 'student' : 'admin');
        const nextEmail = data.email || data.otp_email || formData.studentId.trim();

        setOtpRole(nextRole);
        setOtpEmail(nextEmail);
        setOtpCode('');
        setOtpMode(nextRole === 'admin'
          ? (data.two_factor_method === 'email' ? 'email' : 'authenticator')
          : 'email');
        setRemainingBackupCodes(Number.isFinite(Number(data.remaining_backup_codes)) ? Number(data.remaining_backup_codes) : null);
        setShowOtpModal(true);
        setError('');
        return;
      }

      onLoginSuccess?.({ ...data.user, access_token: data.access_token }, data.role);
      setIsSuccess(true);
      setError('');
    } catch {
      setError(t('auth.couldNotConnect'));
      setIsSuccess(false);
    } finally {
      submitInFlightRef.current = false;
      setIsLoginPending(false);
    }
  };

  const requestAdminEmailCode = async () => {
    if (!adminChallengeToken || emailCodeCountdown > 0 || emailCodeSending) return;
    setEmailCodeSending(true);
    try {
      const response = await fetch(apiUrl('/api/admin/login/2fa/email-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: adminChallengeToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503) setEmailCodeAvailable(false);
        const retryAfter = Number(response.headers.get('Retry-After'));
        if (response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
          setEmailCodeCountdown(retryAfter);
        }
        throw new Error(data.detail || 'Could not send an email verification code.');
      }
      setEmailCodeAvailable(true);
      setMaskedAdminEmail(data.masked_email || '');
      setEmailCodeCountdown(Number(data.resend_after_seconds) || 60);
      setOtpMode('email');
      setOtpCode('');
      setError('');
    } catch (emailError) {
      setError(emailError.message || 'Could not send an email verification code.');
    } finally {
      setEmailCodeSending(false);
    }
  };

  const handleOtpSubmit = async (event) => {
    event.preventDefault();
    if (['authenticator', 'email'].includes(otpMode) && !/^\d{6}$/.test(otpCode)) {
      setError(t('auth.enterCode'));
      return;
    }
    if (otpMode === 'backup' && !otpCode.trim()) {
      setError('Enter a backup code.');
      return;
    }

    try {
      if (otpRole === 'admin' && adminChallengeToken) {
        const response = await fetch(apiUrl('/api/admin/login/2fa'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge_token: adminChallengeToken,
            method: otpMode === 'backup'
              ? 'backup'
              : otpMode === 'email'
                ? 'email'
                : 'authenticator',
            ...(otpMode === 'backup'
              ? { backup_code: otpCode.trim() }
              : { code: otpCode.trim() }),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || t('auth.invalidCode'));
        setPendingAdminLogin(data);
        setRemainingBackupCodes(Number.isFinite(Number(data.remaining_backup_codes))
          ? Number(data.remaining_backup_codes)
          : null);
        setAdminLoginStep('login-success');
        setOtpCode('');
        setError('');
        return;
      }

      const endpoint = otpRole === 'student' ? `${API_BASE_URL}/api/auth/verify-login-otp` : `${API_BASE_URL}/api/login/verify-otp`;
      const body = { email: otpEmail, otp_code: otpCode.trim() };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || t('auth.invalidCode'));

      onLoginSuccess?.({ ...data.user, access_token: data.access_token }, data.role);
      setIsSuccess(true);
      setShowOtpModal(false);
      setOtpMode('authenticator');
      setRemainingBackupCodes(null);
      setError('');
    } catch (err) {
      setError(err.message || t('auth.couldNotVerify'));
    }
  };

  const handleRequiredAdminSetupVerify = async (event) => {
    event.preventDefault();
    if (adminSetupCode.length !== 6 || !adminChallengeToken) {
      setError('Enter the six-digit code shown in your authenticator app.');
      return;
    }
    try {
      const response = await fetch(apiUrl('/api/admin/login/2fa/setup/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_token: adminChallengeToken,
          code: adminSetupCode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Authenticator verification failed.');
      setAdminSetupBackupCodes(data.backup_codes || []);
      setRemainingBackupCodes(Number.isFinite(Number(data.remaining_backup_codes))
        ? Number(data.remaining_backup_codes)
        : null);
      setAdminLoginStep('setup-backup');
      setAdminSetupCode('');
      setError('');
    } catch (setupError) {
      setError(setupError.message || 'Authenticator verification failed.');
    }
  };

  const completeRequiredAdminSetup = async () => {
    if (!adminChallengeToken) return;
    try {
      const response = await fetch(apiUrl('/api/admin/login/2fa/setup/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: adminChallengeToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Could not complete sign-in.');
      onLoginSuccess?.({ ...data.user, access_token: data.access_token }, data.role);
      setIsSuccess(true);
      setShowOtpModal(false);
      setAdminChallengeToken('');
      setAdminLoginStep('');
      setAdminSetupBackupCodes([]);
      setRemainingBackupCodes(null);
      setError('');
    } catch (setupError) {
      setError(setupError.message || 'Could not complete sign-in.');
    }
  };

  const continueAdminLogin = () => {
    if (!pendingAdminLogin) return;
    onLoginSuccess?.({
      ...pendingAdminLogin.user,
      access_token: pendingAdminLogin.access_token,
    }, pendingAdminLogin.role);
    setIsSuccess(true);
    setShowOtpModal(false);
    setAdminChallengeToken('');
    setAdminLoginStep('');
    setPendingAdminLogin(null);
    setRemainingBackupCodes(null);
    setError('');
  };

  const handleGoogleLogin = () => {
    if (googleRedirectStartedRef.current) return;
    googleRedirectStartedRef.current = true;
    setIsGoogleRedirecting(true);
    try {
      window.location.assign(apiUrl('/auth/google/login'));
    } catch {
      googleRedirectStartedRef.current = false;
      setIsGoogleRedirecting(false);
      setError('Google sign-in could not be started. Please try again.');
    }
  };

  return (
    <>
      <div className="login-page-shell">
        <div className="login-decor login-shape-top" />
        <div className="login-decor login-shape-left" />
        <div className="login-decor login-shape-right" />
        <div className="login-decor login-shape-bottom" />

        <header className="login-brand" aria-label="UniXchange logo and brand">
          <img src={logs} alt="UniXchange logo" className="login-brand-logo" />
          <span className="login-brand-name">UniXchange</span>
        </header>

        <main className="login-card-shell">
          <div className="login-card">
            <button type="button" className="login-back-button" onClick={onCancel}>
              <ArrowLeft aria-hidden="true" />
              <span>Back</span>
            </button>
            <header className="login-header">
              <h1>Welcome Back,</h1>
              <p>Sign in to your UniXchange account.</p>
            </header>

            {error && (
              <div className="login-status login-status-error">
                {error}
              </div>
            )}

            {isSuccess && (
              <div className="login-status login-status-success">
                <p className="login-status-title">{t('auth.loginSuccessful')}</p>
                <p className="login-status-line">
                  {t('auth.studentId')}: <span>{formData.studentId.trim()}</span>
                </p>
                <p className="login-status-line">
                  {t('auth.password')}: <span>{formData.password.trim()}</span>
                </p>
              </div>
            )}

            {showOtpModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Two-step verification</p>
                      <h2 className="mt-2 text-xl font-bold text-slate-900">
                        {adminLoginStep === 'setup' || adminLoginStep === 'setup-backup'
                          ? 'Set up your authenticator'
                          : adminLoginStep === 'login-success'
                            ? 'Two-step verification complete'
                            : 'Verify your login code'}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => (adminChallengeToken ? restartAdminLogin() : setShowOtpModal(false))}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-600"
                      aria-label="Close verification"
                    >✕</button>
                  </div>

                  {error && (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                      {error}
                    </div>
                  )}

                  {adminLoginStep === 'setup' && (
                    <>
                      <p className="mb-4 text-sm leading-6 text-slate-600">
                        Your organization requires 2FA. Scan this QR code, then verify a code from your authenticator app.
                      </p>
                      {adminSetupData?.qr_code ? (
                        <>
                          <img src={adminSetupData.qr_code} alt="Authenticator setup QR code" className="mx-auto mb-4 h-48 w-48" />
                          <p className="mb-4 break-all text-center font-mono text-xs text-slate-500">
                            Manual setup key: {adminSetupData.secret}
                          </p>
                          <form onSubmit={handleRequiredAdminSetupVerify} className="space-y-4">
                            <input
                              autoFocus
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={adminSetupCode}
                              onChange={(event) => setAdminSetupCode(event.target.value.replace(/\D/g, ''))}
                              placeholder="6-digit code"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xl font-bold tracking-[0.2em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                            <button type="submit" disabled={adminSetupCode.length !== 6} className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50">
                              Verify authenticator
                            </button>
                          </form>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRequiredAdminSetup(adminChallengeToken).catch((setupError) => setError(setupError.message || 'Could not start authenticator setup.'))}
                          className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-semibold"
                        >Retry setup</button>
                      )}
                    </>
                  )}

                  {adminLoginStep === 'setup-backup' && (
                    <>
                      <p className="mb-3 text-sm leading-6 text-slate-600">
                        Save these one-time backup codes somewhere safe. You will not be able to view them again.
                      </p>
                      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 font-mono text-sm font-bold text-slate-800">
                        {adminSetupBackupCodes.map((backupCode) => <span key={backupCode}>{backupCode}</span>)}
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-600">
                        {remainingBackupCodes ?? adminSetupBackupCodes.length} backup codes remaining.
                      </p>
                      <button type="button" onClick={completeRequiredAdminSetup} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold">
                        I saved my codes — continue
                      </button>
                    </>
                  )}

                  {adminLoginStep === 'login-success' && (
                    <>
                      <p className="text-sm leading-6 text-slate-600">
                        Verification succeeded. You have {remainingBackupCodes ?? 0} backup code{remainingBackupCodes === 1 ? '' : 's'} remaining.
                      </p>
                      <button type="button" onClick={continueAdminLogin} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold">
                        Continue
                      </button>
                    </>
                  )}

                  {(adminLoginStep === 'challenge' || !adminChallengeToken) && (
                    <>
                      {adminChallengeToken && otpMode === 'email' && maskedAdminEmail && (
                        <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" role="status">
                          Code sent to {maskedAdminEmail}
                        </p>
                      )}
                      <p className="mb-4 text-sm leading-6 text-slate-600">
                        {otpMode === 'backup'
                          ? 'Enter one unused backup code for this administrator account.'
                          : otpMode === 'email'
                            ? adminChallengeToken
                              ? 'Enter the six-digit code sent to your registered email.'
                              : <>Enter the 6-digit code sent to <span className="font-semibold text-slate-800">{otpEmail}</span>.</>
                            : 'Enter the 6-digit code from your authenticator app.'}
                      </p>

                      {adminChallengeToken && remainingBackupCodes !== null && (
                        <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                          {remainingBackupCodes} backup code{remainingBackupCodes === 1 ? '' : 's'} remaining.
                        </p>
                      )}

                      {remainingBackupCodes !== null && remainingBackupCodes <= 2 && (
                        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                          Only {remainingBackupCodes} backup code{remainingBackupCodes === 1 ? '' : 's'} remaining. Consider regenerating them after signing in.
                        </p>
                      )}

                      <form onSubmit={handleOtpSubmit} className="space-y-4">
                        <input
                          type="text"
                          inputMode={otpMode === 'backup' ? 'text' : 'numeric'}
                          maxLength={otpMode === 'backup' ? 32 : 6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(otpMode === 'backup' ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
                          placeholder={otpMode === 'backup' ? 'BACKUP-CODE' : '000000'}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xl font-bold tracking-[0.2em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <button type="submit" className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-semibold">{t('auth.verifyCode')}</button>
                      </form>
                      {otpRole === 'admin' && otpMode !== 'backup' && <button type="button" onClick={() => { setOtpMode('backup'); setOtpCode(''); setError(''); }} className="mt-4 w-full text-sm font-semibold text-blue-700 underline underline-offset-2">Use a backup code instead</button>}
                      {otpRole === 'admin' && otpMode === 'backup' && <button type="button" onClick={() => { setOtpMode('authenticator'); setOtpCode(''); setError(''); }} className="mt-4 w-full text-sm font-semibold text-blue-700 underline underline-offset-2">Use authenticator code instead</button>}
                      {adminChallengeToken && emailCodeAvailable && otpMode !== 'email' && (
                        <button
                          type="button"
                          disabled={emailCodeSending}
                          onClick={requestAdminEmailCode}
                          className="mt-3 w-full text-sm font-semibold text-blue-700 underline underline-offset-2 disabled:opacity-60"
                        >{emailCodeSending ? 'Sending email code...' : 'Email me a code instead'}</button>
                      )}
                      {adminChallengeToken && otpMode === 'email' && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setOtpMode('authenticator'); setOtpCode(''); setError(''); }}
                            className="mt-4 w-full text-sm font-semibold text-blue-700 underline underline-offset-2"
                          >Use authenticator app instead</button>
                          <button
                            type="button"
                            disabled={emailCodeCountdown > 0 || emailCodeSending}
                            onClick={requestAdminEmailCode}
                            className="mt-3 w-full text-sm font-semibold text-slate-600 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                          >
                            {emailCodeSending
                              ? 'Sending email code...'
                              : emailCodeCountdown > 0
                                ? `Resend email code in ${emailCodeCountdown}s`
                                : 'Resend email code'}
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {adminChallengeToken && adminLoginStep !== 'setup-backup' && adminLoginStep !== 'login-success' && (
                    <button type="button" onClick={restartAdminLogin} className="mt-4 w-full text-sm font-semibold text-slate-600 underline underline-offset-2">
                      Back to password and restart sign-in
                    </button>
                  )}
                </div>
              </div>
            )}

            {!showOtpModal && (
              <>
                <form onSubmit={handleSubmit} className="login-form">
                  <div className="login-field-group">
                    <input
                      id="studentId"
                      name="studentId"
                      type="text"
                      value={formData.studentId}
                      onChange={handleChange}
                      placeholder="Student ID or Email"
                      className="login-input"
                    />
                  </div>

                  <div className="login-field-group login-password-row">
                    <input
                      id="password"
                      name="password"
                      type={showPasswordLogin ? 'text' : 'password'}
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Password"
                      className="login-input login-input-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordLogin((s) => !s)}
                      className="login-password-toggle"
                    >
                      {showPasswordLogin ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <button type="submit" className="login-submit" disabled={isLoginPending}>
                    {isLoginPending ? 'Signing in…' : 'Login'}
                  </button>
                </form>

                <div className="login-forgot-password">
                  <button
                    type="button"
                    onClick={() => setShowForgotPasswordModal(true)}
                    className="login-link login-link-muted"
                  >
                    Forgot password?
                  </button>
                </div>

                <div className="login-divider">
                  <span>OR</span>
                </div>

                <div className="login-socials">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="login-social-btn"
                    disabled={isGoogleRedirecting}
                  >
                    <svg viewBox="0 0 24 24" className="login-social-icon" aria-hidden="true">
                      <path fill="#4285F4" d="M21.35 12.23c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z" />
                      <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.7-1.72-5.47-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.6Z" />
                      <path fill="#FBBC05" d="M6.53 13.69a5.86 5.86 0 0 1 0-3.38V7.78H3.29a9.75 9.75 0 0 0 0 8.44l3.24-2.53Z" />
                      <path fill="#EA4335" d="M12 6.28c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 3.38 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.71 5.38l3.24 2.53C7.3 8 9.46 6.28 12 6.28Z" />
                    </svg>
                    {isGoogleRedirecting ? 'Redirecting to Google…' : 'Continue with Google'}
                  </button>
                </div>

                <div className="login-register-row">
                  <span>Don't have an account?</span>
                  <button type="button" onClick={onToggleRegister} className="login-link">
                    Create account
                  </button>
                </div>
              </>
            )}
          </div>
        </main>

        <footer className="login-footer">© All rights reserved by UniXchange</footer>
      </div>

      {(showTerms || showPrivacy || showHelp) && (
        <AuthInfoModal
          type={showTerms ? 'terms' : showPrivacy ? 'privacy' : 'help'}
          defaultStudentId={formData.studentId}
          onClose={() => {
            setShowTerms(false);
            setShowPrivacy(false);
            setShowHelp(false);
          }}
        />
      )}

      {showForgotPasswordModal && (
        <ForgotPasswordModal onClose={() => setShowForgotPasswordModal(false)} />
      )}
    </>
  );
}

export default LoginForm;
