import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IMAGE_PLACEHOLDER, resolveImageUrl } from '../../config';
import { isOrderRefunded, shouldShowReceiptActions } from '../../utils/orderReceiptState';

const TIMELINE = [
  { key: 'created', label: 'Placed' },
  { key: 'payment', label: 'Paid with Chapa' },
  { key: 'completed', label: 'Completed' },
];

const formatPrice = (value) => `${Number(value || 0).toLocaleString('en-ET', { maximumFractionDigits: 2 })} ETB`;
const formatReceiptPrice = (value) => `${Number(value || 0).toLocaleString('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
const formatDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function PrintableReceipt({ receipt, includeBuyerEmail = false, supportEmail = 'support@campus.edu.et' }) {
  if (!receipt) return null;

  const money = formatReceiptPrice;
  const date = formatDateTime(receipt.payment_date || receipt.order_date) || 'Date unavailable';
  const field = (label, value, emphasis = false) => (
    <div className="printable-receipt__field">
      <dt>{label}</dt>
      <dd className={emphasis ? 'printable-receipt__value--emphasis' : ''}>{value || 'Unavailable'}</dd>
    </div>
  );

  return (
    <article id="printable-receipt" className="printable-receipt">
      <header className="printable-receipt__header">
        <div className="printable-receipt__brand">
          <span className="printable-receipt__logo" aria-hidden="true">UX</span>
          <div>
            <h1>UniXchange</h1>
            <p>PAYMENT RECEIPT</p>
          </div>
        </div>
        <span className="printable-receipt__badge">✓ PAYMENT SUCCESSFUL</span>
      </header>

      <section className="printable-receipt__details" aria-label="Receipt details">
        <dl>
          {field('Receipt #', receipt.receipt_number)}
          {field('Order #', receipt.order_number ? `#${receipt.order_number}` : '')}
          {field('Paid on', date)}
          {field('Quantity', receipt.quantity)}
          {field('Product', receipt.product_name)}
          {field('Item total', money(receipt.item_total))}
          {field('Unit price', money(receipt.unit_price))}
          {field('Total paid', money(receipt.total_paid), true)}
          {field(receipt.platform_commission_label || 'Platform commission (deducted from seller payout)', money(receipt.fees))}
          {field('Reference', receipt.transaction_reference)}
          {field('Payment method', receipt.payment_method)}
          {field('Seller', receipt.seller_name)}
          {field('Buyer', receipt.buyer_name)}
          {includeBuyerEmail && field('Buyer Email', receipt.buyer_email || 'N/A')}
          {field('Payment status', String(receipt.payment_status || '').toUpperCase())}
          {field('Order status', String(receipt.order_status || '').toUpperCase())}
        </dl>
      </section>

      <div className="printable-receipt__divider" />
      <p className="printable-receipt__note">{receipt.payment_message}</p>
      <div className="printable-receipt__divider" />

      <footer className="printable-receipt__footer">
        <strong>Thank you for using UniXchange</strong>
        <span>Questions or support: <a href={`mailto:${supportEmail}`} className="underline">{supportEmail}</a></span>
        <span>Keep this receipt for your records.</span>
      </footer>
    </article>
  );
}

