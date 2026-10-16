import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';

// Crawlers and browsers ask the API host for these too - they get an
// answer instead of a 404 in the error log.
describe('robots.txt and favicon.ico', () => {
  it('serves robots.txt: AI-training crawlers out, the rest may crawl', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('User-agent: GPTBot');
    expect(res.text).toMatch(/User-agent: \*\nAllow: \/\n$/);
  });

  it('answers favicon.ico with an empty 204', async () => {
    const res = await request(app).get('/favicon.ico');
    expect(res.status).toBe(204);
  });
});
