// Makes the handover folder: everything needed to start the app again
// somewhere else, ready to be copied to a USB stick.
//
//   node scripts/makeHandover.mjs                     - all of it, into D:/bodorgo-handover/bodorgo-handover-<today>
//   node scripts/makeHandover.mjs --out E:/somewhere  - into another folder
//   node scripts/makeHandover.mjs --only db,secrets   - only some steps, into today's folder
//
// The steps (run from server/, on the owner's Windows machine, with Docker
// Desktop running and the NAS shares mapped):
//   source   the code as committed (HEAD): a zip, and a git bundle with main's history
//   images   bodorgo-api, bodorgo-web (built from that same commit, for the
//            live addresses) and mongo:8.0, in one `docker save` file
//   db       a fresh dump of the production database, then loaded into a
//            throwaway database to see that it really can be restored
//   files    the live server's uploads (documents, chat photos). Not the
//            thumbnails folder: gigabytes of photo sizes and video copies
//            that the server can make again from the originals
//   secrets  the live settings, the Docker settings ready to use, and
//            Authentik's own database and stack files - in a 7z archive
//            encrypted with a password you type (or HANDOVER_PASSWORD)
// The instructions (docker/HANDOVER.md) and a list of the contents with
// checksums are written every time.
//
// Production is only read. Nothing is committed, pushed or deployed.
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const LIVE_DIR = 'S:/bodorgo';
const LIVE_ENV = `${LIVE_DIR}/.env`;
const ECOSYSTEM = 'S:/ecosystem.config.js';
const NAS_DUMPS = 'Q:/bodorgo-db/hourly';
const AUTHENTIK_STACK = '//raktar/docker/dockge/stacks/authentik';
const SEVEN_ZIP = 'C:/Program Files/7-Zip/7z.exe';
// The address the website's image is built for (see client/Dockerfile).
const PUBLIC_API_URL = 'https://api.bodorgo.hu';
const DEFAULT_OUT = 'D:/bodorgo-handover';
const STEPS = ['source', 'images', 'db', 'files', 'secrets'];
const IMAGES = ['bodorgo-api:latest', 'bodorgo-web:latest', 'mongo:8.0'];
const FAT32_LIMIT = 4 * 1024 ** 3;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const only = arg('--only')
  ?.split(',')
  .map((s) => s.trim());
