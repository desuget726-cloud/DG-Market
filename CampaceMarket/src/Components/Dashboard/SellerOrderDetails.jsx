import { useEffect, useState } from 'react';
import { API_BASE_URL, IMAGE_PLACEHOLDER, resolveImageUrl, SHOW_REPORT_PROBLEM } from '../../config';
import { useLanguage } from '../../context/LanguageContext';
import { buildPaymentReceiptPdf, paymentReceiptPdfFilename } from '../../utils/paymentReceiptPdf';

const formatEtb = (value, language) => (
  `${Number(value || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-ET')} ETB`
);

const formatDateTime = (value, language, unavailable) => {
  if (!value) return unavailable;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? unavailable
    : date.toLocaleString(language === 'am' ? 'am-ET' : 'en-ET');
};

const formatTimeRemaining = (deadline, now, language) => {
  const remaining = new Date(deadline).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return '';
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  if (language === 'am') return `${hours} ሰዓት ${minutes} ደቂቃ`;
  return `${hours}h ${minutes}m`;
};

function SellerOrderDetails({
  order,
  loading,
  error,
  onRetry,
  onBack,
  onDisputeResponse,
  onOpenChat,
  sessionToken,
}) {
  const { t, language } = useLanguage();
  const [activeImage, setActiveImage] = useState(0);
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [responseError, setResponseError] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [paymentReceiptLoading, setPaymentReceiptLoading] = useState(false);
  const [paymentReceiptError, setPaymentReceiptError] = useState('');
  const [now, setNow] = useState(null);
  const unavailable = t('sellerOrders.unavailable');

  useEffect(() => {
    const initialTime = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => {
      window.clearTimeout(initialTime);
      window.clearInterval(timer);
    };
  }, []);

  const submitResponse = async (event) => {
    event.preventDefault();
    if (!order?.dispute || submittingResponse) return;
    setSubmittingResponse(true);
    setResponseError('');
    try {
      await onDisputeResponse(order.dispute, responseText, evidenceFiles);
      setResponseText('');
      setEvidenceFiles([]);
      setShowResponseForm(false);
    } catch (submitError) {
      setResponseError(submitError.message || unavailable);
    } finally {
      setSubmittingResponse(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5" aria-label={t('sellerOrders.loading')} role="status">
        <div className="h-10 w-40 animate-pulse rounded-full bg-slate-200" />
        <div className="h-40 animate-pulse rounded-[28px] bg-slate-100" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-52 animate-pulse rounded-[28px] bg-slate-100" />
          <div className="h-52 animate-pulse rounded-[28px] bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-center text-rose-700" role="alert">
        <p className="font-bold">{error || unavailable}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={onRetry} className="rounded-full bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-800">
            {t('sellerOrders.retryDetails')}
          </button>
          <button type="button" onClick={onBack} className="rounded-full border border-rose-300 px-4 py-2 text-sm font-bold text-rose-800">
            {t('sellerOrders.backToOrders')}
          </button>
        </div>
      </section>
    );
  }

  const product = order.product || {};
  const payment = order.payment || {};
  const buyer = order.buyer || {};
  const timeline = order.timeline || {};
  const paymentSettled = ['successful', 'success', 'paid', 'completed']
    .includes(String(payment.payment_status || '').trim().toLowerCase());
  const images = Array.isArray(product.images) && product.images.length ? product.images : [IMAGE_PLACEHOLDER];
  const dispute = order.dispute;
  const responseRemaining = dispute?.response_deadline
    ? formatTimeRemaining(dispute.response_deadline, now || 0, language)
    : '';
  const reportWindowRemaining = order.report_window_ends_at
    ? formatTimeRemaining(order.report_window_ends_at, now || 0, language)
    : '';
  const fetchPaymentReceipt = async () => {
    if (paymentReceipt) return paymentReceipt;
    setPaymentReceiptLoading(true);
    setPaymentReceiptError('');
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/student/orders/${encodeURIComponent(order.id)}/receipt`,
        { headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {} },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Unable to load the payment receipt.');
      setPaymentReceipt(result);
      return result;
    } catch (receiptError) {
      setPaymentReceiptError(receiptError.message || 'Unable to load the payment receipt.');
      throw receiptError;
    } finally {
      setPaymentReceiptLoading(false);
    }
  };
  const downloadPaymentReceipt = async () => {
    const receipt = await fetchPaymentReceipt();
    buildPaymentReceiptPdf(receipt).save(paymentReceiptPdfFilename(receipt.order_number));
  };

  const timelineEvents = [
    ['orderCreated', timeline.order_created_at],
    ['paymentCompleted', timeline.payment_completed_at],
    ['orderCompleted', timeline.order_completed_at],
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
      >
        <span aria-hidden="true">←</span>
        {t('sellerOrders.backToOrders')}
      </button>

      <header className="flex flex-wrap items-end justify-between gap-4 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">
            {t('sellerOrders.detailsTitle')}
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">#{order.id}</h1>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={`rounded-full border px-4 py-2 text-sm font-bold ${
            paymentSettled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          {paymentSettled ? 'Payment Received / Order Settled' : 'Payment not confirmed'}
        </span>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-xl font-black text-slate-950">{t('sellerOrders.productDetails')}</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <img
                src={resolveImageUrl(images[activeImage])}
                alt={product.name || t('sellerOrders.productDetails')}
                onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }}
                className="aspect-[4/3] w-full rounded-2xl bg-slate-100 object-cover"
              />
              {images.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {images.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      aria-label={`${t('sellerOrders.productDetails')} ${index + 1}`}
                      aria-pressed={activeImage === index}
                      onClick={() => setActiveImage(index)}
                      className={`shrink-0 rounded-xl border-2 p-0.5 ${activeImage === index ? 'border-sky-600' : 'border-transparent'}`}
                    >
                      <img src={resolveImageUrl(image)} alt="" className="h-14 w-16 rounded-lg object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-950">{product.name || unavailable}</h3>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('sellerOrders.description')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{product.description || unavailable}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">{t('sellerOrders.category')}</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{product.category || unavailable}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('sellerOrders.quantity')}</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{product.quantity || 1}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('sellerOrders.unitPrice')}</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{formatEtb(product.unit_price, language)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-xl font-black text-slate-950">{t('sellerOrders.payment')}</h2>
            <div className={`mt-4 rounded-2xl p-3 text-sm font-bold ${
              paymentSettled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
            }`}>
              {paymentSettled
                ? 'Payment received. The order is settled and ready for handover.'
                : 'Do not hand over the item until payment is confirmed.'}
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                [t('sellerOrders.itemPrice'), formatEtb(payment.item_price, language)],
                [t('sellerOrders.fees'), formatEtb(payment.fees, language)],
                [t('sellerOrders.totalReceived'), formatEtb(payment.total_received, language)],
                [t('sellerOrders.paymentStatus'), payment.payment_status || unavailable],
                [t('sellerOrders.paymentTime'), formatDateTime(payment.paid_at, language, unavailable)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            {paymentSettled && (
              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fetchPaymentReceipt().catch(() => {})}
                    disabled={paymentReceiptLoading}
                    className="rounded-full bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-60"
                  >
                    {paymentReceiptLoading ? 'Loading receipt…' : 'View official receipt'}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadPaymentReceipt().catch((receiptError) => {
                      setPaymentReceiptError(receiptError.message || 'Unable to download the payment receipt.');
                    })}
                    disabled={paymentReceiptLoading}
                    className="rounded-full border border-slate-300 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Download receipt
                  </button>
                </div>
                {paymentReceiptError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{paymentReceiptError}</p>}
                {paymentReceipt && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                    <p className="font-black uppercase tracking-wide text-emerald-800">Official payment receipt · {paymentReceipt.receipt_number}</p>
                    <p className="mt-2">Order #{paymentReceipt.order_number} · {paymentReceipt.product_name}</p>
                    <p className="mt-1">Total paid: <strong>{formatEtb(paymentReceipt.total_paid, language)}</strong></p>
                    <p className="mt-1 break-all">Reference: {paymentReceipt.transaction_reference}</p>
                    <p className="mt-2">{paymentReceipt.payment_message}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-xl font-black text-slate-950">{t('sellerOrders.buyer')}</h2>
            <p className="mt-3 font-bold text-slate-900">{buyer.name || unavailable}</p>
            <p className="mt-1 text-sm text-slate-600">
              {t('sellerOrders.department')}: {buyer.department || unavailable}
            </p>
            {buyer.verified_student && (
              <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                ✓ {t('sellerOrders.verifiedStudent')}
              </span>
            )}
            {order.chat_thread_id && (
              <a
                href={`/dashboard?tab=messages&conversation=${encodeURIComponent(order.chat_thread_id)}`}
                onClick={(event) => {
                  if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                    event.preventDefault();
                    onOpenChat?.(order.chat_thread_id, buyer);
                  }
                }}
                className="mt-4 inline-flex rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700"
              >
                {t('sellerOrders.openChat')}
              </a>
            )}
          </section>
        </div>
      </div>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-black text-slate-950">{t('sellerOrders.timeline')}</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {timelineEvents.map(([label, value]) => (
            <li key={label} className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-900">{t(`sellerOrders.${label}`)}</p>
              <p className="mt-2 text-sm text-slate-600">{formatDateTime(value, language, unavailable)}</p>
            </li>
          ))}
        </ol>
      </section>

      {SHOW_REPORT_PROBLEM && <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-black text-slate-950">{t('sellerOrders.dispute')}</h2>
        {dispute ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-slate-900">{dispute.category}</p>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{dispute.status}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{dispute.description}</p>
            {dispute.evidence && (
              <a
                href={resolveImageUrl(dispute.evidence)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm font-bold text-sky-700 underline"
              >
                {t('sellerOrders.evidence')}
              </a>
            )}
            <p className="text-sm text-slate-600">
              {t('sellerOrders.responseRemaining')}: {responseRemaining || unavailable}
            </p>
            {!dispute.response_deadline && (
              <p className="text-sm text-slate-600">
                {t('sellerOrders.reportWindowTime')}: {reportWindowRemaining || t('sellerOrders.reportWindowClosed')}
              </p>
            )}
            {!dispute.response_deadline || dispute.status?.toUpperCase() === 'RESOLVED' ? null : (
              <button
                type="button"
                onClick={() => setShowResponseForm((shown) => !shown)}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
              >
                {t('sellerOrders.respond')}
              </button>
            )}
            {showResponseForm && (
              <form onSubmit={submitResponse} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <label className="block text-sm font-semibold text-slate-700">
                  {t('sellerOrders.responseText')}
                  <textarea
                    required
                    minLength={20}
                    value={responseText}
                    onChange={(event) => setResponseText(event.target.value)}
                    placeholder={t('sellerOrders.responsePlaceholder')}
                    className="mt-1 min-h-28 w-full rounded-xl border border-slate-300 p-3 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  {t('sellerOrders.evidence')}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))}
                    className="mt-1 block w-full text-sm"
                  />
                </label>
                {responseError && <p role="alert" className="text-sm font-semibold text-rose-700">{responseError}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={submittingResponse} className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                    {submittingResponse ? t('sellerOrders.loading') : t('sellerOrders.submitResponse')}
                  </button>
                  <button type="button" onClick={() => setShowResponseForm(false)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
                    {t('sellerOrders.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl bg-slate-50 p-4">
            <p className="font-semibold text-slate-800">{t('sellerOrders.noIssues')}</p>
            <p className="mt-2 text-sm text-slate-600">
              {reportWindowRemaining
                ? `${t('sellerOrders.reportWindowTime')}: ${reportWindowRemaining}`
                : t('sellerOrders.reportWindowClosed')}
            </p>
          </div>
        )}
      </section>}
    </div>
  );
}

export default SellerOrderDetails;
