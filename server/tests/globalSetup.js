import fs from 'fs';
import os from 'os';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Starts ONE throwaway MongoDB (in memory) for the whole test run and hands
// its address to every test file (see setup.js, which then uses its own
// separate database on it). Nothing here ever touches the real database.
let mongo;

export default async function setup(project) {
  mongo = await MongoMemoryServer.create();
  project.provide('mongoUri', mongo.getUri());

  return async () => {
    await mongo?.stop();
    // The temporary upload/receipt folders the test files used (setup.js).
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (name.startsWith('bodorgo-test-files-')) {
        fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
      }
    }
  };
}