if (only?.some((s) => !STEPS.includes(s))) {
  throw new Error(`--only takes: ${STEPS.join(', ')}`);
}
const wanted = (step) => !only || only.includes(step);

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const stamp = `${today}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = path.join(path.resolve(arg('--out') ?? DEFAULT_OUT), `bodorgo-handover-${today}`);

const warnings = [];
const warn = (text) => {
  warnings.push(text);
  console.log(`  ! ${text}`);
};
const title = (text) => console.log(`\n== ${text}`);

// Runs a command with its output shown; anything but success stops the script.
function run(cmd, args, { okCodes = [0], ...options } = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (!okCodes.includes(result.status)) {
    throw new Error(`${path.basename(cmd)} ${args[0] ?? ''} failed (exit ${result.status})`);
  }
  return result;
}
// Runs a command and gives back what it printed.
function read(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(cmd)} ${args[0] ?? ''} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}
const git = (...args) => read('git', args, { cwd: repo });
const emptyDir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const commit = git('rev-parse', '--short=7', 'HEAD');
const commitDate = git('log', '-1', '--format=%cd', '--date=format:%Y.%m.%d');

console.log(`Handover folder: ${out}`);
console.log(`Code: ${commit} (${commitDate}) - ${git('log', '-1', '--format=%s')}`);
if (git('branch', '--show-current') !== 'main')
  warn("not on main: the code taken is this branch's last commit");
if (git('status', '--porcelain'))
  warn('uncommitted or untracked files are NOT in the handover - only what is committed');
fs.mkdirSync(out, { recursive: true });

// --- source ---------------------------------------------------------------
if (wanted('source')) {
  title('source: the code as committed');
  const dir = emptyDir(path.join(out, 'source'));
  // autocrlf off: the files exactly as the repository holds them, not as
  // this Windows machine checks them out.
  run(
    'git',
    [
      '-c',
      'core.autocrlf=false',
      'archive',
      '--format=zip',
      '--prefix=bodorgo/',
      '-o',
      path.join(dir, 'bodorgo-source.zip'),
      'HEAD',
    ],
    { cwd: repo },
  );
  run('git', ['bundle', 'create', path.join(dir, 'bodorgo.bundle'), 'main'], { cwd: repo });
  run('git', ['bundle', 'verify', path.join(dir, 'bodorgo.bundle')], { cwd: repo });
}

// --- images ---------------------------------------------------------------
if (wanted('images')) {
  title('images: built from the same commit');
  const dir = emptyDir(path.join(out, 'images'));
  const imageId = (name) => {
    const result = spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', name], {
      encoding: 'utf8',
    });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  // The images this machine has under the same names (the local try-out's,
  // built for localhost) get their names back afterwards.
  const mine = ['bodorgo-api:latest', 'bodorgo-web:latest'].map((name) => [name, imageId(name)]);
  // A clean checkout of HEAD beside the working folder: the images hold
  // exactly what the source zip holds.
  const context = path.join(os.tmpdir(), `bodorgo-handover-build-${process.pid}`);
  run('git', ['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', context, 'HEAD'], {
    cwd: repo,
  });
  try {
    const version = [
      '--build-arg',
      `BUILD_COMMIT=${commit}`,
      '--build-arg',
      `BUILD_DATE=${commitDate}`,
    ];
    run(
      'docker',
      ['build', '-f', 'server/Dockerfile', '-t', 'bodorgo-api:latest', ...version, '.'],
      { cwd: context },
    );
    run(
      'docker',
      [
        'build',
        '-f',
        'client/Dockerfile',
        '-t',
        'bodorgo-web:latest',
        ...version,
        '--build-arg',
        `API_BASE_URL=${PUBLIC_API_URL}`,
        '.',
      ],
      { cwd: context },
    );
    if (!imageId('mongo:8.0')) run('docker', ['pull', 'mongo:8.0']);
    run('docker', ['save', '-o', path.join(dir, 'bodorgo-images.tar'), ...IMAGES]);
  } finally {
    for (const [name, id] of mine) {
      const built = imageId(name);
      if (id && built !== id) spawnSync('docker', ['tag', id, name]);
      else if (!id && built) spawnSync('docker', ['rmi', name]);
    }
    spawnSync('git', ['worktree', 'remove', '--force', context], { cwd: repo });
  }
}

// --- db -------------------------------------------------------------------
if (wanted('db')) {
  title('db: a fresh dump of production');
  const dir = emptyDir(path.join(out, 'db'));
  const prodUri = dotenv.parse(fs.readFileSync(LIVE_ENV)).DB_URI;
  if (!prodUri || new URL(prodUri).pathname.slice(1) !== 'bodorgo') {
    throw new Error('The live .env\'s DB_URI is not the "bodorgo" database');
  }
  const file = `bodorgo-${stamp}.archive.gz`;
  // mongodump out of the mongo image (none is installed here); the address
  // goes in as an environment variable, not on the command line.
  const dumped = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'MONGO_URI',
      '-v',
      `${dir}:/out`,
      'mongo:8.0',
      'sh',
      '-c',
      `mongodump --uri="$MONGO_URI" --archive=/out/${file} --gzip`,
    ],
    { encoding: 'utf8', env: { ...process.env, MONGO_URI: prodUri } },
  );
  if (dumped.status !== 0) throw new Error(`mongodump failed:\n${dumped.stderr}`);
  const inDump = {};
  for (const [, name, count] of dumped.stderr.matchAll(
    /done dumping `?bodorgo\.([^`\s]+)`? \((\d+) documents?\)/g,
  )) {
    inDump[name] = Number(count);
  }

  // The proof: loaded into a database that lives only inside this one
  // container, and counted there.
  console.log('  loading it into a throwaway database to check it...');
  const counted = read('docker', [
    'run',
    '--rm',
    '-v',
    `${dir}:/dump:ro`,
    'mongo:8.0',
    'bash',
    '-c',
    'mkdir /tmp/db && mongod --fork --logpath /tmp/mongod.log --dbpath /tmp/db --bind_ip 127.0.0.1 >/dev/null' +
      ` && mongorestore --quiet --archive=/dump/${file} --gzip` +
      ' && mongosh --quiet --eval \'const d = db.getSiblingDB("bodorgo");' +
      " print(JSON.stringify(Object.fromEntries(d.getCollectionNames().map((n) => [n, d.getCollection(n).countDocuments()]))))'",
  ]);
  const restored = JSON.parse(counted.split('\n').pop());
  const names = Object.keys(inDump).sort();
  const wrong = names.filter((name) => restored[name] !== inDump[name]);
  if (!names.length || wrong.length) {
    throw new Error(
      `The dump did not restore as dumped: ${wrong.join(', ') || 'no collections found'}`,
    );
  }
  const total = names.reduce((sum, name) => sum + inDump[name], 0);
  fs.writeFileSync(
    path.join(dir, 'contents.txt'),
    [
      `${file}: database "bodorgo" (production), dumped ${stamp} with mongodump --archive --gzip.`,
      `Checked by restoring it into an empty MongoDB 8.0: ${names.length} collections, ${total} documents, all as dumped.`,
      '',
      ...names.map((name) => `${String(inDump[name]).padStart(8)}  ${name}`),
      '',
    ].join('\n'),
  );
  console.log(`  ${file}: ${names.length} collections, ${total} documents - restore checked`);
}

