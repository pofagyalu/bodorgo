const config = {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  registerUrl: process.env.REGISTER_REDIRECT_URL,
  resetUrl: process.env.RESET_REDIRECT_URL,
  db: {
    uri: process.env.DB_URI,
    testUri: process.env.DB_TEST_URI,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRES_IN,
    cookieExpiry: process.env.JWT_COOKIE_EXPIRES_IN,
  },
  mailtrap: {
    host: process.env.MAILTRAP_EMAIL_HOST,
    port: process.env.MAILTRAP_EMAIL_PORT,
    user: process.env.MAILTRAP_EMAIL_USERNAME,
    password: process.env.MAILTRAP_EMAIL_PASSWORD,
    from: process.env.MAILTRAP_EMAIL_FROM,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_EMAIL_FROM,
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
};

// Shared by Express's cors() middleware and Socket.IO's own cors option, so
// both always agree on the same allow-list.
config.corsOrigins = (
  config.clientOrigin || 'https://bodorgo.hu,http://localhost:4200'
)
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
