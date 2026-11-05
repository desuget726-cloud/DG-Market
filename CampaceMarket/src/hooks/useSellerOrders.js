import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../config';

const ORDER_QUERY_KEYS = {
  page: 'orders_page',
  search: 'orders_search',
  dateFrom: 'orders_date_from',
  dateTo: 'orders_date_to',
};

const readFiltersFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const parsedPage = Number(params.get(ORDER_QUERY_KEYS.page));
  return {
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    search: params.get(ORDER_QUERY_KEYS.search) || '',
    dateFrom: params.get(ORDER_QUERY_KEYS.dateFrom) || '',
    dateTo: params.get(ORDER_QUERY_KEYS.dateTo) || '',
  };
};

const writeFiltersToUrl = (filters) => {
  const url = new URL(window.location.href);
  Object.entries(ORDER_QUERY_KEYS).forEach(([filter, queryKey]) => {
    const value = filter === 'page' && filters[filter] === 1
      ? ''
      : String(filters[filter] || '').trim();
    if (value) url.searchParams.set(queryKey, value);
    else url.searchParams.delete(queryKey);
  });
  window.history.replaceState(window.history.state, '', url);
};

export function useSellerOrders({ token, enabled = true } = {}) {
  const [filters, setFilters] = useState(readFiltersFromUrl);
  const [pageData, setPageData] = useState({ items: [], total: 0, page: 1, page_size: 10 });
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const syncFiltersFromHistory = () => setFilters(readFiltersFromUrl());
    window.addEventListener('popstate', syncFiltersFromHistory);
    return () => window.removeEventListener('popstate', syncFiltersFromHistory);
  }, []);

  const updateFilters = useCallback((changes) => {
    setFilters((current) => {
      const next = { ...current, ...changes };
      writeFiltersToUrl(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const query = new URLSearchParams({
      page: String(filters.page),
      page_size: String(pageData.page_size || 10),
    });
    if (filters.search.trim()) query.set('search', filters.search.trim());
    if (filters.dateFrom) query.set('date_from', filters.dateFrom);
    if (filters.dateTo) query.set('date_to', filters.dateTo);

    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        if (!hasLoadedRef.current) setLoading(true);
        setError('');
        return fetch(`${API_BASE_URL}/api/seller/orders?${query.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
      })
      .then(async (response) => {
        if (!response) return null;
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.detail || 'Unable to load completed orders.');
        return result;
      })
      .then((result) => {
        if (result) {
          setPageData(result);
          setHasLoaded(true);
          hasLoadedRef.current = true;
        }
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Unable to load completed orders.');
          setHasLoaded(true);
          hasLoadedRef.current = true;
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, filters, pageData.page_size, retryCount, token]);

  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible') setRetryCount((count) => count + 1);
    };
    const pollId = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  return {
    filters,
    updateFilters,
    pageData,
    loading: loading || (enabled && !hasLoaded),
    error,
    retry,
  };
}