// --- files ----------------------------------------------------------------
if (wanted('files')) {
  title('files: uploads from the live server');
  for (const name of ['documents', 'chat-images']) {
    const from = path.join(LIVE_DIR, name);
    if (!fs.existsSync(from)) {
      warn(`${from} not found - left out`);
      continue;
    }
    console.log(`  ${name}...`);
    // robocopy: below 8 is success (1 = files copied, 0 = nothing to do).
    run(
      'robocopy',
      [
        path.normalize(from),
        path.join(out, 'files', name),
        '/MIR',
        '/R:2',
        '/W:5',
        '/NFL',
        '/NDL',
        '/NP',
        '/NJH',
        '/NJS',
      ],
      { okCodes: [0, 1, 2, 3, 4, 5, 6, 7] },
    );
  }
}

// --- secrets --------------------------------------------------------------
if (wanted('secrets')) {
  title('secrets: settings and Authentik, encrypted');
  const password = process.env.HANDOVER_PASSWORD;
  if (!password && !process.stdin.isTTY) {
    warn(
      'secrets NOT made: no terminal to ask the password in. Run: node scripts/makeHandover.mjs --only secrets',
    );
  } else {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'bodorgo-handover-secrets-'));
    try {
      fs.copyFileSync(LIVE_ENV, path.join(stage, 'server.env'));
      fs.copyFileSync(ECOSYSTEM, path.join(stage, 'ecosystem.config.js'));
      // compose.yaml's settings, filled in for the live addresses.
      const set = {
        MONGO_ROOT_PASSWORD: crypto.randomBytes(24).toString('hex'),
        PUBLIC_API_URL,
        BUILD_COMMIT: commit,
        BUILD_DATE: commitDate,
      };
      let dockerEnv = fs.readFileSync(path.join(repo, '.env.docker.example'), 'utf8');
      for (const [key, value] of Object.entries(set)) {
        dockerEnv = dockerEnv.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
      }
      fs.writeFileSync(path.join(stage, 'docker.env'), dockerEnv);

      // Authentik: its database alone (the NAS's hourly backup makes that
      // file), and the stack's two files.
      const authentik = path.join(stage, 'authentik');
      fs.mkdirSync(authentik);
      const dump = fs.existsSync(NAS_DUMPS)
        ? fs
            .readdirSync(NAS_DUMPS)
            .filter((f) => /^authentik-\d\d\.sql\.gz$/.test(f))
            .map((f) => ({ f, at: fs.statSync(path.join(NAS_DUMPS, f)).mtime }))
            .sort((a, b) => b.at - a.at)[0]
        : undefined;
      if (!dump) {
        warn(
          `no authentik-NN.sql.gz in ${NAS_DUMPS} - Authentik's database is NOT in the handover`,
        );
      } else {
        const at = dump.at;
        if (now - at > 2 * 3600 * 1000)
          warn(`the newest Authentik dump is from ${at.toLocaleString('hu-HU')}`);
        fs.copyFileSync(
          path.join(NAS_DUMPS, dump.f),
          path.join(
            authentik,
            `authentik-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}00.sql.gz`,
          ),
        );
      }
      for (const [from, to] of [
        ['compose.yaml', 'compose.yaml'],
        ['.env', 'authentik.env'],
      ]) {
        if (fs.existsSync(`${AUTHENTIK_STACK}/${from}`))
          fs.copyFileSync(`${AUTHENTIK_STACK}/${from}`, path.join(authentik, to));
        else warn(`${AUTHENTIK_STACK}/${from} not found - left out`);
      }

      const archive = path.join(out, 'secrets.7z');
      fs.rmSync(archive, { force: true });
      if (!password)
        console.log('  7-Zip now asks for the password, twice. Keep it in Vaultwarden.');
      // -mhe: the file names are encrypted too. Without a value -p asks.
      run(SEVEN_ZIP, ['a', '-t7z', '-mhe=on', '-mx=1', `-p${password ?? ''}`, archive, '*'], {
        cwd: stage,
      });
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}