function OrderDetailsView({ order, role = 'buyer', loading = false, error = '', onBack, onRefresh, onRaiseDispute, onViewSellerProfile, onDisputeResponse, paymentReceipt = null, paymentReceiptLoading = false, paymentReceiptError = '', onViewReceipt, onDownloadReceipt, onPrintReceipt, reviewRating = 5, setReviewRating, reviewComment = '', setReviewComment, onSubmitReview, isSubmittingReview = false, reviewFeedback = '', supportEmail = 'support@campus.edu.et' }) {
  const [sellerResponse, setSellerResponse] = useState('');
  const [sellerResponseError, setSellerResponseError] = useState('');
  const [sellerResponseLoading, setSellerResponseLoading] = useState(false);
  const [sellerEvidenceFiles, setSellerEvidenceFiles] = useState([]);
  const [referenceCopied, setReferenceCopied] = useState(false);

  const normalizeDisputeEvidence = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
        if (typeof parsed === 'string' && parsed.trim()) return [parsed];
      } catch {
        return [trimmed];
      }
      return [trimmed];
    }
    return [String(value)];
  };

  const normalizeDisputeThread = (disputeRecord) => {
    const parseThreadPayload = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value !== 'string') return [];
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const candidateThread = parseThreadPayload(disputeRecord?.dispute_thread)
      .length > 0 ? parseThreadPayload(disputeRecord?.dispute_thread)
      : parseThreadPayload(disputeRecord?.thread).length > 0 ? parseThreadPayload(disputeRecord?.thread)
        : parseThreadPayload(disputeRecord?.conversation).length > 0 ? parseThreadPayload(disputeRecord?.conversation)
          : [];

    if (candidateThread.length > 0) {
      const seenIds = new Set();
      return candidateThread
        .filter((entry) => entry && (entry.message || entry.text || entry.body))
        .map((entry, index) => {
          const message = entry.message ?? entry.text ?? entry.body ?? '';
          const attachments = Array.isArray(entry.attachments)
            ? entry.attachments
            : Array.isArray(entry.evidence)
              ? entry.evidence
              : [];
          const sender = String(entry.sender || entry.author || (entry.role === 'buyer' ? 'Buyer' : 'Seller') || 'Seller');
          const baseId = entry.id || `${(sender || 'message').toLowerCase()}-${index}`;
          let finalId = baseId;
          let suffix = 1;
          while (seenIds.has(finalId)) {
            finalId = `${baseId}-${suffix}`;
            suffix += 1;
          }
          seenIds.add(finalId);
          return {
            id: finalId,
            sender: sender.charAt(0).toUpperCase() + sender.slice(1),
            role: String(entry.role || (sender.toLowerCase().includes('buyer') ? 'buyer' : 'seller')).toLowerCase(),
            message: String(message),
            created_at: entry.created_at || disputeRecord?.updated_at || disputeRecord?.created_at,
            attachments: attachments.filter(Boolean),
          };
        });
    }

    const thread = [];
    const buyerMessage = String(disputeRecord?.description || order?.dispute_description || '').trim();
    if (buyerMessage) {
      thread.push({
        id: `buyer-${disputeRecord?.id || order?.id || 'initial'}-${thread.length}`,
        sender: 'Buyer',
        role: 'buyer',
        message: buyerMessage,
        created_at: disputeRecord?.created_at || order?.dispute_created_at,
        attachments: normalizeDisputeEvidence(disputeRecord?.evidence_image || order?.dispute_evidence || []),
      });
    }

    const sellerResponsePayload = parseThreadPayload(disputeRecord?.seller_response);
    if (sellerResponsePayload.length > 0) {
      sellerResponsePayload.forEach((entry, index) => {
        if (!entry || !(entry.message || entry.text || entry.body)) return;
        thread.push({
          id: entry.id || `seller-${disputeRecord?.id || order?.id || 'response'}-${index}-${thread.length}`,
          sender: String(entry.sender || entry.author || 'Seller'),
          role: String(entry.role || 'seller').toLowerCase(),
          message: String(entry.message ?? entry.text ?? entry.body ?? ''),
          created_at: entry.created_at || disputeRecord?.updated_at || disputeRecord?.created_at,
          attachments: Array.isArray(entry.attachments) ? entry.attachments : Array.isArray(entry.evidence) ? entry.evidence : [],
        });
      });
    } else {
      const sellerMessage = String(disputeRecord?.seller_response || '').trim();
      if (sellerMessage && !sellerMessage.startsWith('[')) {
        thread.push({
          id: `seller-${disputeRecord?.id || order?.id || 'response'}-${thread.length}`,
          sender: 'Seller',
          role: 'seller',
          message: sellerMessage,
          created_at: disputeRecord?.updated_at || disputeRecord?.created_at,
          attachments: normalizeDisputeEvidence(disputeRecord?.seller_evidence || []),
        });
      }
    }

    const seenIds = new Set();
    return thread.map((message, index) => {
      const baseId = message.id || `${message.role || 'message'}-${index}`;
      let finalId = baseId;
      let suffix = 1;
      while (seenIds.has(finalId)) {
        finalId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      seenIds.add(finalId);
      return { ...message, id: finalId };
    });
  };
  if (loading) return <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center font-semibold text-slate-600">Loading order details...</div>;
  if (error) return <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-8 text-center text-rose-700"><p className="font-bold">Unable to load this order</p><p className="mt-2 text-sm">{error}</p><button type="button" onClick={onBack} className="mt-5 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">Back to orders</button></div>;
  if (!order) return <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">Order not found.</div>;

  const rawStatus = order.status || order.fulfillment_status || 'Pending';
  const normalizedRawStatus = String(rawStatus).trim().toLowerCase();
  const isLegacyPrePaymentStatus = [
    'pending',
    'waiting for acceptance',
    'accepted',
    'processing',
    'ready for pickup',
    'ready_for_pickup',
    'ready to meet',
    'out for delivery',
    'cancelled',
    'canceled',
    'expired',
    'returned',
  ].includes(normalizedRawStatus);
  const status = isLegacyPrePaymentStatus ? 'Legacy order' : rawStatus;
  const isSellerRejected = String(status).toLowerCase() === 'rejected';
  const statusLabel = isSellerRejected ? 'Legacy rejected order' : status;
  const paymentStatus = order.payment_status || order.pay_status || 'Pending';
  const normalizedPaymentStatus = String(paymentStatus).toLowerCase();
  const paymentSuccessful = normalizedPaymentStatus === 'successful';
  const paymentRefunded = normalizedPaymentStatus === 'refunded';
  const timeline = TIMELINE;
  let currentIndex = paymentSuccessful ? 1 : 0;
  if (status === 'Completed') currentIndex = 2;
  const quantity = Number(order.quantity || 1);
  const itemTotal = Number(order.item_total ?? Number(order.price || 0) * quantity);
  const totalPaid = Number(paymentReceipt?.total_paid ?? itemTotal + Number(order.fees || 0));
  const isBuyer = role === 'buyer';
  const showReceiptActions = shouldShowReceiptActions(order, role);
  const refundReference = order.refund_reference || `REFUND-${order.id}`;
  const refundDate = formatDateTime(order.refund_date || order.expired_at || order.updated_at);
  const dispute = order.dispute;
  const hasDispute = order.dispute_status !== null && order.dispute_status !== undefined;
  const hasActiveDispute = ['OPEN', 'UNDER_REVIEW'].includes(String(order.dispute_status || dispute?.status || '').toUpperCase());
  const canDispute = isBuyer && !hasActiveDispute && status === 'Completed' && Boolean(order.can_report_problem);
  const isRefunded = isOrderRefunded(order) || ['REFUNDED', 'REFUND'].includes(String(order.payment_status || order.payout_status || '').toUpperCase());
  const paymentHeading = hasActiveDispute ? 'Seller funds frozen - under review' : isRefunded ? 'Payment refunded' : paymentSuccessful ? 'Payment completed' : paymentStatus;
  const paymentMessage = hasActiveDispute
    ? 'The seller’s received amount is frozen while an administrator reviews the report.'
    : isRefunded
      ? 'This legacy order was refunded to the buyer.'
      : paymentSuccessful
        ? 'Payment was completed for this order.'
        : 'No payment has been recorded for this legacy order.';
  const submitSellerResponse = async (event) => {
    event.preventDefault();
    const response = sellerResponse.trim();
    if (!response || sellerResponseLoading || !onDisputeResponse || !dispute?.id) return;
    setSellerResponseLoading(true);
    setSellerResponseError('');
    try {
      await onDisputeResponse(dispute, response, sellerEvidenceFiles);
      setSellerResponse('');
      setSellerEvidenceFiles([]);
    } catch (responseError) {
      setSellerResponseError(responseError.message || 'Unable to submit your response.');
    } finally {
      setSellerResponseLoading(false);
    }
  };

  const copyPaymentReference = async () => {
    if (!paymentReceipt?.transaction_reference || !navigator.clipboard) return;
    await navigator.clipboard.writeText(paymentReceipt.transaction_reference);
    setReferenceCopied(true);
    window.setTimeout(() => setReferenceCopied(false), 1600);
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to {isBuyer ? 'My Orders' : 'Seller Orders'}
      </button>

      <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white text-slate-900 shadow-[0_12px_40px_rgba(15,23,42,0.07)]">
        <header className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-sky-50/70 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">Order summary</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Order #{order.id}</h1>
            <p className="mt-2 text-sm text-slate-500">Placed {formatDate(order.created_at)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3.5 py-2 text-xs font-bold text-indigo-800">Order: {statusLabel}</span>
            <span className={`rounded-full border px-3.5 py-2 text-xs font-bold ${paymentSuccessful ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : paymentRefunded ? 'border-rose-100 bg-rose-50 text-rose-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
              Payment: {paymentRefunded ? 'Refunded' : paymentSuccessful ? 'Successful (Chapa Split)' : paymentStatus}
            </span>
            <button type="button" onClick={onRefresh} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 transition hover:border-sky-200 hover:text-sky-800">
              Refresh
            </button>
          </div>
        </header>

        <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Order tracking</p>
          <ol className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
            {timeline.map((step, index) => {
              const complete = status === 'Disputed' ? index < currentIndex : index <= currentIndex;
              const markerStyle = isSellerRejected
                ? 'bg-rose-500 text-white'
                : complete
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-400';
              const labelStyle = isSellerRejected
                ? 'text-rose-700'
                : complete
                  ? 'text-slate-800'
                  : 'text-slate-400';
              return (
                <li key={step.key} className="flex min-w-0 flex-1 items-center">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${markerStyle}`}>
                      {complete ? '✓' : index + 1}
                    </span>
                    <span className={`text-xs font-bold sm:text-sm ${labelStyle}`}>{index + 1}. {step.label}</span>
                  </div>
                  {index < timeline.length - 1 && <span className={`ml-3 h-px flex-1 sm:mx-4 ${index < currentIndex ? 'bg-emerald-300' : 'bg-slate-200'}`} aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]">
          <section className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Purchased item</p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row">
              <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                {order.image
                  ? <img src={resolveImageUrl(order.image)} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} alt={order.title || order.product_title || 'Order item'} className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">No image</div>}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black text-slate-950 sm:text-xl">{order.title || order.product_title || 'Campus Purchase'}</h2>
                <p className="mt-1 text-sm text-slate-500">{order.condition ? `Condition: ${order.condition}` : 'Campus marketplace item'}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">Quantity</p><p className="mt-1 font-bold text-slate-900">{quantity}</p></div>
                  <div><p className="text-xs text-slate-500">Unit price</p><p className="mt-1 font-bold text-slate-900">{formatPrice(order.price)}</p></div>
                  <div><p className="text-xs text-slate-500">Item total</p><p className="mt-1 font-bold text-slate-900">{formatPrice(itemTotal)}</p></div>
                  <div><p className="text-xs text-slate-500">Completed</p><p className="mt-1 font-bold text-slate-900">{formatDateTime(order.completed_at || order.paid_at) || 'Date unavailable'}</p></div>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-slate-500">{isBuyer ? 'Seller' : 'Buyer'}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-black uppercase text-sky-700">
                    {String(isBuyer ? (order.seller_name || 'Campus Seller') : (order.buyer_name || order.buyer_id || 'Student')).split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-slate-900">{isBuyer ? (order.seller_name || 'Campus Seller') : (order.buyer_name || order.buyer_id || 'Student')}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{isBuyer ? (order.seller_business_name || 'Verified campus seller') : `Student ID: ${order.buyer_id || 'Unavailable'}`}</p>
                  </div>
                </div>
                {isBuyer && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Verified Student</span>
                    <button type="button" onClick={() => onViewSellerProfile?.(order.seller_id || order.seller)} className="text-xs font-bold text-sky-700 hover:underline">View profile</button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Payment summary</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">{paymentHeading}</h2>
              </div>
              {paymentSuccessful && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">CHAPA SPLIT</span>}
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-500">{paymentMessage}</p>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Items ({quantity})</dt><dd className="font-semibold text-slate-900">{formatPrice(itemTotal)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Fees</dt><dd className="font-semibold text-slate-900">{formatPrice(order.fees || 0)}</dd></div>
              <div className="flex justify-between gap-4 border-t border-slate-100 pt-3"><dt className="font-bold text-slate-900">Total</dt><dd className="font-black text-slate-950">{formatPrice(totalPaid)}</dd></div>
            </dl>
            {hasActiveDispute && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-semibold leading-5 text-rose-700" role="alert">The seller's received amount is frozen pending resolution.</p>}
            {isRefunded && isBuyer && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><p className="font-bold">Refund confirmation</p><p className="mt-1">{formatPrice(order.refund_amount ?? totalPaid)} refunded · {refundDate || 'Date unavailable'}</p><p className="mt-1 break-all">Reference: {refundReference}</p></div>}
            {status === 'Cancelled' && <p className="mt-4 rounded-xl bg-slate-100 p-3 text-xs font-semibold text-slate-600">This order was cancelled.</p>}
            {status === 'Disputed' && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">This order is being reviewed.</p>}
          </section>
        </div>

        <footer className="border-t border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            {isBuyer && status === 'Completed' && (
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-black text-slate-900">Rate this purchase</h2>
                  {order.reviewed && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Reviewed</span>}
                </div>
                {!order.reviewed ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1" aria-label={`Rating ${reviewRating} out of 5`}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button key={`${order.id}-detail-star-${star}`} type="button" onClick={() => setReviewRating?.(star)} className={`text-xl transition ${star <= reviewRating ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}`} aria-label={`Rate ${star} out of 5`}>★</button>
                      ))}
                    </div>
                    <textarea rows="1" value={reviewComment} onChange={(event) => setReviewComment?.(event.target.value)} placeholder="Share a few words about your purchase..." className="min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-400" />
                    <button type="button" onClick={() => onSubmitReview?.(order.id)} disabled={isSubmittingReview} className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-50">{isSubmittingReview ? 'Submitting...' : 'Submit rating'}</button>
                  </div>
                ) : <p className="mt-1 text-xs text-slate-500">Thanks for sharing your feedback.</p>}
                {reviewFeedback && <p className="mt-2 text-xs font-semibold text-sky-700" role="status">{reviewFeedback}</p>}
              </div>
            )}
            {showReceiptActions && (
              <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                <button type="button" onClick={() => onViewReceipt?.(order.id)} disabled={paymentReceiptLoading} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">{paymentReceiptLoading ? 'Loading...' : 'View Receipt'}</button>
                <button type="button" onClick={() => onDownloadReceipt?.(order.id)} disabled={paymentReceiptLoading} className="rounded-full bg-sky-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-sky-800 disabled:opacity-60">Download Official Receipt (PDF)</button>
                <button type="button" onClick={() => onPrintReceipt?.(order.id)} disabled={paymentReceiptLoading} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">Print</button>
              </div>
            )}
          </div>
          {paymentReceiptError && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700" role="alert">{paymentReceiptError}</p>}
          {paymentReceipt && showReceiptActions && <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black uppercase tracking-[0.12em] text-slate-950">Campus Market</p><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600">Payment Receipt</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">✓ PAYMENT SUCCESSFUL</span></div>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              <p>Receipt #: <strong className="text-slate-900">{paymentReceipt.receipt_number}</strong></p><p>Order #: <strong className="text-slate-900">{paymentReceipt.order_number}</strong></p>
              <p>Paid on: <strong className="text-slate-900">{formatDateTime(paymentReceipt.payment_date || paymentReceipt.order_date) || 'Date unavailable'}</strong></p>
              <p>Product: <strong className="text-slate-900">{paymentReceipt.product_name}</strong></p><p>Quantity: <strong className="text-slate-900">{paymentReceipt.quantity}</strong></p>
              <p>Unit price: <strong className="text-slate-900">{formatPrice(paymentReceipt.unit_price)}</strong></p><p>Item total: <strong className="text-slate-900">{formatPrice(paymentReceipt.item_total)}</strong></p>
              <p>{paymentReceipt.platform_commission_label || 'Platform commission'}: <strong className="text-slate-900">{formatReceiptPrice(paymentReceipt.fees)}</strong></p><p>Total paid: <strong className="text-slate-900">{formatReceiptPrice(paymentReceipt.total_paid)}</strong></p>
              <p>Payment method: <strong className="text-slate-900">{paymentReceipt.payment_method}</strong></p>
              <p className="flex items-center gap-2">Reference: <strong className="break-all text-slate-900">{paymentReceipt.transaction_reference}</strong><button type="button" onClick={copyPaymentReference} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-700">{referenceCopied ? 'Copied' : 'Copy'}</button></p>
              <p>Buyer: <strong className="text-slate-900">{paymentReceipt.buyer_name}</strong></p>
              {isBuyer && <p>Buyer Email: <strong className="text-slate-900">{paymentReceipt.buyer_email || 'N/A'}</strong></p>}
              <p>Seller: <strong className="text-slate-900">{paymentReceipt.seller_name}</strong></p>
              <p>Order status: <strong className="text-slate-900">{String(paymentReceipt.order_status || '').toUpperCase()}</strong></p><p>Payment status: <strong className="text-slate-900">{String(paymentReceipt.payment_status || '').toUpperCase()}</strong></p>
              {paymentReceipt.dispute_status && <p>Dispute: <strong className="text-slate-900">{paymentReceipt.dispute_status}</strong></p>}
            </div>
            <p className="mt-4 text-xs font-semibold leading-5 text-slate-600">{paymentReceipt.payment_message}</p>
          </div>}
        </footer>
      </section>
      {hasDispute && (<section className="rounded-[28px] border border-rose-200 bg-rose-50/60 p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-600">Dispute</p><h2 className="mt-1 text-xl font-black text-slate-950">Dispute Status</h2></div>
          {dispute && <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black uppercase text-rose-700">{hasActiveDispute ? 'Open' : dispute.status}</span>}
        </div>
        {!dispute && isBuyer && canDispute && <button type="button" onClick={() => onRaiseDispute?.(order)} className="mt-5 rounded-full border border-rose-200 bg-white px-5 py-3 text-sm font-black text-rose-700 hover:bg-rose-100">Raise Dispute</button>}
        {!dispute && status === 'Disputed' && <p className="mt-5 rounded-2xl bg-white p-4 text-sm font-black text-rose-700">Dispute Open</p>}
        {dispute && <>
          <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><p className="text-slate-500">Reason</p><p className="mt-1 font-black text-slate-900">{dispute.reason || order.dispute_reason || 'Not provided'}</p></div><div><p className="text-slate-500">Submitted</p><p className="mt-1 font-black text-slate-900">{formatDate(dispute.created_at || order.dispute_created_at)}</p></div></div>
          <div className="mt-4 space-y-4 rounded-2xl bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Conversation thread</p>
            {(() => {
              const thread = normalizeDisputeThread(dispute);
              return thread.length > 0 ? (
                <div className="space-y-4">
                  {thread.map((message) => (
                    <div key={message.id} className={`rounded-2xl border p-4 ${message.role === 'buyer' ? 'border-sky-200 bg-sky-50' : 'border-rose-200 bg-rose-50'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{message.sender}</p>
                        {message.created_at && <time className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{formatDateTime(message.created_at)}</time>}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.message}</p>
                      {message.attachments?.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {message.attachments.map((image, index) => (
                            <a key={`${image}-${index}`} href={image} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                              <img src={resolveImageUrl(image)} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = IMAGE_PLACEHOLDER; }} alt={`${message.sender} evidence ${index + 1}`} className="h-24 w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-6 text-slate-700">No dispute conversation recorded yet.</p>
              );
            })()}
          </div>
          {!isBuyer && hasActiveDispute && !dispute.seller_response && onDisputeResponse && <form onSubmit={submitSellerResponse} className="mt-4"><label htmlFor="seller-dispute-response" className="text-sm font-bold text-slate-700">Your response</label><textarea id="seller-dispute-response" rows="4" value={sellerResponse} onChange={(event) => setSellerResponse(event.target.value)} placeholder="Explain your side of the order dispute..." className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-rose-400" /><div className="mt-4"><label className="text-sm font-bold text-slate-700">Evidence images <span className="font-normal text-slate-400">(optional)</span></label><input type="file" multiple accept="image/*" onChange={(event) => setSellerEvidenceFiles(Array.from(event.target.files || []))} className="mt-2 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-700" /><div className="mt-3 grid grid-cols-3 gap-2">{sellerEvidenceFiles.map((file, index) => <div key={`${file.name}-${index}`} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><img src={URL.createObjectURL(file)} alt={`Seller evidence preview ${index + 1}`} className="h-20 w-full object-cover" /><button type="button" onClick={() => setSellerEvidenceFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-[10px] font-bold text-white">Remove</button></div>)}</div></div><div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" disabled={sellerResponseLoading || sellerResponse.trim().length < 20} className="rounded-full bg-rose-600 px-5 py-3 text-sm font-black text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">{sellerResponseLoading ? 'Submitting...' : 'Submit Response'}</button>{sellerResponseError && <p className="text-sm font-bold text-rose-700">{sellerResponseError}</p>}</div></form>}
        </>}
      </section>)}
      <PrintableReceipt receipt={showReceiptActions ? paymentReceipt : null} includeBuyerEmail={isBuyer} supportEmail={supportEmail} />
    </div>
  );
}

export default OrderDetailsView;
