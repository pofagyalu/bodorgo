import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../src/config.js';
import logger from '../../src/logger.js';

// The driving route from OpenRouteService (utils/distance.js) - the real
// one, not the stand-in every other test gets (tests/setup.js).
const { computeDrivingRoute } = await vi.importActual('../../src/utils/distance.js');

const from = { lat: 47.68, lng: 17.63 };
const to = { lat: 47.95, lng: 21.6 };

describe('the driving route', () => {
  const key = config.openRouteService.apiKey;
  afterEach(() => {
    config.openRouteService.apiKey = key;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the service busy or down (its gateway’s 504): a warning, no error mail - and no route', async () => {
    config.openRouteService.apiKey = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>504 Gateway Time-out</html>', { status: 504 })),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(await computeDrivingRoute(from, to)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('504'));
    expect(error).not.toHaveBeenCalled();
  });

  it('a refused request is our mistake: an error', async () => {
    config.openRouteService.apiKey = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad key', { status: 403 })),
    );
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect(await computeDrivingRoute(from, to)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('403 bad key'));
  });

  it('gives up on a slow answer within its time limit', async () => {
    config.openRouteService.apiKey = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url, { signal }) =>
          new Promise((resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason)),
          ),
      ),
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const started = Date.now();
    expect(await computeDrivingRoute(from, to)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(7000);
    expect(warn).toHaveBeenCalled();
  }, 10000);
});