// --- instructions and the list of contents --------------------------------
title('instructions and contents');
const dumpFile = fs.existsSync(path.join(out, 'db'))
  ? fs.readdirSync(path.join(out, 'db')).find((f) => f.endsWith('.archive.gz'))
  : undefined;
const fill = {
  DATE: today,
  COMMIT: commit,
  COMMIT_DATE: commitDate,
  DUMP_FILE: dumpFile ?? '(none)',
  API_URL: PUBLIC_API_URL,
};
fs.writeFileSync(
  path.join(out, 'READ-ME-FIRST.md'),
  fs
    .readFileSync(path.join(repo, 'docker/HANDOVER.md'), 'utf8')
    .replace(/\{\{(\w+)\}\}/g, (all, key) => fill[key] ?? all),
);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [{ full, size: fs.statSync(full).size }];
  });
const size = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
const all = walk(out).filter((f) => path.basename(f.full) !== 'CONTENTS.txt');
const lines = [`Bódorgó handover, made ${stamp} from commit ${commit} (${commitDate}).`, ''];
for (const part of [
  'READ-ME-FIRST.md',
  'source',
  'images',
  'db',
  'files/documents',
  'files/chat-images',
  'secrets.7z',
]) {
  const full = path.join(out, part);
  const inside = all.filter((f) => f.full === full || f.full.startsWith(full + path.sep));
  if (!inside.length) {
    lines.push(`${'MISSING'.padStart(10)}  ${part}`);
    warn(`${part} is missing from the folder`);
    continue;
  }
  lines.push(
    `${size(inside.reduce((sum, f) => sum + f.size, 0)).padStart(10)}  ${part}${inside.length > 1 ? `  (${inside.length} files)` : ''}`,
  );
}
const total = all.reduce((sum, f) => sum + f.size, 0);
lines.push(
  `${size(total).padStart(10)}  in all`,
  '',
  'SHA-256 of the files that are not plain copies:',
);
for (const f of all.filter((f) => !path.relative(out, f.full).startsWith('files'))) {
  lines.push(`${await sha256(f.full)}  ${path.relative(out, f.full).replaceAll('\\', '/')}`);
}
const tooBig = all.filter((f) => f.size >= FAT32_LIMIT);
if (tooBig.length)
  warn(
    `larger than 4 GB, so the stick must be exFAT or NTFS, not FAT32: ${tooBig.map((f) => path.basename(f.full)).join(', ')}`,
  );
fs.writeFileSync(path.join(out, 'CONTENTS.txt'), `${lines.join('\n')}\n`);

console.log(
  `\n${lines.slice(2, lines.indexOf('SHA-256 of the files that are not plain copies:') - 1).join('\n')}`,
);
console.log(
  warnings.length
    ? `\nDone, with ${warnings.length} thing(s) to look at:\n${warnings.map((w) => `  ! ${w}`).join('\n')}`
    : '\nDone.',
);
console.log(`\nCopy this folder to the stick: ${out}`);
