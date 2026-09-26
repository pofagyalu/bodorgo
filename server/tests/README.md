# Server tests

Automated tests for the API, run with [Vitest](https://vitest.dev).

```
npm test                 # run everything once
npm run test:watch       # re-run on every file change while developing
npm run test:coverage    # run + coverage report (fails below the threshold)
```

The coverage report is printed in the terminal and written as a browsable
page to `coverage/index.html` - it marks every untested line in red. The
minimum (`vitest.config.js`, `coverage.thresholds`) is 70% of lines and
statements; below that `npm run test:coverage` fails, which is what the CI
pipeline checks.

## Safe by design

- **Never the real database.** `globalSetup.js` starts a throwaway MongoDB in
  memory (`mongodb-memory-server` - the first run downloads the MongoDB
  binary once); every test file gets its own database on it, emptied after
  every test. The real database - which local development shares with
  production - is never touched.
- **Never the outside world.** `setup.js` replaces everything that would
  reach another service with fakes: email (Resend), Stripe, Barion, address
  lookup / driving routes, weather. The logger is silenced (the real one
  writes to `logs/`).
- **Never the real folders.** Uploaded documents and generated receipts go
  to a temporary folder (`src/utils/dataDirs.js`'s environment overrides).

## Writing a test

- `helpers/app.js` - the real Express app, plus `asUser(user)`: the headers
  that make a request come from that user (instead of an Authentik login).
  No header = logged out.
- `helpers/factories.js` - `createAdmin()`, `createMember()`,
  `createGuest()`, `createTour()`, `createReservation(tour, users)`, each
  with sensible defaults you can override.

```js
import request from 'supertest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createTour } from '../helpers/factories.js';

it('lists tours for a member', async () => {
  await createTour({ title: 'Mátra' });
  const res = await request(app)
    .get('/tours')
    .set(asUser(await createMember()));
  expect(res.status).toBe(200);
});
```

- `api/` - HTTP-level tests per area (tours, users, payments, chat over a
  real Socket.IO connection, login with a faked Authentik...).
- `unit/` - pure calculations (payment splitting, grammar, prices).
