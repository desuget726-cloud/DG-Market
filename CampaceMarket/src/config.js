const configuredApiBaseUrl = String(import.meta.env.VITE_API_URL || '').trim();
export const API_BASE_URL = (configuredApiBaseUrl || (import.meta.env.DEV ? 'http://localhost:8000' : '')).replace(/\/+$/, '');
if (import.meta.env.PROD && !configuredApiBaseUrl) {
    console.error('VITE_API_URL is not configured. Set it to the deployed backend origin.');
}
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');
export const SHOW_REPORT_PROBLEM = false;

export const IMAGE_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 200%22%3E%3Crect width=%22320%22 height=%22200%22 fill=%22%23e2e8f0%22/%3E%3Cpath d=%22M92 145l42-48 32 35 25-27 49 40H92z%22 fill=%22%2394a3b8%22/%3E%3Ccircle cx=%22125%22 cy=%2275%22 r=%2216%22 fill=%22%2394a3b8%22/%3E%3C/svg%3E';

export const resolveImageUrl = (path) => {
    if (Array.isArray(path)) return resolveImageUrl(path.find(Boolean));
    if (typeof path !== 'string' || !path.trim()) return IMAGE_PLACEHOLDER;

    const value = path.trim();
    if (/^https:\/\//i.test(value) || /^(?:data|blob):/i.test(value)) return value;

    const localOrigin = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i;
    if (localOrigin.test(value)) return value.replace(localOrigin, API_BASE_URL);
    if (/^https?:\/\//i.test(value)) return value;

    return `${API_BASE_URL}/${value.replace(/^\/+/, '')}`;
};