# Campace Market

## Product checkout and wallet deposits

Product purchases use Chapa checkout with a split-payment subaccount for the seller. The seller must finish payout setup and have an active Chapa subaccount before buyers can check out. The checkout records a pending order and reserves the requested inventory; the signed webhook or server-side Chapa verification completes the order. The seller's internal marketplace wallet is not credited because Chapa settles the split directly.

Percentage commission is passed to Chapa as a fraction (`0.0100` for 1%). Cart totals show the item subtotal, while the platform commission is displayed separately as a deduction from the seller payout. Chapa's documented initialization fields do not provide a confirmed way to assign its processing fees to the seller; seller-borne gateway fees are therefore not guaranteed and must be confirmed with Chapa before relying on that accounting.

The frontend creates and reuses one idempotency key for each product-and-quantity checkout intent. It keeps that key when the request outcome is uncertain and discards it after a definitive response or when the buyer changes the intent. Wallet deposits remain available through their separate Chapa initialization flow and continue to credit the student's wallet.

## Google OAuth setup

Google sign-in is handled by the FastAPI backend using Authorization Code flow with PKCE.

1. Open [Google Cloud Console](https://console.cloud.google.com/), create or select a project, and configure the OAuth consent screen.
2. Create an OAuth client under **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
3. Choose **Web application** and add this authorized redirect URI for local development:

   `http://localhost:8000/auth/google/callback`

4. Copy `Backend/.env.example` to `Backend/.env` and set:

   ```env
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
   FRONTEND_URL=http://localhost:5173
   ```

5. Set `studentVerification.allowedEmailDomain` to the institution's domain. New Google accounts are rejected unless their verified email matches that domain.
6. Start the backend before opening the frontend. Missing OAuth variables produce a startup error listing the missing names.

## Cloudinary file uploads

The backend uploads product images, profile photos, student-ID evidence, and chat attachments through Cloudinary. Add these names to `Backend/.env` on the backend service (values kept in the hosting environment, never committed):

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

If these are unset, the app falls back to the local `static/uploads` behavior for local development. In production, Cloudinary protects uploads from Render's ephemeral filesystem by storing files in a durable external CDN/storage layer.

For production, use HTTPS URLs in Google Cloud Console and the environment variables. Never commit `Backend/.env` or expose the client secret.
