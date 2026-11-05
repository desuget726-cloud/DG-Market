import { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const formatAmount = (value, language) => (
  `${Number(value || 0).toLocaleString(language === 'am' ? 'am-ET' : 'en-ET')} ETB`
);

const formatDate = (value, language) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(language === 'am' ? 'am-ET' : 'en-ET');
};

function SellerCompletedOrders({
  pageData,
  filters,
  loading,
  error,
  onRetry,
  onFilterChange,
  onOpenOrder,
}) {
  const { t, language } = useLanguage();
  const [searchInput, setSearchInput] = useState(() => (
    new URLSearchParams(window.location.search).get('orders_search') || ''
  ));
  useEffect(() => {
    const syncSearchFromHistory = () => {
      setSearchInput(new URLSearchParams(window.location.search).get('orders_search') || '');
    };
    window.addEventListener('popstate', syncSearchFromHistory);
    return () => window.removeEventListener('popstate', syncSearchFromHistory);
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchInput !== filters.search) {
        onFilterChange({ search: searchInput, page: 1 });
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [filters.search, onFilterChange, searchInput]);

  const items = Array.isArray(pageData?.items) ? pageData.items : [];
  const pageSize = Number(pageData?.page_size || 10);
  const page = Number(pageData?.page || filters.page || 1);
  const total = Number(pageData?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const noFilters = !filters.search && !filters.dateFrom && !filters.dateTo;

  const openRowFromKeyboard = (event, order) => {
    if (event.target.closest('button')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenOrder(order.id);
    }
  };

  return (
    <section id="seller-orders" className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">
            {t('sellerOrders.history')}
          </p>
          <h3 className="mt-1 text-xl font-black text-slate-950">
            {t('sellerOrders.completedOrders')}
          </h3>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          {t('sellerOrders.orderCount').replace('{count}', String(total))}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">
          {t('sellerOrders.search')}
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('sellerOrders.searchPlaceholder')}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('sellerOrders.dateFrom')}
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => onFilterChange({ dateFrom: event.target.value, page: 1 })}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('sellerOrders.dateTo')}
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => onFilterChange({ dateTo: event.target.value, page: 1 })}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
        </label>
      </div>

      {loading ? (
        <div aria-label={t('sellerOrders.loading')} className="mt-5 space-y-3" role="status">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="mt-3 rounded-full bg-rose-700 px-4 py-2 font-bold text-white hover:bg-rose-800">
            {t('sellerOrders.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
          {noFilters ? t('sellerOrders.noCompletedOrders') : t('sellerOrders.noMatchingOrders')}
        </p>
      ) : (
        <>
          <div className="mt-5 w-full overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[680px] w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3">{t('sellerOrders.order')}</th>
                  <th className="whitespace-nowrap px-4 py-3">{t('sellerOrders.customer')}</th>
                  <th className="whitespace-nowrap px-4 py-3">{t('sellerOrders.product')}</th>
                  <th className="whitespace-nowrap px-4 py-3">{t('sellerOrders.amount')}</th>
                  <th className="whitespace-nowrap px-4 py-3">{t('sellerOrders.status')}</th>
                  <th className="whitespace-nowrap px-4 py-3">{t('sellerOrders.completed')}</th>
                  <th className="whitespace-nowrap px-4 py-3"><span className="sr-only">{t('sellerOrders.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => {
                  const paymentReceived = ['successful', 'success', 'paid', 'completed']
                    .includes(String(order.payment_status || '').trim().toLowerCase());
                  return (
                  <tr
                    key={order.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`${t('sellerOrders.openOrder')} #${order.id}`}
                    onClick={(event) => {
                      if (!event.target.closest('button')) onOpenOrder(order.id);
                    }}
                    onKeyDown={(event) => openRowFromKeyboard(event, order)}
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 focus-visible:outline-offset-[-2px]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-900">#{order.id}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{order.buyer_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{order.product_title}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-900">{formatAmount(order.amount, language)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        role="status"
                        aria-live="polite"
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                          paymentReceived
                            ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                            : 'border-amber-200 bg-amber-100 text-amber-900'
                        }`}
                      >
                        {paymentReceived
                          ? 'Payment Received / Order Settled'
                          : `Payment ${String(order.payment_status || 'Pending').toLowerCase()}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDate(order.completed_at, language)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenOrder(order.id);
                        }}
                        className="rounded-full border border-sky-200 px-3 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-50"
                      >
                        {t('sellerOrders.view')}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {t('sellerOrders.pageOf').replace('{page}', String(page)).replace('{pages}', String(pageCount))}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onFilterChange({ page: page - 1 })}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('sellerOrders.previous')}
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => onFilterChange({ page: page + 1 })}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('sellerOrders.next')}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default SellerCompletedOrders;
