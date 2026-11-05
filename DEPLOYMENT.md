# Production Deployment

## Render backend

Connect the Render backend service to its MySQL provider. The application accepts `DATABASE_URL` or Railway's `MYSQL_URL` / `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, and `MYSQLDATABASE` variables.

Set these backend variables in Render. Values marked `replace-with-your-value` must be supplied in Render and are intentionally absent from this repository:

```text
CORS_ORIGINS=https://campus-market-gamma-eight.vercel.app
# Chapa credentials for wallet deposits and direct product split checkout.
CHAPA_SECRET_KEY=replace-with-your-value
CHAPA_WEBHOOK_SECRET=replace-with-your-value
# Mode-specific keys are also used by payouts.
CHAPA_MODE=test
CHAPA_TEST_SECRET_KEY=replace-with-chapa-test-secret
CHAPA_TEST_WEBHOOK_SECRET=replace-with-chapa-test-webhook-secret
CHAPA_LIVE_SECRET_KEY=replace-with-chapa-live-secret
CHAPA_LIVE_WEBHOOK_SECRET=replace-with-chapa-live-webhook-secret
PAYOUT_MIN_AMOUNT_ETB=100.00
PAYOUT_DAILY_LIMIT_ETB=10000.00
PAYOUT_MAX_REQUESTS_PER_HOUR=3
PAYOUT_ADMIN_APPROVAL_THRESHOLD_ETB=5000.00
PAYOUT_TIMEOUT_HOURS=24
OPENAI_API_KEY=replace-with-your-value
SESSION_SECRET=replace-with-a-long-random-value
ADMIN_2FA_BYPASS=false
SELLER_ACCEPTANCE_HOURS=24
CHAPA_PUBLIC_KEY=replace-with-your-value
PUBLIC_BASE_URL=https://your-render-service.onrender.com
FRONTEND_BASE_URL=https://campus-market-gamma-eight.vercel.app
SENDER_EMAIL=replace-with-your-value
SENDER_PASSWORD=replace-with-your-value
GOOGLE_API_KEY=replace-with-your-value
GOOGLE_CSE_ID=replace-with-your-value
```

`ADMIN_2FA_BYPASS` defaults to `false`. Only set it to `true` for supervised recovery
when the sole active administrator cannot complete the required 2FA flow; it permits
that administrator to sign in with the password alone and records a critical audit
entry. Set it back to `false` immediately after recovery.

`SELLER_ACCEPTANCE_HOURS` sets the seller's response window for new paid orders and
defaults to `24`. Existing orders with a stored seller acceptance deadline keep that
deadline unless you deliberately run the optional SQL migration at
`Backend/scripts/update_pending_seller_acceptance_deadlines_24h.sql`.

Render Web Service settings:

```text
Root Directory: /Backend
Build Command: pip install -r requirements.txt
Start Command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health Check Path: /health
```

After deployment, verify `https://your-render-service.onrender.com/health` returns `{"status":"ok"}`.

## Local Chapa callback testing

The backend listens on port `8000` for local development. In PowerShell, start it from the `Backend` directory:

```powershell
cd C:\Users\Lab 3\Documents\Campus-market\Backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The Vite frontend uses `VITE_API_URL` when configured; otherwise its development API origin is `http://127.0.0.1:8000`. `vite.config.js` does not define an HTTP proxy, so checkout is sent directly to `<API origin>/api/products/{product_id}/checkout` with `{"quantity": ...}`. If the request never appears in FastAPI logs, verify the configured API origin and that the backend is listening there. A Chapa initialization timeout is handled by FastAPI after 15 seconds and returned as a JSON `503` response; it is distinct from a gateway failure before the request reaches the backend.

In a second terminal, start a tunnel to that port:

```powershell
npx localtunnel --port 8000 --local-host 127.0.0.1
```

Use the HTTPS URL printed by Localtunnel (it can change when restarted) as `BASE_URL` in the backend's local `.env`. The Chapa webhook URL is derived as `<tunnel-url>/api/payment/webhook`; register that full URL in Chapa if the dashboard asks for a webhook URL. Restart Uvicorn after changing backend environment variables. The backend accepts callbacks at `/api/payment/webhook` and the legacy `/api/admin/payments/webhook` path.

In production, set `PUBLIC_BASE_URL` to the backend's public HTTPS origin and `FRONTEND_BASE_URL` to the frontend's HTTPS origin. Chapa's return URL is derived as `<backend-url>/api/payment/return`, which redirects buyers to the frontend dashboard for product purchases. For local testing, `FRONTEND_URL=http://localhost:5173` is used as the return destination.

Product checkout requires each seller to complete payout setup and have an active Chapa subaccount. Wallet deposits continue through their separate initialization flow. Chapa's initialization payload does not include a documented, confirmed seller-fee-bearer setting, so verify fee treatment with Chapa before production.

Before testing Chapa, verify `http://127.0.0.1:8000/health` returns `{"status":"ok"}`, then verify `<tunnel-url>/health` returns the same response. A `503 Tunnel Unavailable` at the tunnel URL means the tunnel service cannot reach the local listener; check that Uvicorn is still running on port `8000` and restart the tunnel command above. `/favicon.ico` now returns `204 No Content` from the backend; the frontend serves its own favicon.

## Vercel frontend

Settings:

```text
Root Directory: CampaceMarket
Build Command: npm run build
Output Directory: dist
Environment Variable: VITE_API_URL=https://your-render-service.onrender.com
```

In the Vercel project settings, set `VITE_API_URL` to the actual Render service's public origin (for example, `https://your-render-service.onrender.com`), with no trailing slash. Redeploy the Vercel project after adding or changing this variable so Vite includes it in the build.

The frontend's `public` directory is served as the site root by Vite and copied to `dist` during builds. Verify the deployed frontend's `/favicon.ico` returns `200` with an icon content type; this file must be a real ICO image, not SVG content renamed with an `.ico` extension.

On Render, set `CORS_ORIGINS=https://campus-market-gamma-eight.vercel.app` (no trailing slash). The backend also allows this production origin if `CORS_ORIGINS` is omitted, and normalizes a trailing slash if one is supplied.

Do not put database credentials or backend secrets in any `VITE_` variable.

Large withdrawals at or above `PAYOUT_ADMIN_APPROVAL_THRESHOLD_ETB` remain held and do not call Chapa until an administrator approves them. Admins can list them with `GET /api/admin/payouts/pending-approval` and approve selected IDs with `POST /api/admin/payouts/reconcile` using `{"payout_ids":[1],"action":"approve"}`. For production payouts, set `CHAPA_MODE=live` and configure the live transfer and webhook secrets; never reuse test credentials as live credentials.

## GitHub safety

`.env` and `.env.*` files are ignored. Keep real values in Render, the database provider, and Vercel environment settings only. Use `.env.example` files for placeholders when developing locally.