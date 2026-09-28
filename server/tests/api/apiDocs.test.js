import fs from 'fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember } from '../helpers/factories.js';
import { buildOpenApi } from '../../src/apiDocs/openapi.js';

// Every route the app has, as "METHOD /path/{param}" - read from the
// routers app.js mounts, plus the few routes app.js defines itself.
async function appRoutes() {
  const appSrc = fs.readFileSync('src/app.js', 'utf8');
  const files = Object.fromEntries(
    [...appSrc.matchAll(/import (\w+) from '\.\/routes\/(\w+)\.js'/g)].map((m) => [m[1], m[2]]),
  );
  const mounts = [...appSrc.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g)]
    .filter((m) => files[m[2]])
    .map((m) => ({ prefix: m[1], file: files[m[2]] }));
  // Every route file is mounted somewhere (so none escapes this check).
  const routeFiles = fs.readdirSync('src/routes').map((f) => f.replace(/\.js$/, ''));
  expect(mounts.map((m) => m.file).sort()).toEqual(routeFiles.sort());

  const routes = new Set([
    // Defined in app.js itself, not in a router file.
    'POST /payments/stripe/webhook',
  ]);
  for (const { prefix, file } of mounts) {
    const router = (await import(`../../src/routes/${file}.js`)).default;
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const p = `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`.replace(
        /:(\w+)/g,
        '{$1}',
      );
      for (const method of Object.keys(layer.route.methods)) {
        if (method !== '_all') routes.add(`${method.toUpperCase()} ${p}`);
      }
    }
  }
  return routes;
}

describe('API docs (/docs)', () => {
  const spec = buildOpenApi({ version: 'test' });
  const documented = new Set(
    Object.entries(spec.paths).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
    ),
  );

  it('documents every route, and nothing that does not exist', async () => {
    const routes = await appRoutes();
    expect([...routes].filter((r) => !documented.has(r)).sort()).toEqual([]);
    expect([...documented].filter((r) => !routes.has(r)).sort()).toEqual([]);
  });

  it('every operation has a known tag, a summary, a role badge and its path parameters', () => {
    const tagNames = new Set(spec.tags.map((t) => t.name));
    for (const [p, ops] of Object.entries(spec.paths)) {
      const placeholders = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const [method, op] of Object.entries(ops)) {
        const where = `${method.toUpperCase()} ${p}`;
        expect(tagNames.has(op.tags[0]), where).toBe(true);
        expect(op.summary, where).toBeTruthy();
        expect(op['x-badges']?.length, where).toBe(1);
        const declared = (op.parameters ?? [])
          .filter((x) => x.in === 'path')
          .map((x) => x.name)
          .sort();
        expect(declared, where).toEqual(placeholders);
      }
    }
  });

  it('is for admins only; they get the page, the spec and Scalar', async () => {
    const anonymous = await request(app).get('/docs');
    expect(anonymous.status).toBe(401);
    expect(anonymous.text).toContain('csak adminoknak');
    expect((await request(app).get('/docs/openapi.json')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/docs')
          .set(asUser(await createMember()))
      ).status,
    ).toBe(403);

    const admin = await createAdmin();
    const page = await request(app).get('/docs').set(asUser(admin));
    expect(page.status).toBe(200);
    expect(page.text).toContain('/docs/scalar.js');
    const json = await request(app).get('/docs/openapi.json').set(asUser(admin));
    expect(json.body.openapi).toBe('3.1.0');
    expect(json.body.info.title).toBe('Bódorgó API');
    const scalar = await request(app).get('/docs/scalar.js').set(asUser(admin));
    expect(scalar.status).toBe(200);
    expect(scalar.headers['content-type']).toContain('javascript');
  });
});
