import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import SellerOrderDetails from "./SellerOrderDetails";
import SellerCompletedOrders from "./SellerCompletedOrders";
import { useSellerOrders } from '../../hooks/useSellerOrders';
import { notifyError, notifySuccess } from '../../utils/notify';
import { API_BASE_URL, resolveImageUrl } from '../../config';
import { useLanguage } from '../../context/LanguageContext';
import { getSellerHubSections, SELLER_HUB_VIEWS, sellerHubViewReducer } from '../../utils/sellerHubViewState';

const SELLER_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 200%22%3E%3Crect width=%22320%22 height=%22200%22 fill=%22%23e2e8f0%22/%3E%3Cpath d=%22M92 145l42-48 32 35 25-27 49 40H92z%22 fill=%22%2394a3b8%22/%3E%3Ccircle cx=%22125%22 cy=%2275%22 r=%2216%22 fill=%22%2394a3b8%22/%3E%3Ctext x=%22160%22 y=%22178%22 text-anchor=%22middle%22 font-family=%22Arial%22 font-size=%2214%22 fill=%22%23475569%22%3ENo image available%3C/text%3E%3C/svg%3E";

const getSellerImage = (rawImage) => {
  let image = rawImage;
  if (typeof image === "string") {
    try {
      const parsedImage = JSON.parse(image);
      image = Array.isArray(parsedImage) ? parsedImage.find(Boolean) : image;
    } catch {
      image = image.trim();
    }
  } else if (Array.isArray(image)) {
    image = image.find(Boolean);
  }
  return typeof image === "string" && image.trim()
    ? resolveImageUrl(image.trim())
    : SELLER_IMAGE_PLACEHOLDER;
};

const formatSellerEtb = (value) =>
  `${Number(value || 0).toLocaleString("en-ET")} ETB`;

const normalizeInsightMetric = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
};

const normalizeSellerInsight = (listing) => {
  const views = normalizeInsightMetric(
    listing?.views ?? listing?.view_count,
  );
  const orders = normalizeInsightMetric(
    listing?.completed_orders ?? listing?.order_count ?? listing?.orders,
  );
  return {
    ...listing,
    views,
    orderCount: orders,
    revenue: normalizeInsightMetric(
      listing?.completed_revenue ?? listing?.revenue,
    ),
  };
};

const getSellerSessionToken = (user) => {
  const directToken = user?.access_token || user?.accessToken || user?.token || user?.session_token || user?.sessionToken;
  if (directToken) return directToken;
  if (typeof window === "undefined") return "";
  try {
    const session = JSON.parse(window.localStorage.getItem("campaceSession") || "{}");
    return session?.user?.access_token
      || session?.access_token
      || session?.user?.accessToken
      || session?.user?.token
      || session?.user?.session_token
      || session?.user?.sessionToken
      || session?.accessToken
      || session?.token
      || session?.session_token
      || session?.sessionToken
      || "";
  } catch {
    return "";
  }
};

const getInitialSellerHubView = () => {
  if (typeof window === "undefined") return SELLER_HUB_VIEWS.overview;
  const params = new URLSearchParams(window.location.search);
  if (params.get("tab") === "seller" && params.get("section") === "orders") {
    return SELLER_HUB_VIEWS.operations;
  }
  if (
    (params.get("tab") === "seller" && params.get("section") === "products")
    || params.has("page")
  ) {
    return SELLER_HUB_VIEWS.productManagement;
  }
  return SELLER_HUB_VIEWS.overview;
};

const getProductPageFromUrl = () => {
  if (typeof window === "undefined") return 1;
  const page = Number(new URLSearchParams(window.location.search).get("page"));
  return Number.isInteger(page) && page > 0 ? page : 1;
};

const getProductPaginationItems = (currentPage, totalPages) => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = [...new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ].filter((page) => page >= 1 && page <= totalPages))].sort((left, right) => left - right);

  return pages.reduce((items, page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) items.push("ellipsis");
    items.push(page);
    return items;
  }, []);
};

