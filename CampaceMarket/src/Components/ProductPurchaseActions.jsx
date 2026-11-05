export default function ProductPurchaseActions({
  isOwner = false,
  isSoldOut = false,
  isInCart = false,
  cartReady = true,
  cartError = false,
  isAddingToCart = false,
  addDisabled = false,
  payDisabled = false,
  onAddToCart,
  onPay,
  wishlistAction,
  className = 'grid grid-cols-1 gap-2',
  addButtonClassName = 'btn-primary w-full rounded-full px-3 py-2 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50',
  payButtonClassName = 'w-full rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50',
  statusClassName = 'rounded-2xl border px-3 py-2 text-center text-xs font-bold',
}) {
  return (
    <div className={className}>
      {isOwner ? (
        <span className={`${statusClassName} border-emerald-200 bg-emerald-50 text-emerald-800`}>
          This is your listing
        </span>
      ) : isSoldOut ? (
        <span className={`${statusClassName} border-rose-200 bg-rose-50 text-rose-700`}>
          Sold out
        </span>
      ) : cartError ? (
        <p className="text-center text-xs font-semibold text-rose-700">
          Unable to verify your cart. Please refresh and try again.
        </p>
      ) : !cartReady ? (
        <button type="button" disabled className={`${addButtonClassName} bg-slate-200 text-slate-500`}>
          Checking cart...
        </button>
      ) : isInCart ? (
        <>
          <span className="text-center text-[11px] font-semibold text-emerald-700">In cart</span>
          <button
            type="button"
            onClick={onPay}
            disabled={payDisabled}
            className={payButtonClassName}
          >
            Pay with Chapa
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onAddToCart}
          disabled={addDisabled || isAddingToCart}
          className={addButtonClassName}
        >
          {isAddingToCart ? 'Adding...' : 'Add to Cart'}
        </button>
      )}
      {!isOwner && wishlistAction}
    </div>
  );
}
