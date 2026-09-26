# Push notifications

How Bódorgó sends notifications to phones and computers, even when the site
isn't open - and what the web app manifest and the service worker are for.

## The idea in one paragraph

A website can show real system notifications (lock screen, notification
centre) through the **Web Push** standard. The user allows notifications once
per device; the browser then gives the site a private address at its **push
service** (Google for Chrome/Edge/Android, Mozilla for Firefox, Apple for
Safari/iPhone). When something happens, our server posts a small encrypted
message to that address, the push service delivers it to the device, and the
site's **service worker** shows it. No app store, no Firebase or Apple
developer account, no cost.

## The moving parts

```
 Browser (per device)                    Our server                Push service
 ─────────────────────                   ──────────                ────────────
 Profilom: switch on ──► permission ──►  POST /push/subscriptions
   subscribe() returns an address   ──►  stored (PushSubscription)
                                         new chat post ──► rules ──► webpush.send ──► device
 sw.js wakes up, shows the notification ◄─────────────────────────────────────────┘
 tap ──► opens /chat?tabor=<tour>
```

### Service worker - `client/src/sw.js`

A small script the browser installs for the site and keeps around, separate
from the page. It can wake up on its own when a push message arrives, even
with every Bódorgó tab closed. Ours does only two things:

- `push`: shows the notification (title, text, icon) from the message.
- `notificationclick`: opens or focuses the site on the right page.

It does **no** offline caching - it isn't an "offline app", only the
notification receiver. It's served from the site root (`/sw.js`) so it covers
the whole site; `angular.json` copies it into the build.

### Web app manifest - `client/src/manifest.webmanifest`

A small JSON file describing the site as an installable app: its name, the
orange "B" icon (`assets/icons/app/`), colours and that it opens full-screen
(`"display": "standalone"`). It lets people add bodorgo.hu to their phone's
Home Screen, where it opens like an app. **On iPhone this is required**:
Apple only allows web push for sites added to the Home Screen and opened from
there (iOS 16.4+). `index.html` links it, plus the Apple icon and theme colour.

### VAPID keys - `.env`

Our server signs every push message with its own key pair, so the push
services know it's really us. It's generated once and lives in the `.env`
files (never in git):

```
VAPID_PUBLIC_KEY=...    # also given to the browser when subscribing
VAPID_PRIVATE_KEY=...   # secret
VAPID_SUBJECT=https://bodorgo.hu
```

**Every server must use the same pair** (the live server and a dev machine
share the database): a device subscribed with one pair can only be reached
with that pair. Without the keys, push is simply off (`/push/public-key`
returns null and the Profilom switch explains it).

## What gets sent - the chat

When someone writes in a tour's chat, the tour's attendees (except the
author) may get a notification. To keep phones from ringing at every message
(`server/src/chat/chatNotifications.js`):

1. **One buzz, then quiet until read.** The first new message buzzes. Further
   ones update the *same* notification silently ("3 új üzenet · …") - they
   share a `tag`, so there's only ever one per tour chat. Once the person opens
   the chat again, the next message buzzes again.
2. **Nothing while watching.** Whoever has that chat open *and visible* on any
   device gets nothing. The chat page tells the server when its tab goes to
   the background (`chat-visible` socket event).
3. **Mentions always get through.** `@username` in a message buzzes that
   person even during the quiet period - and even in a muted chat. Typing
   `@` in the chat suggests the tour's attendees; mentions are highlighted
   in the messages (a mention of you in yellow).
4. **Muting.** The 🔔 in the chat's corner mutes one tour's chat for oneself
   (except for messages that name you).

Usernames are what mentions refer to: 3-40 letters (accented too), numbers,
`.`, `_` or `-`, no spaces - and unique ignoring case and accents, so
`@bela` means Béla (see `server/src/utils/usernames.js`). Admins can fill them in for everyone at
once on Klub → Beállítások (with suggestions from the names); everyone can
change their own in Profilom.

"Read" and "buzzed" are remembered per user per tour in `ChatReadState`
(`readAt`, `notifiedAt`, `muted`).

## Where things live

| Piece | File |
|---|---|
| Service worker | `client/src/sw.js` |
| Manifest + icons | `client/src/manifest.webmanifest`, `client/src/assets/icons/app/` |
| Browser side (permission, subscribe, mutes) | `client/src/app/services/push.ts` |
| Profilom switch + test button | `client/src/app/pages/klub/profile/` |
| Chat bell, `?tabor=` link, visibility | `client/src/app/pages/chat/`, `services/tour-socket.ts` |
| Sending (web-push library) | `server/src/utils/push.js` |
| Chat rules | `server/src/chat/chatNotifications.js` |
| HTTP routes (`/push/...`) | `server/src/controllers/pushController.js`, `routes/pushRoutes.js` |
| Devices / chat read state | `server/src/models/pushSubscriptionModel.js`, `chatReadStateModel.js` |
| Tests | `server/tests/api/push.test.js` |

A device the push service reports as gone (HTTP 404/410 - the user cleared
the site's data, uninstalled the browser...) is deleted automatically.

## Trying it

1. Profilom → **Értesítések ezen az eszközön** → allow in the browser's prompt.
2. **Próbaértesítés küldése** → a notification within seconds.
3. Chat rules: needs a second account writing in a tour you attend, with your
   own chat closed or in the background.

Browsers allow it on `http://localhost` too. After changing `angular.json`,
restart `ng serve` - otherwise `/sw.js` answers 404.

## When it doesn't show up

- **Nothing arrives at all:** notifications for the browser may be off in the
  operating system (Windows: Settings → System → Notifications; phones: the
  browser's app notification settings), or Focus / Do not disturb is on.
- **Switch says "le vannak tiltva":** the site was blocked in the browser -
  re-allow it in the site settings (the padlock next to the address).
- **iPhone:** add to Home Screen first (Share → „Főképernyőhöz adás"), open
  from that icon, then switch it on in Profilom.
- **Android:** Chrome must be allowed to run in the background (battery
  savers can delay messages).

## Adding more notification types

Call `sendPushToUsers(userIds, { title, body, tag, url })` from
`server/src/utils/push.js`. Use a distinct `tag` per kind of thing (e.g.
`letter-<tourId>`), so repeats replace each other instead of piling up.
Candidates: a new admin letter to attendees, a tour's video is ready, the
Szobabeosztás was finalized, a day-before-the-tour reminder.
