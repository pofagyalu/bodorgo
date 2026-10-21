import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createAdmin, createMember, createTour } from '../helpers/factories.js';
import { openMediaVideos } from '../helpers/media.js';
import { clearTourVideoCache } from '../../src/utils/tourVideos.js';

// ffmpeg itself is faked: each run "succeeds" at once, and the one that
// writes a file (the second pass) leaves 'small:<the original's path>' in
// it. `runs` keeps every run's arguments.
const runs = vi.hoisted(() => []);
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: (command, args) => {
    runs.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', null);
    setImmediate(() => {
      if (args.includes('-encoders')) {
        child.stdout.emit('data', ' A....D libfdk_aac  Fraunhofer FDK AAC');
      } else if (args.at(-1) !== '-') {
        fs.writeFileSync(args.at(-1), `small:${args[args.indexOf('-i') + 1]}`);
      }
      child.emit('close', 0);
    });
    return child;
  },
}));

const mediaRoot = process.env.MEDIA_VIDEOS_ROOT;
const tourRoot = process.env.VIDEOS_ROOT;
const copies = path.join(process.env.THUMBNAILS_ROOT, '_videos');
const put = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const season = 'Season 09';

beforeAll(() => {
  put(mediaRoot, 'szilveszter/Season 01/Szilveszter (2024) S01E04.mp4', 'original-2024');
  put(mediaRoot, 'szilveszter/Season 01/Szilveszter (2022) S01E03.mp4', 'original-2022');
  put(tourRoot, `${season}/31 - Valahol (2025) S09E01.mp4`, 'tour-original');
});
beforeEach(async () => {
  clearTourVideoCache();
  // Every member sees them (a new one would be the admins' alone).
  await openMediaVideos();
});

const szilveszter = async (user) =>
  (await request(app).get('/media/videos').set(asUser(user))).body.data.categories.find(
    (c) => c.key === 'szilveszter',
  ).videos;
const body = (req) =>
  req.buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks).toString()));
  });
const jobs = async (admin) =>
  (await request(app).get('/media/videos/small-copies').set(asUser(admin))).body.data.jobs;
// Until the (faked) conversion of `ref` is over.
const finished = async (admin, ref) => {
  for (let i = 0; i < 100; i++) {
    const job = (await jobs(admin)).find((j) => j.ref === ref);
    if (job && job.state !== 'queued' && job.state !== 'converting') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`still converting: ${ref}`);
};

describe("the videos' small copies", () => {
  it('an admin has one made; it then plays unless the original is asked for', async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const [v2024, v2022] = await szilveszter(member);
    expect([v2024.small, v2022.small]).toEqual(['none', 'none']);
    const base = `/media/videos/szilveszter/${v2024.id}`;

    // Admins only - the conversions and their list.
    expect((await request(app).post(`${base}/small`).set(asUser(member))).status).toBe(403);
    expect((await request(app).delete(`${base}/small`).set(asUser(member))).status).toBe(403);
    expect((await request(app).get('/media/videos/small-copies').set(asUser(member))).status).toBe(
      403,
    );

    const started = await request(app).post(`${base}/small`).set(asUser(admin));
    expect(started.status).toBe(202);
    const ref = `media:szilveszter:${v2024.id}`;
    expect(started.body.data.job.ref).toBe(ref);
    expect(await finished(admin, ref)).toEqual({ ref, state: 'ready' });

    // Two passes of libx264 at the small copy's settings, the second with
    // sound and the index in front.
    const [pass1, pass2] = runs.filter((a) => a.includes('-pass'));
    expect(pass1).toEqual(expect.arrayContaining(['-pass', '1', '-an', '-b:v', '1800k']));
    expect(pass2).toEqual(
      expect.arrayContaining(['-pass', '2', '-c:a', 'libfdk_aac', '-b:a', '96k', '+faststart']),
    );

    // Kept by the original's place, name and size - nothing else.
    const original = path.join(mediaRoot, 'szilveszter/Season 01/Szilveszter (2024) S01E04.mp4');
    const copy = path.join(
      copies,
      `szilveszter/Season 01/Szilveszter (2024) S01E04.${'original-2024'.length}.mp4`,
    );
    expect(fs.existsSync(copy)).toBe(true);
    expect(fs.existsSync(`${copy}.part`)).toBe(false);

    expect((await szilveszter(member)).map((v) => v.small)).toEqual(['ready', 'none']);
    const get = (query = '') => body(request(app).get(`${base}/video${query}`).set(asUser(member)));
    expect((await get()).body).toBe(`small:${original}`);
    expect((await get('?quality=small')).body).toBe(`small:${original}`);
    expect((await get('?quality=original')).body).toBe('original-2024');
    expect(
      (await request(app).get(`${base}/video`).set(asUser(member)).set('Range', 'bytes=0-4'))
        .status,
    ).toBe(206);
    // A video without one: the original, whatever is asked for.
    expect(
      (
        await body(
          request(app)
            .get(`/media/videos/szilveszter/${v2022.id}/video?quality=small`)
            .set(asUser(member)),
        )
      ).body,
    ).toBe('original-2022');

    // Asked again: it's there already, nothing is converted.
    const before = runs.length;
    const again = await request(app).post(`${base}/small`).set(asUser(admin));
    expect(again.body.data.job).toEqual({ ref, state: 'ready' });
    expect(runs.length).toBe(before);

    // A replaced original (another size) has no copy any more...
    fs.writeFileSync(original, 'original-2024-recut');
    expect((await szilveszter(member))[0].small).toBe('none');
    expect((await get()).body).toBe('original-2024-recut');
    // ...and making it again clears the old one away.
    await request(app).post(`${base}/small`).set(asUser(admin));
    await finished(admin, ref);
    expect(fs.existsSync(copy)).toBe(false);
    expect((await szilveszter(member))[0].small).toBe('ready');

    // Removed: the original plays again.
    expect((await request(app).delete(`${base}/small`).set(asUser(admin))).status).toBe(204);
    expect((await szilveszter(member))[0].small).toBe('none');
    expect((await get()).body).toBe('original-2024-recut');
    expect((await jobs(admin)).find((j) => j.ref === ref)).toBeUndefined();
    expect(fs.readdirSync(path.dirname(copy))).toEqual([]);
  });

  it("a tour video's, the same way", async () => {
    const admin = await createAdmin();
    const member = await createMember();
    const tour = await createTour({ order: 31 });
    const videos = async () =>
      (await request(app).get(`/tours/${tour._id}`).set(asUser(member))).body.data.videos;
    const [video] = await videos();
    expect(video.small).toBe('none');
    const base = `/tours/${tour._id}/videos/${video.id}`;

    expect((await request(app).post(`${base}/small`).set(asUser(member))).status).toBe(403);
    expect((await request(app).post(`${base}/small`).set(asUser(admin))).status).toBe(202);
    await finished(admin, `tour:${tour._id}:${video.id}`);

    expect((await videos())[0].small).toBe('ready');
    // Under the tour videos' own folder name.
    expect(
      fs.existsSync(
        path.join(
          copies,
          path.basename(tourRoot),
          season,
          `31 - Valahol (2025) S09E01.${'tour-original'.length}.mp4`,
        ),
      ),
    ).toBe(true);
    const get = (query = '') => body(request(app).get(`${base}/video${query}`).set(asUser(member)));
    expect((await get()).body).toMatch(/^small:/);
    expect((await get('?quality=original')).body).toBe('tour-original');

    expect((await request(app).delete(`${base}/small`).set(asUser(admin))).status).toBe(204);
    expect((await get()).body).toBe('tour-original');
  });
});
