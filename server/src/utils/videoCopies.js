import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import config from '../config.js';
import logger from '../logger.js';
import { mp4DurationSeconds } from './mp4Duration.js';

// The videos' small copies: a 720p, ~1.9 Mbps version of a video, made by
// ffmpeg when an admin asks for it, and from then on what is played unless
// the viewer picks the original - the home line's upload carries ten of
// these at once, but only two of a 10 Mbps original.
//
// A copy is found by where it is, nothing about it is stored: under
// THUMBNAILS_ROOT/_videos (or VIDEO_COPIES_ROOT), in the same folders as
// the original under its library, named "<the original's name>.<the
// original's size in bytes>.mp4". So the folder alone carries them to
// another machine; a replaced original (another size) simply has none
// again. The size, not the date: a restore changes the dates.
//
// One conversion at a time (it takes the whole processor), at low
// priority, two passes: about 4.5x a 1080p video's length on the NAS. The
// queue is only in memory - a restart drops it, the admin asks again.

export const SMALL_COPY = { height: 720, maxFps: 30, videoKbps: 1800, audioKbps: 96 };

// At most 720 lines (never enlarged), and a 50/60 fps video at half that.
const FILTER = [
  `scale=-2:'min(${SMALL_COPY.height},ih)'`,
  `fps=fps='if(gt(source_fps,${SMALL_COPY.maxFps}),source_fps/2,source_fps)'`,
].join(',');

export function videoCopiesRoot() {
  if (config.videoCopiesRoot) return path.resolve(config.videoCopiesRoot);
  return config.thumbnailsRoot ? path.join(path.resolve(config.thumbnailsRoot), '_videos') : null;
}

// A video as the copies know it: `area` is its library folder's name
// ("farsang", "a-bodorgo-klan"), `root` that folder, `fullPath` the file.
// The path inside is taken from the file itself, so another spelling of it
// ("Season 01/./x.mp4") is still the same video.
const relOf = ({ root, fullPath }) => path.relative(root, fullPath).split(path.sep).join('/');
const keyOf = (video) => `${video.area}/${relOf(video)}`;

function copyPath(video) {
  const root = videoCopiesRoot();
  if (!root) return null;
  let size;
  try {
    ({ size } = fs.statSync(video.fullPath));
  } catch {
    return null;
  }
  const rel = relOf(video);
  const base = path.basename(rel, path.extname(rel));
  return path.join(root, video.area, path.dirname(rel), `${base}.${size}.mp4`);
}

// The video's copies of any size - the one of today's original and what an
// earlier one left behind.
function copiesOf(video) {
  const current = copyPath(video);
  if (!current) return [];
  const dir = path.dirname(current);
  const rel = relOf(video);
  const prefix = `${path.basename(rel, path.extname(rel))}.`;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(prefix) && /^\d+\.mp4(\.part)?$/.test(n.slice(prefix.length)))
    .map((n) => path.join(dir, n));
}

// key -> { key, ref, video, output, state, percent, error, child }
const jobs = new Map();
const queue = [];
let running = null;

const ACTIVE = new Set(['queued', 'converting', 'failed']);

// 'none' | 'queued' | 'converting' | 'ready' | 'failed'
export function smallCopyState(video) {
  const job = jobs.get(keyOf(video));
  if (job && ACTIVE.has(job.state)) return job.state;
  const copy = copyPath(video);
  return copy && fs.existsSync(copy) ? 'ready' : 'none';
}

// The file to send: the small copy unless the original was asked for (or
// there is none).
export function videoFileFor(video, quality) {
  if (quality === 'original') return video.fullPath;
  const copy = copyPath(video);
  return copy && fs.existsSync(copy) ? copy : video.fullPath;
}

const publicJob = (job) => ({
  ref: job.ref,
  state: job.state,
  ...(job.state === 'converting' ? { percent: job.percent } : {}),
  ...(job.error ? { error: job.error } : {}),
});

// Every conversion asked for since the server started - waiting, running,
// done or failed.
export const smallCopyJobs = () => [...jobs.values()].map(publicJob);

// Queues the video's conversion; `ref` is how the page knows it again
// ("media:<category>:<id>", "tour:<tourId>:<id>"). Asked again while it
// waits or runs, or when it is there already: nothing new happens.
export function requestSmallCopy(video, ref) {
  const key = keyOf(video);
  const output = copyPath(video);
  if (!output)
    return { ref, state: 'failed', error: 'A kis méretű videók mappája nincs beállítva.' };

  const known = jobs.get(key);
  if (known && (known.state === 'queued' || known.state === 'converting')) return publicJob(known);
  if (fs.existsSync(output)) return { ref, state: 'ready' };

  const job = { key, ref, video, output, state: 'queued', percent: 0, error: null, child: null };
  jobs.set(key, job);
  queue.push(job);
  next();
  return publicJob(job);
}

