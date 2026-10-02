import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { memberGuard } from './auth/member.guard';
import { adminGuard } from './auth/admin.guard';
import { authGuard } from './auth/auth.guard';
import { mokaGuard } from './auth/moka.guard';
import { futokorAdminGuard } from './auth/futokor.guard';

// Home stays eager since it's the near-universal first page hit; every
// other route is lazy so its own code (and whatever heavy libraries it
// pulls in - exceljs for TourDetails' export, socket.io-client for Chat,
// etc.) only loads once someone actually navigates there, instead of all
// being bundled into the app's initial chunk.
export const routes: Routes = [
  { path: '', component: Home },
  {
    path: 'taborok',
    title: 'Bódorgó táborok',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/tours/tours').then((m) => m.Tours),
  },
  // Both declared before the generic taborok/:id below, so "uj" and
  // ":id/szerkesztes" match here first rather than being swallowed as a
  // tour id/slug.
  {
    path: 'taborok/uj',
    title: 'Új tábor',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/tour-edit/tour-edit').then((m) => m.TourEdit),
  },
  {
    path: 'taborok/:id/szerkesztes',
    title: 'Tábor szerkesztése',
    canActivate: [adminGuard],
    loadComponent: () => import('./pages/tour-edit/tour-edit').then((m) => m.TourEdit),
  },
  {
    path: 'taborok/:id/befizetes',
    title: 'Előleg befizetés',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/payment/payment').then((m) => m.Payment),
  },
  {
    path: 'taborok/:id',
    title: 'Tábor részletei',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/tour-details/tour-details').then((m) => m.TourDetails),
  },
  {
    path: 'chat',
    title: 'Bódorgó Kotyogó',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/chat/chat').then((m) => m.Chat),
  },
  {
    path: 'szavazasok',
    title: 'Bódorgó voks',
    loadComponent: () => import('./pages/szavazasok/szavazasok').then((m) => m.Szavazasok),
  },
  {
    // Where a Futókör card's QR code leads: fk/<token> - short, so the code
    // is coarse and reads from further away. The address is printed on the
    // cards: it must never change. No guard: it has to open without a
    // connection too.
    path: 'fk/:token',
    title: 'Futókör',
    loadComponent: () => import('./pages/moka/futokor/tag/tag').then((m) => m.FutokorTagPage),
  },
  {
    // The cards' first address, from before fk/ - kept working.
    path: 'versenyek/t/:token',
    title: 'Futókör',
    loadComponent: () => import('./pages/moka/futokor/tag/tag').then((m) => m.FutokorTagPage),
  },
  // The race's first address, from before it moved under Móka.
  { path: 'versenyek', pathMatch: 'full', redirectTo: 'moka/futokor' },
  {
    // The privacy notice - public, linked from the footer.
    path: 'adatkezeles',
    title: 'Bódorgó adatkezelés',
    loadComponent: () => import('./pages/adatkezeles/adatkezeles').then((m) => m.Adatkezeles),
  },
  {
    path: 'login',
    title: 'Bódorgó, gyere bé',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    // The club's videos (and later event photos) that don't belong to one
    // tour - members only, the whole section.
    path: 'media',
    canActivate: [memberGuard],
    loadComponent: () => import('./pages/media/media').then((m) => m.Media),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'videok' },
      {
        path: 'videok',
        title: 'Média – Videók',
        loadComponent: () => import('./pages/media/videos/videos').then((m) => m.Videos),
      },
      {
        path: 'videok/:category',
        title: 'Média – Videók',
        loadComponent: () => import('./pages/media/videos/videos').then((m) => m.Videos),
      },
      {
        path: 'fotok',
        title: 'Média – Fotók',
        loadComponent: () => import('./pages/media/photos/photos').then((m) => m.Photos),
      },
      {
        path: 'fotok/:category',
        title: 'Média – Fotók',
        loadComponent: () => import('./pages/media/photos/photos').then((m) => m.Photos),
      },
      // Zene: the two playlists as cards, then each one's own page -
      // Bódorgó FM and Buli (pages/media/music).
      {
        path: 'zene',
        pathMatch: 'full',
        title: 'Média – Zene',
        loadComponent: () => import('./pages/media/music/music-home').then((m) => m.MusicHome),
      },
      {
        path: 'zene/bodorgo-fm',
        title: 'Média – Bódorgó FM',
        loadComponent: () => import('./pages/media/music/music').then((m) => m.Music),
      },
      {
        path: 'zene/buli',
        title: 'Média – Buli rádió',
        loadComponent: () => import('./pages/media/music/party').then((m) => m.Party),
      },
    ],
  },
  {
    // Móka: the games - Darts, and Futókörök, the running race (the
    // server's side: src/jatekok, src/futokor).
    path: 'moka',
    canActivate: [mokaGuard],
    loadComponent: () => import('./pages/moka/moka').then((m) => m.Moka),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'darts' },
      {
        path: 'darts',
        title: 'Móka – Darts',
        loadComponent: () => import('./pages/moka/darts/darts-home').then((m) => m.DartsHome),
      },
      // Before darts/:id, so "uj" isn't taken for a game's id.
      {
        path: 'darts/uj',
        title: 'Darts – Új játék',
        loadComponent: () =>
          import('./pages/moka/darts/darts-setup/darts-setup').then((m) => m.DartsSetup),
      },
      {
        path: 'darts/:id',
        title: 'Darts',
        loadComponent: () =>
          import('./pages/moka/darts/darts-game/darts-game').then((m) => m.DartsGamePage),
      },
      {
        path: 'futokor',
        title: 'Móka – Futókörök',
        loadComponent: () => import('./pages/moka/futokor/futokor-home').then((m) => m.FutokorHome),
      },
      {
        path: 'futokor/eredmenyek',
        title: 'Futókörök – Eredmények',
        loadComponent: () =>
          import('./pages/moka/futokor/results/results').then((m) => m.FutokorResults),
      },
      {
        path: 'futokor/eredmenyek/:id',
        title: 'Futókörök – Eredmények',
        loadComponent: () =>
          import('./pages/moka/futokor/results/results').then((m) => m.FutokorResults),
      },
      {
        path: 'futokor/utmutato',
        title: 'Futókörök – Útmutató',
        loadComponent: () => import('./pages/moka/futokor/guide/guide').then((m) => m.FutokorGuide),
      },
      // The club's cards are the admins'.
      {
        path: 'futokor/kartyak',
        title: 'Futókörök – Kártyák',
        canActivate: [futokorAdminGuard],
        loadComponent: () => import('./pages/moka/futokor/cards/cards').then((m) => m.FutokorCards),
      },
      {
        // Everyone's: their own tracks (and, for admins, the tours' courses).
        path: 'futokor/palyaszerkeszto',
        title: 'Futókörök – Pályaszerkesztő',
        loadComponent: () =>
          import('./pages/moka/futokor/editor/editor').then((m) => m.FutokorEditor),
      },
      // Its first address.
      { path: 'futokor/palyak', pathMatch: 'full', redirectTo: 'futokor/palyaszerkeszto' },
    ],
  },
  {
    // No guard at the parent level any more - Profilom (below) is for every
    // logged-in user, guest included. The member/admin-only subpages each
    // carry their own memberGuard instead (see below).
    path: 'klub',
    loadComponent: () => import('./pages/klub/klub').then((m) => m.Klub),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'profilom' },
      {
        path: 'attekintes',
        title: 'Klub áttekintés',
        canActivate: [memberGuard],
        loadComponent: () => import('./pages/klub/overview/overview').then((m) => m.Overview),
      },
      {
        path: 'penzugyek',
        title: 'Klubpénzügyek',
        canActivate: [memberGuard],
        loadComponent: () => import('./pages/klub/finance/finance').then((m) => m.Finance),
      },
      {
        path: 'felhasznalok',
        title: 'Klub felhasználók',
        canActivate: [memberGuard],
        loadComponent: () => import('./pages/klub/members/members').then((m) => m.Members),
      },
      {
        // Registered before felhasznalok/:id below - the router matches
        // routes in array order, so this literal path has to come first or
        // felhasznalok/:id would swallow it, treating "uj" as an id.
        path: 'felhasznalok/uj',
        title: 'Új felhasználó',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/klub/member-edit/member-edit').then((m) => m.MemberEdit),
      },
      {
        path: 'felhasznalok/:id',
        title: 'Tag szerkesztése',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/klub/member-edit/member-edit').then((m) => m.MemberEdit),
      },
      {
        path: 'dokumentumok',
        title: 'Klub dokumentumok',
        canActivate: [memberGuard],
        loadComponent: () => import('./pages/klub/documents/documents').then((m) => m.Documents),
      },
      {
        path: 'beallitasok',
        title: 'Klub beállítások',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/klub/settings/settings').then((m) => m.KlubSettings),
      },
      {
        path: 'profilom',
        title: 'Klub profilom',
        loadComponent: () => import('./pages/klub/profile/profile').then((m) => m.KlubProfile),
      },
      {
        // The privacy notice again (see 'adatkezeles' above), opened from
        // Profilom - here it stays inside the Klub shell, and under
        // profilom/ so the sidebar keeps Profilom highlighted.
        path: 'profilom/adatkezeles',
        title: 'Bódorgó adatkezelés',
        loadComponent: () => import('./pages/adatkezeles/adatkezeles').then((m) => m.Adatkezeles),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