function SellerOperationsCenter({
  user,
  sellerData,
  sellerDashboardData,
  onRefreshOrders,
  myListings,
  onNavigate: onTabNavigate,
  onViewProduct,
  onEditProduct,
  onDeleteProduct,
  onTogglePause,
  onMarkAsSold,
  openOrderId,
  onOpenSellerOrder,
  onBackToSellerOrders,
  onOpenSellerChat,
  navigationRequest,
}) {
  const { t } = useLanguage();
  const [activeHubView, dispatchHubView] = useReducer(sellerHubViewReducer, null, getInitialSellerHubView);
  const [chartRange, setChartRange] = useState("3m");
  const [leaderboardSort, setLeaderboardSort] = useState("revenue");
  const [salesAnalyticsRetry, setSalesAnalyticsRetry] = useState(0);
  const [salesAnalyticsError, setSalesAnalyticsError] = useState("");
  const salesAnalyticsRequestId = useRef(0);
  const [salesAnalytics, setSalesAnalytics] = useState({
    points: [],
    total: 0,
    order_count: 0,
    stats: {},
    comparisons: {},
  });
  const [salesAnalyticsLoading, setSalesAnalyticsLoading] = useState(false);
  const [disputeResponseState, setDisputeResponseState] = useState({});
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderLoading, setSelectedOrderLoading] = useState(false);
  const [selectedOrderError, setSelectedOrderError] = useState("");

  useEffect(() => {
    if (!navigationRequest?.id) return;
    if (navigationRequest.destination === 'dashboard') {
      dispatchHubView({ type: 'back-to-overview' });
    } else if (navigationRequest.destination === 'listings') {
      dispatchHubView({ type: 'open-product-management' });
    } else if (navigationRequest.destination === 'orders' || navigationRequest.destination === 'analytics') {
      dispatchHubView({ type: 'open-operations' });
      const sectionId = navigationRequest.destination === 'orders' ? 'seller-orders' : 'seller-analytics';
      window.setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 0);
    }
  }, [navigationRequest]);
  const [productActionState, setProductActionState] = useState({});
  const [productActionFeedback, setProductActionFeedback] = useState(null);
  const [productPage, setProductPage] = useState({
    items: [],
    total: 0,
    page: 1,
    page_size: 10,
    total_pages: 0,
    summary: { total: 0, active: 0, sold: 0, pending: 0 },
  });
  const [productPageNumber, setProductPageNumber] = useState(getProductPageFromUrl);
  const [productPageLoading, setProductPageLoading] = useState(false);
  const [productPageError, setProductPageError] = useState("");
  const productPageRequestId = useRef(0);
  const skipNextProductPageFetch = useRef(false);
  const { overview: showOverview, productManagement: showProductManagement, operations: showOperations } = getSellerHubSections(activeHubView);
  const sessionToken = getSellerSessionToken(user);
  const updateProductPageUrl = useCallback((page, replace = false) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page));
    window.history[replace ? "replaceState" : "pushState"](
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);
  const fetchProductPage = useCallback(async (requestedPage = productPageNumber) => {
    if (!user?.studentId || !sessionToken) {
      setProductPageError("Your student session is missing. Please sign in again.");
      return;
    }
    const requestId = productPageRequestId.current + 1;
    productPageRequestId.current = requestId;
    setProductPageLoading(true);
    setProductPageError("");
    try {
      const params = new URLSearchParams({
        student_id: user.studentId,
        page: String(requestedPage),
        page_size: "10",
      });
      const response = await fetch(
        `${API_BASE_URL}/api/student/seller/products?${params.toString()}`,
        { headers: { Authorization: `Bearer ${sessionToken}` } },
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to load seller products.");
      }
      const data = await response.json();
      if (!Array.isArray(data.items) || !data.summary) {
        throw new Error("The server returned invalid seller product data.");
      }
      if (requestId !== productPageRequestId.current) return;

      const actualPage = Number(data.page) || 1;
      if (actualPage !== requestedPage) {
        updateProductPageUrl(actualPage, true);
        if (data.items.length > 0) skipNextProductPageFetch.current = true;
        setProductPageNumber(actualPage);
      }
      if (data.items.length === 0 && actualPage > 1) {
        const previousPage = actualPage - 1;
        updateProductPageUrl(previousPage, true);
        setProductPageNumber(previousPage);
      }
      setProductPage(data);
    } catch (error) {
      if (requestId === productPageRequestId.current) {
        setProductPageError(error.message || "Failed to load seller products.");
      }
    } finally {
      if (requestId === productPageRequestId.current) setProductPageLoading(false);
    }
  }, [productPageNumber, sessionToken, updateProductPageUrl, user?.studentId]);

  useEffect(() => {
    const syncPageFromUrl = () => setProductPageNumber(getProductPageFromUrl());
    window.addEventListener("popstate", syncPageFromUrl);
    return () => window.removeEventListener("popstate", syncPageFromUrl);
  }, []);

  useEffect(() => {
    if (!showProductManagement) return;
    if (skipNextProductPageFetch.current) {
      skipNextProductPageFetch.current = false;
      return;
    }
    fetchProductPage(productPageNumber);
  }, [fetchProductPage, productPageNumber, showProductManagement]);

  const goToProductPage = (page) => {
    const nextPage = Math.min(Math.max(page, 1), productPage.total_pages);
    if (nextPage === productPageNumber) return;
    updateProductPageUrl(nextPage);
    setProductPageNumber(nextPage);
  };

  const updateProductPageStatus = (productId, status) => {
    setProductPage((previous) => {
      const currentProduct = previous.items.find((item) => String(item.id) === String(productId));
      if (!currentProduct) return previous;

      const categoryFor = (item) => {
        const normalizedStatus = String(item.status || "Pending").trim().toLowerCase();
        if (normalizedStatus === "sold" || Number(item.stock ?? 0) <= 0 || item.has_completed_orders) return "sold";
        if (normalizedStatus.includes("pending")) return "pending";
        return "active";
      };
      const nextProduct = {
        ...currentProduct,
        status,
        stock: status === "Sold" ? 0 : currentProduct.stock,
        sold_via: status === "Sold" ? "Marked by Seller" : null,
      };
      const currentCategory = categoryFor(currentProduct);
      const nextCategory = categoryFor(nextProduct);
      const summary = { ...previous.summary };
      if (currentCategory !== nextCategory) {
        summary[currentCategory] = Math.max(0, Number(summary[currentCategory] || 0) - 1);
        summary[nextCategory] = Number(summary[nextCategory] || 0) + 1;
      }
      return {
        ...previous,
        summary,
        items: previous.items.map((item) => (
          String(item.id) === String(productId) ? nextProduct : item
        )),
      };
    });
  };

  const {
    filters: sellerOrderFilters,
    updateFilters: updateSellerOrderFilters,
    pageData: completedOrderPage,
    loading: completedOrdersLoading,
    error: completedOrdersError,
    retry: retryCompletedOrders,
  } = useSellerOrders({ token: sessionToken, enabled: showOperations });

  const dashboardStats = sellerDashboardData?.stats || {};
  const dashboardAlerts = sellerDashboardData?.alerts || {};
  const payoutStatus = String(
    sellerData?.account_status ||
    sellerDashboardData?.account_status ||
    "Pending",
  ).toLowerCase();
  const performance = sellerDashboardData?.performance || {};
  const shouldShowInMyProducts = (status) =>
    String(status ?? "").trim().toLowerCase() !== "sold";
  const listings = Array.isArray(sellerDashboardData?.my_listings)
    ? sellerDashboardData.my_listings
    : Array.isArray(myListings)
      ? myListings
      : [];
  const visibleListings = useMemo(
    () => listings.filter((listing) => shouldShowInMyProducts(listing?.status)),
    [listings],
  );
  const orders = Array.isArray(sellerDashboardData?.received_orders)
    ? sellerDashboardData.received_orders
    : Array.isArray(sellerData?.incomingOrders)
      ? sellerData.incomingOrders
      : [];
  const runProductAction = async (productId, action, callback) => {
    setProductActionFeedback(null);
    setProductActionState((previous) => ({ ...previous, [productId]: action }));
    const optimisticStatus = action === "sold" ? "Sold" : action === "available" ? "Approved" : null;
    const previousProductPage = optimisticStatus ? productPage : null;
    if (optimisticStatus) updateProductPageStatus(productId, optimisticStatus);
    try {
      await callback(productId);
      await fetchProductPage(productPageNumber);
      setProductActionFeedback({
        type: "success",
        message: action === "delete"
          ? "Product deleted successfully."
          : action === "sold"
            ? "Product marked as sold."
            : action === "available"
              ? "Product is available again."
              : action === "pause"
                ? "Product paused."
                : "Product resumed.",
      });
      notifySuccess(
        action === "delete"
          ? "Product deleted successfully."
          : action === "sold"
            ? "Product marked as sold."
            : action === "available"
              ? "Product is available again."
              : action === "pause"
                ? "Product paused."
                : "Product resumed.",
        `student-product-action-${productId}-${action}`,
      );
    } catch (error) {
      if (previousProductPage) setProductPage(previousProductPage);
      setProductActionFeedback({
        type: "error",
        message: error.message || "The product action failed.",
      });
      notifyError(error, `student-product-action-${productId}-${action}`);
    } finally {
      setProductActionState((previous) => {
        const next = { ...previous };
        delete next[productId];
        return next;
      });
    }
  };
  const calculatedCounts = listings.reduce(
    (summary, listing) => {
      const status = String(listing.status || "Pending").toLowerCase();
      if (status.includes("sold")) summary.sold += 1;
      else if (status.includes("pending")) summary.pending += 1;
      else summary.active += 1;
      return summary;
    },
    { active: 0, pending: 0, sold: 0 },
  );
  const counts = {
    active: Number(dashboardStats.active_listings ?? calculatedCounts.active),
    pending: Number(
      dashboardStats.pending_listings ?? calculatedCounts.pending,
    ),
    sold: Number(dashboardStats.sold_listings ?? calculatedCounts.sold),
  };

  const normalizedInsights = visibleListings.map(normalizeSellerInsight);
  const topProducts = normalizedInsights
    .sort((left, right) => right[leaderboardSort] - left[leaderboardSort])
    .slice(0, 3);
  const analyticsStats = salesAnalytics.stats || {};
  const productsSold = Number(analyticsStats.products_sold ?? 0);
  const totalInventoryCount = Number(
    dashboardStats.total_listings ?? visibleListings.length + productsSold,
  );
  const chartMax = Math.max(
    ...salesAnalytics.points.map((point) => Number(point.total) || 0),
    1,
  );
  const chartPoints = salesAnalytics.points
    .map(
      (point, index) =>
        `${35 + (index * 575) / Math.max(salesAnalytics.points.length - 1, 1)},${190 - ((Number(point.total) || 0) / chartMax) * 135}`,
    )
    .join(" ");
  const salesRangeButtons = [
    { value: "7d", label: t("sellerHub.salesRange7d") },
    { value: "30d", label: t("sellerHub.salesRange30d") },
    { value: "3m", label: t("sellerHub.salesRange3m") },
  ];
  const onNavigate = (target, payload) => {
    if (target === "product-details" && payload?.productId) {
      onViewProduct?.(payload.productId);
      return;
    }
    onTabNavigate?.(target, payload);
  };
  const navigateToSellerSection = (view, sectionId) => {
    dispatchHubView({ type: view });
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
    }, 0);
  };
  const handleOpenProduct = (productId) => {
    onNavigate("product-details", { productId, returnTo: "seller-hub" });
  };

  const getSessionToken = useCallback(
    () => getSellerSessionToken(user),
    [user],
  );

  useEffect(() => {
    let cancelled = false;
    const requestId = salesAnalyticsRequestId.current + 1;
    salesAnalyticsRequestId.current = requestId;

    const fetchSalesAnalytics = async () => {
      setSalesAnalyticsLoading(true);
      setSalesAnalyticsError("");
      try {
        if (!sessionToken) {
          throw new Error("Your student session is missing. Please sign in again.");
        }
        const response = await fetch(
          `${API_BASE_URL}/api/student/seller/sales-analytics?range=${chartRange}`,
          {
            headers: { Authorization: `Bearer ${sessionToken}` },
            credentials: "include",
            cache: "no-store",
          },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.detail || "Unable to load sales analytics.");
        if (!Array.isArray(result.points) || !result.stats) {
          throw new Error("The server returned invalid sales analytics.");
        }
        if (!cancelled && requestId === salesAnalyticsRequestId.current) {
          setSalesAnalytics(result);
        }
      } catch (error) {
        if (!cancelled && requestId === salesAnalyticsRequestId.current) {
          setSalesAnalyticsError(
            error.message || "Unable to load sales analytics.",
          );
        }
      } finally {
        if (!cancelled && requestId === salesAnalyticsRequestId.current) {
          setSalesAnalyticsLoading(false);
        }
      }
    };

    fetchSalesAnalytics();
    return () => {
      cancelled = true;
    };
  }, [chartRange, salesAnalyticsRetry, sessionToken]);

  const fetchSellerOrderDetails = useCallback(async (orderId) => {
    setSelectedOrderLoading(true);
    setSelectedOrderError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/seller/orders/${encodeURIComponent(orderId)}`,
        {
          headers: { Authorization: `Bearer ${getSessionToken()}` },
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.detail || "Unable to load order details.");
      setSelectedOrder(result);
    } catch (error) {
      setSelectedOrderError(error.message || "Unable to load order details.");
    } finally {
      setSelectedOrderLoading(false);
    }
  }, [getSessionToken]);

  useEffect(() => {
    if (!openOrderId) {
      setSelectedOrder(null);
      return;
    }
    dispatchHubView({ type: 'open-operations' });
    setSelectedOrder({ id: openOrderId });
    fetchSellerOrderDetails(openOrderId);
  }, [fetchSellerOrderDetails, openOrderId]);

  const respondToDispute = async (dispute, responseTextOverride = "", evidenceFiles = []) => {
    const state = disputeResponseState[dispute.id] || {};
    const responseText = String(
      responseTextOverride || state.response || "",
    ).trim();
    if (!responseText || state.loading) return;
    if (responseText.length < 20) {
      throw new Error("Response must be at least 20 characters long.");
    }
    setDisputeResponseState((previous) => ({
      ...previous,
      [dispute.id]: { ...state, loading: true, error: "" },
    }));
    try {
      const formData = new FormData();
      formData.append("response", responseText);
      (evidenceFiles || []).forEach((file) => {
        if (file) formData.append("evidence_images", file);
      });

      const response = await fetch(
        `${API_BASE_URL}/api/disputes/${dispute.id}/response`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getSessionToken()}`,
          },
          body: formData,
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.detail || "Unable to respond to dispute.");
      setDisputeResponseState((previous) => ({
        ...previous,
        [dispute.id]: { response: "", success: "Response submitted." },
      }));
      notifySuccess(result.message || "Dispute response submitted.", `student-dispute-response-${dispute.id}`);
      await onRefreshOrders?.();
      await fetchSellerOrderDetails(dispute.order_id);
      return result;
    } catch (error) {
      setDisputeResponseState((previous) => ({
        ...previous,
        [dispute.id]: { ...state, error: error.message },
      }));
      notifyError(error, `student-dispute-response-${dispute.id}`);
      throw error;
    }
  };

  if (selectedOrder) {
    return (
      <SellerOrderDetails
        key={selectedOrder.id}
        order={selectedOrder}
        loading={selectedOrderLoading}
        error={selectedOrderError}
        onBack={() => {
          setSelectedOrder(null);
          onBackToSellerOrders?.();
        }}
        onRetry={() => fetchSellerOrderDetails(selectedOrder.id)}
        onDisputeResponse={respondToDispute}
        onOpenChat={onOpenSellerChat}
        sessionToken={sessionToken}
      />
    );
  }

  return (
    <div data-dashboard-view="seller" className="min-w-0 w-full max-w-full space-y-6 [&>*]:min-w-0 [&>*]:max-w-full">
      {completedOrderPage.items.length > 0 && (
        <button
          type="button"
          onClick={() => {
            const orderId = completedOrderPage.items[0].id;
            if (onOpenSellerOrder) onOpenSellerOrder(orderId);
            else {
              setSelectedOrder({ id: orderId });
              fetchSellerOrderDetails(orderId);
            }
          }}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
        >
          Open latest order details
        </button>
      )}
      <section className="w-full rounded-[30px] border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:p-8">
        <div>
          <h2 className="min-w-0 break-words text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">
            Seller Operations Center
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Monitor listings, fulfill customer orders, and turn marketplace
            activity into measurable campus sales.
          </p>
        </div>
      </section>

      {!showOverview && payoutStatus !== "active" && (
        <section className="flex flex-col gap-4 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
              Payout setup required
            </p>
            <h3 className="mt-1 text-lg font-black">
              Configure your bank account to receive sales payouts.
            </h3>
            <p className="mt-1 text-sm text-amber-800">
              Your seller account is currently{" "}
              {sellerData?.account_status ||
                sellerDashboardData?.account_status ||
                "Pending"}
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("payout-settings")}
            className="shrink-0 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
          >
            Configure Payouts
          </button>
        </section>
      )}

      {showOverview && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          [
            "My Listings",
            totalInventoryCount,
            `${counts.active} Active · ${counts.pending} Pending · ${counts.sold} Sold`,
            "▣",
            "text-sky-600",
          ],
          [
            "Received Orders",
            Number(dashboardStats.received_orders ?? orders.length),
            "All received orders",
            "▤",
            "text-emerald-600",
          ],
          [
            "Total Revenue",
            formatSellerEtb(dashboardStats.completed_revenue),
            "Completed orders",
            "◈",
            "text-amber-600",
          ],
        ].map(([label, value, detail, icon, tone]) => {
          const cardNavigation = {
            "My Listings": {
              title: "View your listings",
              onClick: () => navigateToSellerSection(
                "open-product-management",
                "seller-products",
              ),
            },
            "Received Orders": {
              title: "View received orders",
              onClick: () => navigateToSellerSection(
                "open-operations",
                "seller-orders",
              ),
            },
            "Total Revenue": {
              title: "View revenue and analytics",
              onClick: () => navigateToSellerSection(
                "open-operations",
                "seller-analytics",
              ),
            },
          }[label];
          return (
            <button
              key={label}
              type="button"
              onClick={cardNavigation.onClick}
              title={cardNavigation.title}
              className="cursor-pointer select-none rounded-[24px] border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-lg"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    {label}
                  </p>
                  <p className="mt-3 text-3xl font-black text-slate-950">
                    {value}
                  </p>
                  <p className={`mt-2 text-xs font-bold ${tone}`}>{detail}</p>
                </div>
                <span className={`text-2xl ${tone}`}>{icon}</span>
              </div>
            </button>
          );
        })}
      </div>}

      {showOverview && <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
        <h3 className="font-black text-amber-950">Listing attention</h3>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-amber-800">
          <span>
            ⚠ {Number(dashboardAlerts.unapproved_products ?? counts.pending)}{" "}
            product(s) pending admin approval
          </span>
        </div>
      </section>}

      {showProductManagement && (
        <div className="min-w-0 w-full space-y-5">
          <section id="seller-products" className="min-w-0 w-full rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-1">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-600">
                  Inventory
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-black text-slate-950 dark:text-white">
                    My Products
                  </h3>
                  <div role="group" aria-label="Inventory summary" className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500 dark:text-slate-300">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">{productPage.summary.total} {t('sellerHub.inventoryTotal')}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">{productPage.summary.active} {t('sellerHub.inventoryActive')}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">{productPage.summary.sold} {t('sellerHub.inventorySold')}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">{productPage.summary.pending} {t('sellerHub.inventoryPending')}</span>
                  </div>
                </div>
              </div>
            </div>
            {productActionFeedback && (
              <p className={`mt-4 rounded-xl border p-3 text-sm font-semibold ${productActionFeedback.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                {productActionFeedback.message}
              </p>
            )}
            {productPageLoading ? (
              <div className="mt-6 space-y-3" role="status" aria-label={t('sellerHub.productsLoading')}>
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : productPageError ? (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700" role="alert">
                <p>{t('sellerHub.productsLoadError')}</p>
                <button
                  type="button"
                  onClick={() => fetchProductPage(productPageNumber)}
                  className="mt-3 rounded-full border border-rose-300 px-4 py-2 font-bold hover:bg-rose-100"
                >
                  {t('sellerHub.retryProducts')}
                </button>
              </div>
            ) : productPage.items.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                No active products yet. Add your first campus product to get started.
              </div>
            ) : (
              <div className="mt-5 min-w-0 w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[1120px] table-auto text-left text-sm">
                  <thead className="border-b border-slate-200 text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-3">Product</th>
                      <th className="min-w-[120px] whitespace-nowrap px-3 py-3">Price</th>
                      <th className="whitespace-nowrap px-3 py-3">Stock</th>
                      <th className="whitespace-nowrap px-3 py-3">Status</th>
                      <th className="whitespace-nowrap px-3 py-3">Created</th>
                      <th className="px-3 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productPage.items.map((listing) => {
                      const productId = listing.id ?? listing.product_id;
                      const status = listing.status || "Pending";
                      const image = getSellerImage(listing.image);
                      const stock = Number(listing.stock ?? 0);
                      const soldOut = stock === 0;
                      const hasOrders = listing.has_orders === true;
                      const isSold = String(status).trim().toLowerCase() === "sold"
                        || soldOut
                        || listing.has_completed_orders === true;
                      const isPaused = String(status).toLowerCase() === "paused";
                      const actionInProgress = Boolean(productActionState[listing.id]);
                      return (
                        <tr
                          key={productId ?? listing.title}
                          onClick={() => handleOpenProduct(productId)}
                          className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50 ${isSold ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900"}`}
                        >
                          <td className="min-w-[180px] max-w-[360px] px-3 py-4 text-slate-900 dark:text-white">
                            <div className="flex min-w-0 items-center gap-3">
                              <button
                                type="button"
                                disabled={actionInProgress}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenProduct(productId);
                                }}
                                title="Click to view product details"
                                aria-label={`View details for ${listing.title || listing.name || "product"}`}
                                className="shrink-0 cursor-pointer rounded-xl transition-transform duration-200 hover:scale-105 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <img
                                  src={image}
                                  alt=""
                                  onError={(event) => {
                                    event.currentTarget.onerror = null;
                                    event.currentTarget.src =
                                      SELLER_IMAGE_PLACEHOLDER;
                                  }}
                                  className="h-20 w-20 rounded-xl object-cover"
                                />
                              </button>
                              <div className="flex min-w-0 max-w-[230px] flex-1 flex-col justify-center gap-1">
                                <span
                                  className="block min-w-0 max-w-full whitespace-normal break-words font-bold leading-5 text-slate-900"
                                  style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
                                >
                                  {listing.title || listing.name || "Untitled listing"}
                                </span>
                                <span
                                  className="inline-flex max-w-full items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    maxWidth: "100%",
                                  }}
                                  title={listing.category || "General"}
                                >
                                  {listing.category || "General"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td
                            className={`min-w-[120px] whitespace-nowrap px-3 py-4 font-bold ${isSold ? "text-slate-500" : "text-emerald-600"}`}
                          >
                            {formatSellerEtb(
                              String(listing.price || 0).replace(/[^0-9.]/g, ""),
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-slate-600 dark:text-slate-300">{stock}</td>
                          <td className="whitespace-nowrap px-3 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {status === "Approved" ? "Active" : status}
                              </span>
                              {isSold && listing.sold_via === "Marketplace Order" && (
                                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">
                                  Marketplace Order
                                </span>
                              )}
                              {isSold && listing.sold_via === "Marked by Seller" && (
                                <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600">
                                  Marked by Seller
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-xs text-slate-500 dark:text-slate-300">
                            {listing.created_at
                              ? new Date(listing.created_at).toLocaleDateString()
                              : "Unavailable"}
                          </td>
                          <td className="px-3 py-4" onClick={(event) => event.stopPropagation()}>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={actionInProgress}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenProduct(productId);
                                }}
                                className="btn-primary rounded-full px-3 py-1.5 text-xs font-bold transition"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                disabled={actionInProgress}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onEditProduct(listing.id);
                                }}
                                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={hasOrders || actionInProgress}
                                title={
                                  hasOrders
                                    ? "This product has order history and cannot be deleted. You can still edit or mark it as unavailable."
                                    : undefined
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (hasOrders) return;
                                  const confirmed = typeof window === "undefined" || window.confirm(`Delete ${listing.title || "this product"}?`);
                                  if (confirmed) runProductAction(listing.id, "delete", onDeleteProduct);
                                }}
                                className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                Delete
                              </button>
                              {hasOrders && (
                                <span className="basis-full text-xs font-semibold text-slate-500">
                                  This product has order history and cannot be
                                  deleted. You can still edit or mark it as
                                  unavailable.
                                </span>
                              )}
                              {isSold ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={soldOut || listing.has_completed_orders === true || actionInProgress}
                                    title={
                                      soldOut || listing.has_completed_orders === true
                                        ? "Add stock via Edit before marking this product available."
                                        : undefined
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!soldOut) runProductAction(listing.id, "available", onTogglePause);
                                    }}
                                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                                  >
                                    {actionInProgress ? "Updating..." : "Reactivate"}
                                  </button>
                                  {(soldOut || listing.has_completed_orders === true) && (
                                    <span className="basis-full text-xs font-semibold text-slate-500">
                                      {listing.has_completed_orders === true
                                        ? "Completed order history keeps this product in Sold."
                                        : "Add stock via Edit before reactivating this product."}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={actionInProgress}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      runProductAction(listing.id, isPaused ? "resume" : "pause", onTogglePause);
                                    }}
                                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                                  >
                                    {actionInProgress ? "Updating..." : isPaused ? "Resume" : "Pause"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={actionInProgress}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      runProductAction(listing.id, "sold", onMarkAsSold);
                                    }}
                                    className="rounded-full border border-amber-200 px-3 py-1.5 text-xs font-bold text-amber-700"
                                  >
                                    {actionInProgress ? "Updating..." : "Mark as Sold"}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!productPageLoading && !productPageError && productPage.total > 10 && (
              <nav
                className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700"
                aria-label={t('sellerHub.productsPagination')}
              >
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t('sellerHub.productsShowing')
                    .replace('{start}', String((productPage.page - 1) * productPage.page_size + 1))
                    .replace('{end}', String(Math.min(productPage.page * productPage.page_size, productPage.total)))
                    .replace('{total}', String(productPage.total))}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    aria-label={t('sellerHub.productsPreviousPage')}
                    disabled={productPage.page <= 1}
                    onClick={() => goToProductPage(productPage.page - 1)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                  >
                    {t('sellerOrders.previous')}
                  </button>
                  {getProductPaginationItems(productPage.page, productPage.total_pages).map((item, index) => (
                    item === "ellipsis" ? (
                      <span key={`ellipsis-${index}`} aria-hidden="true" className="px-2 text-slate-500">…</span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        aria-label={t('sellerHub.productsPage').replace('{page}', String(item))}
                        aria-current={item === productPage.page ? "page" : undefined}
                        onClick={() => goToProductPage(item)}
                        className={`min-w-10 rounded-lg border px-3 py-2 text-sm font-semibold ${item === productPage.page ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"}`}
                      >
                        {item}
                      </button>
                    )
                  ))}
                  <button
                    type="button"
                    aria-label={t('sellerHub.productsNextPage')}
                    disabled={productPage.page >= productPage.total_pages}
                    onClick={() => goToProductPage(productPage.page + 1)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                  >
                    {t('sellerOrders.next')}
                  </button>
                </div>
              </nav>
            )}
          </section>
        </div>
      )}

      {showOverview && <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">
          Seller Performance
        </p>
        <h3 className="mt-2 text-3xl font-black text-slate-950">
          {Number(performance.rating || 0).toFixed(1)} / 5.0 ⭐
        </h3>
        <div className="mt-6 space-y-4">
          {[
            ["Response Rate", Number(performance.response_rate || 0)],
            ["Order Completion", Number(performance.order_completion || 0)],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="flex justify-between text-sm font-bold text-slate-700">
                <span>{label}</span>
                <span className="text-emerald-600">{value}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(value, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>}

      {showOperations && <div className="space-y-6">
        <SellerCompletedOrders
          pageData={completedOrderPage}
          filters={sellerOrderFilters}
          loading={completedOrdersLoading}
          error={completedOrdersError}
          onRetry={retryCompletedOrders}
          onFilterChange={updateSellerOrderFilters}
          onOpenOrder={(orderId) => {
            if (onOpenSellerOrder) onOpenSellerOrder(orderId);
            else {
              setSelectedOrder({ id: orderId });
              fetchSellerOrderDetails(orderId);
            }
          }}
        />

        <div className="grid gap-6">
          <section
            id="seller-analytics"
            className="w-full rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-600">
                  {t("sellerHub.salesAnalytics")}
                </p>
                <h3 className="mt-1 text-xl font-black text-slate-950">
                  {t("sellerHub.salesPerformance")}
                </h3>
              </div>
              <div className="flex flex-wrap gap-1 rounded-full bg-slate-100 p-1">
                {salesRangeButtons.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={chartRange === value}
                    onClick={() => setChartRange(value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${chartRange === value ? "bg-slate-900 text-white" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-700" aria-live="polite">
              {t("sellerHub.salesRangeTotals")
                .replace("{revenue}", formatSellerEtb(salesAnalytics.totals?.revenue ?? salesAnalytics.stats?.total_revenue))
                .replace("{orders}", String(salesAnalytics.totals?.orders ?? salesAnalytics.stats?.total_orders ?? 0))}
            </p>
            {salesAnalyticsLoading && (
              <p className="mt-2 text-sm text-slate-500" role="status">
                {t("sellerHub.salesLoading")}
              </p>
            )}
            {salesAnalyticsError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
                <p>{t("sellerHub.salesLoadError")}</p>
                <button
                  type="button"
                  onClick={() => setSalesAnalyticsRetry((retry) => retry + 1)}
                  className="mt-2 rounded-full border border-rose-300 px-4 py-2 font-bold hover:bg-rose-100"
                >
                  {t("sellerHub.salesRetry")}
                </button>
              </div>
            ) : !salesAnalyticsLoading
              && Number(salesAnalytics.stats?.total_orders ?? salesAnalytics.order_count ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-slate-500" role="status">
                {t("sellerHub.salesNoSales")}
              </p>
            ) : null}
            <svg
              viewBox="0 0 640 230"
              className="mt-6 h-56 w-full"
              role="img"
              aria-busy={salesAnalyticsLoading}
              aria-label={`${t("sellerHub.salesRevenueTrend")} - ${salesRangeButtons.find(({ value }) => value === chartRange)?.label}`}
            >
              <path
                d="M35 190 H610 M35 145 H610 M35 100 H610 M35 55 H610"
                stroke="#e2e8f0"
                strokeDasharray="5 8"
              />
              <polyline
                points={chartPoints}
                fill="none"
                stroke="#10b981"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={`${chartPoints} 610,205 35,205`}
                fill="#10b981"
                fillOpacity="0.1"
                stroke="none"
              />
              {salesAnalytics.points.map((point, index) => (
                <circle
                  key={`${point.date}-${index}`}
                  cx={35 + (index * 575) / Math.max(salesAnalytics.points.length - 1, 1)}
                  cy={190 - ((Number(point.total) || 0) / chartMax) * 135}
                  r="5"
                  fill="#10b981"
                />
              ))}
              {salesAnalytics.points.map((point, index) => (
                <text
                  key={`${point.label ?? point.date ?? 'label'}-${index}-label`}
                  x={35 + (index * 575) / Math.max(salesAnalytics.points.length - 1, 1)}
                  y="225"
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize={salesAnalytics.points.length > 12 ? "9" : "12"}
                >
                  {point.label}
                </text>
              ))}
            </svg>
          </section>
        </div>
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">
                Leaderboard
              </p>
              <h3 className="mt-1 text-xl font-black text-slate-950">
                Top Performing Products
              </h3>
            </div>
            <div className="flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Sort top performing products">
              {[
                { value: "views", label: "Views" },
                { value: "orderCount", label: "Orders" },
                { value: "revenue", label: "Revenue" },
              ].map(({ value, label }) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={leaderboardSort === value}
                  onClick={() => setLeaderboardSort(value)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold transition ${leaderboardSort === value ? "bg-white font-bold text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {topProducts.length ? (
              topProducts.map((product, index) => (
                <button
                  type="button"
                  key={product.id}
                  onClick={() =>
                    onNavigate("product-details", { productId: product.id })
                  }
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={getSellerImage(product.image)}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = SELLER_IMAGE_PLACEHOLDER;
                      }}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                    />
                    <div className="min-w-0">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        #{index + 1}
                      </span>
                      <h4 className="mt-1 truncate font-black text-slate-950">
                        {product.title || product.name}
                      </h4>
                      <p className="truncate text-xs font-semibold text-slate-500">
                        {[product.category, product.subcategory]
                          .filter(Boolean)
                          .join(" · ") || "General"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {product.views} views · {product.orderCount} orders
                  </p>
                  <p className="mt-2 text-lg font-black text-emerald-700">
                    {formatSellerEtb(product.revenue)}
                    <span className="ml-1 text-xs font-medium text-slate-500">generated</span>
                  </p>
                </button>
              ))
            ) : (
              <p className="text-sm text-slate-500">
                Performance data will appear after your first listing receives
                activity.
              </p>
            )}
          </div>
        </section>

      </div>}

    </div>
  );
}
export default SellerOperationsCenter;
