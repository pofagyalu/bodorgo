import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject, vi } from 'vitest';

// Runs before every test file.

// --- Settings the app reads at import time (config.js) ---
process.env.NODE_ENV = 'test';
// Same time zone as the production server - date handling differs between
// UTC (the CI container's default) and Hungarian time, and the weather's
// one-day shift only showed up in the latter.
process.env.TZ = 'Europe/Budapest';
process.env.COOKIE_SECRET ??= 'test-cookie-secret';
process.env.CLIENT_BASE_URL ??= 'http://localhost:4200';
process.env.CLIENT_ORIGIN ??= 'http://localhost:4200';
// Fake keys - utils/stripe.js builds its client at import time; nothing is
// ever sent to Stripe (the calls themselves are mocked below).
process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test_dummy';
// Dummy Authentik settings - the login library itself is faked in
// tests/api/auth.test.js; nothing ever reaches a real Authentik.
process.env.AUTHENTIK_SERVER_URL ??= 'https://auth.test';
process.env.AUTHENTIK_CLIENT_ID ??= 'test-client';
process.env.AUTHENTIK_CLIENT_SECRET ??= 'test-secret';
process.env.AUTHENTIK_PROVIDER_SLUG ??= 'bodorgo';
process.env.AUTHENTIK_POSTLOGOUT_URI ??= 'http://localhost:4200/';
// Uploaded/generated files (utils/dataDirs.js) go to a temporary folder,
// never the real server/documents or public/documents/tours.
const TEST_FILES = path.join(os.tmpdir(), `bodorgo-test-files-${process.pid}`);
process.env.CLUB_DOCUMENTS_DIR = path.join(TEST_FILES, 'documents');
process.env.RECEIPTS_DIR = path.join(TEST_FILES, 'receipts');
process.env.TOUR_DOCUMENTS_DIR = path.join(TEST_FILES, 'tour-documents');
process.env.MEDIA_VIDEOS_ROOT = path.join(TEST_FILES, 'media-videos');
process.env.VIDEOS_ROOT = path.join(TEST_FILES, 'tour-videos');
process.env.PHOTOS_ROOT = path.join(TEST_FILES, 'tour-photos');
process.env.THUMBNAILS_ROOT = path.join(TEST_FILES, 'thumbnails');
process.env.MEDIA_PHOTOS_ROOT = path.join(TEST_FILES, 'media-photos');
process.env.CHAT_IMAGES_DIR = path.join(TEST_FILES, 'chat-images');
// The tour wallet is "configured" for the withdrawal tests; the membership
// one deliberately isn't.
process.env.BARION_TOUR_PAYEE_EMAIL ??= 'tour@test.local';
process.env.BARION_TOUR_WALLET_KEY ??= 'wallet-test';
process.env.BARION_TOUR_WITHDRAW_NAME ??= 'Teszt Klub';
process.env.BARION_TOUR_WITHDRAW_IBAN ??= 'HU00 0000 0000 0000';

// --- Nothing in a test may reach the outside world or write real files ---

// Silent logger (the real one writes to the logs/ folder).
vi.mock('../src/logger.js', () => {
  const noop = () => {};
  return {
    default: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      http: noop,
      stream: { write: noop },
    },
  };
});

// Address lookup / driving routes (OpenRouteService). resolveDistanceInfo
// stays real: without a geocoded viewer it just returns the tour's own
// stored Budapest distance, no network.
vi.mock('../src/utils/distance.js', async (importOriginal) => ({
  ...(await importOriginal()),
  geocodeAddress: vi.fn(async () => null),
  computeDrivingRoute: vi.fn(async () => null),
}));

// Weather (Open-Meteo).
vi.mock('../src/utils/weather.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchForecast: vi.fn(async () => null),
  fetchHistorical: vi.fn(async () => null),
}));

// Web push - fake keys, and the push services themselves faked below.
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) },
}));

// Email sending.
vi.mock('../src/utils/resendEmail.js', () => ({
  default: vi.fn(async () => ({ id: 'test-email' })),
}));

// Payment gateways - individual tests override these with vi.mocked(...).
vi.mock('../src/utils/stripe.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createCheckoutSession: vi.fn(async () => ({
    id: 'cs_test',
    url: 'https://stripe.test/checkout',
  })),
  retrieveCheckoutSession: vi.fn(async () => ({ id: 'cs_test', payment_status: 'unpaid' })),
}));
vi.mock('../src/utils/barion.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createBarionPayment: vi.fn(async () => ({ id: 'barion-test', url: 'https://barion.test/pay' })),
  getBarionPaymentState: vi.fn(async () => ({ Status: 'Prepared' })),
  createBarionWithdrawal: vi.fn(async () => ({ TransactionId: 'tx-test' })),
}));

// --- A fresh database per test file, emptied after every test ---

beforeAll(async () => {
  await mongoose.connect(inject('mongoUri'), { dbName: `test-${randomUUID()}` });
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  vi.clearAllMocks();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
