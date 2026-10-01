import { execSync } from 'child_process';

/* global __BODORGO_BUILD__ */

// Which version is running: the commit it was built from (its first seven
// digits) and that commit's date - "2026.10.01 · adc1c34"; a + after it
// means it was built with changes not committed yet.
//
// A deployed server has it written into its bundle (build.js puts
// __BODORGO_BUILD__ there); run from the source it's read from git, with
// no build time.

function git(command) {
  return execSync(`git ${command}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function gitStamp() {
  try {
    const commit = git('rev-parse --short=7 HEAD');
    const date = git('log -1 --format=%cd --date=format:%Y.%m.%d');
    const dirty = git('status --porcelain --untracked-files=no') ? '+' : '';
    return { version: `${date} · ${commit}${dirty}`, commit, date };
  } catch {
    return { version: 'ismeretlen', commit: null, date: null };
  }
}

const build =
  typeof __BODORGO_BUILD__ !== 'undefined' ? __BODORGO_BUILD__ : { ...gitStamp(), builtAt: null };

export default build;
