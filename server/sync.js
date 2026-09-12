import fs from 'fs';
import path from 'path';

const source = path.resolve('dist');
const dest = 'S:/bodorgo';

fs.cpSync(source, dest, { recursive: true, force: true });
console.log('✓ Synced dist → S:/bodorgo');