// Takes the copy away - and stops its conversion, if that's still going.
export function removeSmallCopy(video) {
  const key = keyOf(video);
  const job = jobs.get(key);
  if (job) {
    job.cancelled = true;
    const at = queue.indexOf(job);
    if (at >= 0) queue.splice(at, 1);
    job.child?.kill();
    jobs.delete(key);
  }
  for (const file of copiesOf(video)) fs.rmSync(file, { force: true });
}

function next() {
  if (running || !queue.length) return;
  const job = queue.shift();
  running = job;
  job.state = 'converting';
  convert(job)
    .then(
      () => {
        job.state = 'ready';
        logger.info(`Small video copy made: ${job.key}`);
      },
      (err) => {
        if (job.cancelled) return;
        job.state = 'failed';
        job.error = err.message;
        logger.error(`Small video copy failed (${job.key}): ${err.message}`);
      },
    )
    .finally(() => {
      job.child = null;
      running = null;
      next();
    });
}

// A conversion doesn't outlive the server.
process.on('exit', () => running?.child?.kill());

// One ffmpeg run; `onProgress` gets the seconds of video done so far.
function ffmpeg(job, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, args, { windowsHide: true });
    job.child = child;
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);
    } catch {
      // Not allowed here - it runs at the usual priority.
    }
    let errors = '';
    child.stderr?.on('data', (d) => {
      errors = (errors + d).slice(-2000);
    });
    child.stdout?.on('data', (d) => {
      // "out_time_us" (called out_time_ms in older ffmpegs) - microseconds.
      const times = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)];
      if (times.length && onProgress) onProgress(Number(times.at(-1)[1]) / 1e6);
    });
    child.on('error', (err) =>
      reject(
        new Error(
          err.code === 'ENOENT'
            ? `az ffmpeg nem található (${config.ffmpegPath}) - lásd FFMPEG_PATH`
            : err.message,
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(errors.trim().split('\n').at(-1) || `ffmpeg: ${code}`)),
    );
  });
}

// Fraunhofer's AAC encoder where this ffmpeg has it (it sounds better at
// 96 kbps), its own otherwise. Asked once.
let aacEncoder;
function audioEncoder() {
  aacEncoder ??= new Promise((resolve) => {
    let out = '';
    const child = spawn(config.ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true });
    child.stdout?.on('data', (d) => {
      out += d;
    });
    child.on('error', () => resolve('aac'));
    child.on('close', () => resolve(/\blibfdk_aac\b/.test(out) ? 'libfdk_aac' : 'aac'));
  });
  return aacEncoder;
}

async function convert(job) {
  const { video, output } = job;
  const part = `${output}.part`;
  const passLog = path.join(os.tmpdir(), `bodorgo-video-${process.pid}-${Date.now()}`);
  const duration = mp4DurationSeconds(video.fullPath);
  // Each pass is half of the work.
  const progress = (pass) => (seconds) => {
    if (duration) {
      job.percent = Math.min(99, Math.round(((pass + Math.min(1, seconds / duration)) / 2) * 100));
    }
  };
  const common = [
    ...['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1'],
    ...['-i', video.fullPath, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'],
    ...['-vf', FILTER, '-c:v', 'libx264', '-preset', 'slower', '-pix_fmt', 'yuv420p'],
    ...['-b:v', `${SMALL_COPY.videoKbps}k`],
    ...['-maxrate', `${Math.round(SMALL_COPY.videoKbps * 1.33)}k`],
    ...['-bufsize', `${Math.round(SMALL_COPY.videoKbps * 2.66)}k`],
    ...['-passlogfile', passLog],
  ];
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const audio = await audioEncoder();
    await ffmpeg(job, [...common, '-pass', '1', '-an', '-f', 'null', '-'], progress(0));
    await ffmpeg(
      job,
      [
        ...common,
        ...['-pass', '2', '-c:a', audio, '-b:a', `${SMALL_COPY.audioKbps}k`, '-ac', '2'],
        // The index in front: it starts playing at once.
        ...['-movflags', '+faststart', '-f', 'mp4', part],
      ],
      progress(1),
    );
    if (job.cancelled) throw new Error('megszakítva');
    // What an earlier original's copy left here goes.
    for (const old of copiesOf(video)) if (old !== part) fs.rmSync(old, { force: true });
    fs.renameSync(part, output);
  } finally {
    fs.rmSync(part, { force: true });
    for (const suffix of ['-0.log', '-0.log.mbtree', '-0.log.temp', '-0.log.mbtree.temp']) {
      fs.rmSync(passLog + suffix, { force: true });
    }
  }
}
