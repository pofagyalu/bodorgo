import path from 'path';

const config = {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  registerUrl: process.env.REGISTER_REDIRECT_URL,
  resetUrl: process.env.RESET_REDIRECT_URL,
  db: {
    uri: process.env.DB_URI,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRES_IN,
    cookieExpiry: process.env.JWT_COOKIE_EXPIRES_IN,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_EMAIL_FROM,
    // Local .env only: every e-mail goes to this address instead (see
    // utils/emailRedirect.js). Never set on the live server.
    redirectTo: process.env.EMAIL_REDIRECT_TO,
  },
  redisUrl: process.env.REDIS_URL,
  sendgrid: {
    user: process.env.SENDGRID_USERNAME,
    password: process.env.SENDGRID_PASSWORD,
  },
  // The advance-payment flow (see paymentController.js) - test mode by
  // default (a Stripe test secret key, sk_test_...), since this is a real
  // gateway integration being tried out for the first time, not yet a
  // live key. Test-mode keys are shown directly on the Stripe dashboard
  // the moment you sign up - no separate "shop" object or approval step,
  // unlike some other providers this project tried first. webhookSecret
  // verifies that a POST to /payments/stripe/webhook genuinely came from
  // Stripe (see app.js's raw-body handling for that one route, and
  // utils/stripe.js's constructWebhookEvent) - found on the webhook
  // endpoint's own page in the Stripe dashboard once one is registered.
  stripe: {
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  // Second payment gateway alongside Stripe (see utils/barion.js) - a
  // Hungarian one, offered as an alternative at checkout, not a
  // replacement. Sandbox (api.test.barion.com) by default, same "test
  // mode before going live" precedent as Stripe's own sk_test_ key; set
  // BARION_ENV=production once ready to switch to the real barion.com API
  // + a live POSKey. posKey/payeeEmail come from the Shop admin page on
  // a Barion account that's a real registered Shop, not a personal wallet
  // - a personal account has no POSKey at all.
  // membership/tour below split where each purpose's money actually lands
  // - one shop (the single posKey above) can still route a given
  // transaction to any wallet just by naming a different Payee email (see
  // utils/barion.js's own comment on createBarionPayment), so this doesn't
  // need a second Shop/POSKey, just a second wallet. Each purpose's own
  // walletKey/withdrawName/withdrawIban are ONLY used by the admin-
  // triggered withdrawal feature (paymentController.js's withdrawFunds) -
  // a wallet's own API key (from that wallet's own dashboard, NOT the
  // shop's posKey above), needed to pull money out of it via Barion's
  // /v3/Withdraw/BankTransfer. Falls back to the single legacy
  // BARION_PAYEE_EMAIL for payeeEmail so existing payments keep working
  // unchanged until a dedicated second wallet is actually configured.
  barion: {
    posKey: process.env.BARION_POS_KEY,
    baseUrl:
      process.env.BARION_ENV === 'production'
        ? 'https://api.barion.com'
        : 'https://api.test.barion.com',
    membership: {
      payeeEmail: process.env.BARION_MEMBERSHIP_PAYEE_EMAIL || process.env.BARION_PAYEE_EMAIL,
      walletKey: process.env.BARION_MEMBERSHIP_WALLET_KEY,
      withdrawName: process.env.BARION_MEMBERSHIP_WITHDRAW_NAME,
      withdrawIban: process.env.BARION_MEMBERSHIP_WITHDRAW_IBAN,
    },
    tour: {
      payeeEmail: process.env.BARION_TOUR_PAYEE_EMAIL || process.env.BARION_PAYEE_EMAIL,
      walletKey: process.env.BARION_TOUR_WALLET_KEY,
      withdrawName: process.env.BARION_TOUR_WITHDRAW_NAME,
      withdrawIban: process.env.BARION_TOUR_WITHDRAW_IBAN,
    },
  },
  // This server's own public base URL - needed because Barion (unlike
  // Stripe) has no dashboard-configured webhook; every single payment-
  // start request has to tell it exactly where to call back (see
  // utils/barion.js's createBarionPayment).
  apiBaseUrl: process.env.API_BASE_URL,
  cookie: {
    secret: process.env.COOKIE_SECRET,
  },
  oridzs: {
    server: process.env.AUTHENTIK_SERVER_URL,
    clientId: process.env.AUTHENTIK_CLIENT_ID,
    clientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
    redirectUri: process.env.AUTHENTIK_REDIRECT_URI,
    providerSlug: process.env.AUTHENTIK_PROVIDER_SLUG,
    postLogoutRedirectUri: process.env.AUTHENTIK_POSTLOGOUT_URI,
    clientBaseUrl: process.env.CLIENT_BASE_URL,
  },
  clientOrigin: process.env.CLIENT_ORIGIN, // comma-separated list of allowed CORS origins
  openRouteService: {
    apiKey: process.env.OPENROUTESERVICE_API_KEY,
  },
  // Two different values depending on where the process runs - see
  // tour-photos-implementation-plan.md's Config section. The live pm2
  // process (S:\bodorgo\.env) needs the NAS-native absolute paths; running
  // scripts/syncTourImages.js by hand from this dev machine needs the
  // Windows-mapped-drive form instead (Z:\..., S:\...) in the local .env.
  photosRoot: process.env.PHOTOS_ROOT,
  thumbnailsRoot: process.env.THUMBNAILS_ROOT,
  // Média → Fotók: the NAS's bódorgó_egyéb, each subfolder a category (see
  // photos/mediaPhotoSync.js). Same NAS-path / mapped-drive split.
  mediaPhotosRoot: process.env.MEDIA_PHOTOS_ROOT,
  // MEDIA_ROOT: the one Jellyfin-organized folder on the NAS holding every
  // club video, one subfolder per series - streamed straight from there,
  // never copied into this app's own storage. Same dual-form path split as
  // photosRoot/thumbnailsRoot above: the live pm2 process needs the
  // NAS-native absolute path, a dev machine running this by hand instead
  // needs the Windows-mapped-drive form (Y:\...) in its own local .env.
  //
  // The tour recap videos are its a-bodorgo-klan subfolder (see
  // tourVideoController.js); the Média page's categories are the others
  // (see mediaVideoController.js). The tests point each at its own
  // temporary folder instead (VIDEOS_ROOT / MEDIA_VIDEOS_ROOT).
  videosRoot:
    process.env.VIDEOS_ROOT ||
    (process.env.MEDIA_ROOT ? path.join(process.env.MEDIA_ROOT, 'a-bodorgo-klan') : undefined),
  mediaVideosRoot: process.env.MEDIA_VIDEOS_ROOT || process.env.MEDIA_ROOT,
  // The 12-hourly "your tour's video is ready" e-mails (see server.js) -
  // switched on in the live server's .env only.
  tourVideoEmails: process.env.TOUR_VIDEO_EMAILS === 'on',
  // Other timed jobs that must run on one server only, e.g. the polls'
  // "closes in 2 hours" reminders (see server.js) - on in the live
  // server's .env.
  backgroundJobs: process.env.BACKGROUND_JOBS === 'on',
  // Web push notifications (see utils/push.js) - off when the keys aren't
  // set. The same key pair on every server: a device subscribed through
  // one can only be reached with that pair.
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'https://bodorgo.hu',
  },
};

// Shared by Express's cors() middleware and Socket.IO's own cors option, so
// both always agree on the same allow-list.
config.corsOrigins = (config.clientOrigin || 'https://bodorgo.hu,http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim());

export const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'OkiDoki API',
      version: 1.0,
    },
    servers: [{ url: `http://127.0.0.1:${config.port}` }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          bearerFormat: 'JWT',
          scheme: 'bearer',
        },
      },
    },
  },
  apis: ['**/*.yaml'],
};

export default config;
