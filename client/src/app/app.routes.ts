import { Routes, UrlMatcher, UrlSegment } from '@angular/router';
import { Home } from './pages/home/home';
import { mediaMemberGuard, memberGuard } from './auth/member.guard';
import { adminGuard } from './auth/admin.guard';
import { authGuard } from './auth/auth.guard';
import { mokaGuard } from './auth/moka.guard';
import { futokorAdminGuard } from './auth/futokor.guard';
import { songEditGuard } from './auth/song-edit.guard';

// "videok" and "videok/<category>" as one route, so the page stays the
// same one while its category is changed (its tabs' underline can slide,
// the row keeps where it was scrolled) - Angular builds the page anew
// between two routes.
function withCategory(base: string, albums = false): UrlMatcher {
  return (segments) => {
    if (!segments.length || segments.length > (albums ? 3 : 2) || segments[0].path !== base) {
      return null;
    }
    const posParams: Record<string, UrlSegment> = {};
    if (segments[1]) posParams['category'] = segments[1];
    if (segments[2]) posParams['album'] = segments[2];
    return { consumed: segments, posParams };
  };
}

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
    // The club's videos and photos that don't belong to one tour - the
    // members' (a guest is taken to Zene) - and Zene: the playlists and the
    // songbook, for everyone logged in.
    path: 'media',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/media/media').then((m) => m.Media),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'videok' },
      {
        matcher: withCategory('videok'),
        canActivate: [mediaMemberGuard],
        title: 'Média – Videók',
        loadComponent: () => import('./pages/media/videos/videos').then((m) => m.Videos),
      },
      {
        // A photo category may have albums: fotok/<category>/<album>.
        matcher: withCategory('fotok', true),
        canActivate: [mediaMemberGuard],
        title: 'Média – Fotók',
        loadComponent: () => import('./pages/media/photos/photos').then((m) => m.Photos),
      },
      // Zene: the playlists as cards, then each one's own page - Bódorgó
      // FM, and Buli and Duruzsoló: one page in two looks, the playlist in
      // data.list (pages/media/music).
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
        data: { list: 'buli' },
        loadComponent: () =>
          import('./pages/media/music/styled-playlist/styled-playlist').then(
            (m) => m.StyledPlaylist,
          ),
      },
      {
        path: 'zene/hatter',
        title: 'Média – Duruzsoló',
        data: { list: 'hatter' },
        loadComponent: () =>
          import('./pages/media/music/styled-playlist/styled-playlist').then(
            (m) => m.StyledPlaylist,
          ),
      },
      // Daloskönyv: the songbook (pages/daloskonyv). Its editor - for a
      // new song, or one's own - comes first, so "uj" isn't taken for a
      // song's slug.
      {
        path: 'zene/daloskonyv/uj',
        title: 'Daloskönyv – Új dal',
        canActivate: [songEditGuard],
        loadComponent: () =>
          import('./pages/daloskonyv/song-edit/song-edit').then((m) => m.SongEdit),
      },
      {
        path: 'zene/daloskonyv/:slug/szerkesztes',
        title: 'Daloskönyv – Szerkesztés',
        canActivate: [songEditGuard],
        loadComponent: () =>
          import('./pages/daloskonyv/song-edit/song-edit').then((m) => m.SongEdit),
      },
      {
        // The open song is the child, beside the list on a wide screen.
        path: 'zene/daloskonyv',
        title: 'Média – Daloskönyv',
        loadComponent: () => import('./pages/daloskonyv/daloskonyv').then((m) => m.Daloskonyv),
        children: [
          // The pages that aren't songs: the tuner, the circle of fifths,
          // the keys' chords (pages/daloskonyv/annexes.ts).
          {
            path: 'melleklet/:annex',
            title: 'Média – Daloskönyv',
            loadComponent: () => import('./pages/daloskonyv/annex/annex').then((m) => m.AnnexPage),
          },
          {
            path: ':slug',
            title: 'Média – Daloskönyv',
            loadComponent: () => import('./pages/daloskonyv/song/song').then((m) => m.SongPage),
          },
        ],
      },
    ],
  },
  // The songbook's address from when guests had it on a page of its own
  // (they had no Média): now inside Média → Zene for everyone - the old
  // links (a song's, the editor's) lead to the same page there.
  { path: 'daloskonyv', redirectTo: 'media/zene/daloskonyv' },
  {
    // Móka: the games - Darts, Futókörök (the running race) and Kvíz (the
    // server's side: src/jatekok, src/futokor).
    path: 'moka',
    canActivate: [mokaGuard],
    canActivateChild: [mokaGuard],
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
        // Futókörök's opening page; the running itself is Futás.
        path: 'futokor',
        title: 'Móka – Futókörök',
        loadComponent: () =>
          import('./pages/moka/futokor/futokor-landing').then((m) => m.FutokorLanding),
      },
      {
        path: 'futokor/futas',
        title: 'Futókörök – Futás',
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
      // Kvíz: the games (to join, and the ones played), and the quizzes
      // themselves with their editor - for everyone logged in already
      // (see moka.guard.ts).
      { path: 'kviz', pathMatch: 'full', redirectTo: 'kviz/jatekok' },
      {
        path: 'kviz/jatekok',
        title: 'Kvíz – Játékszoba',
        loadComponent: () => import('./pages/moka/quiz/quiz-home').then((m) => m.QuizHome),
      },
      {
        // A game, live: where its QR code leads.
        path: 'kviz/jatekok/:id',
        title: 'Kvíz',
        loadComponent: () =>
          import('./pages/moka/quiz/quiz-game/quiz-game').then((m) => m.QuizGamePage),
      },
      {
        path: 'kviz/szerkeszto',
        title: 'Kvíz – Alkotóműhely',
        loadComponent: () =>
          import('./pages/moka/quiz/quiz-list/quiz-list').then((m) => m.QuizList),
      },
      // Before szerkeszto/:id, so "uj" isn't taken for a quiz's id.
      {
        path: 'kviz/szerkeszto/uj',
        title: 'Kvíz – Új kvíz',
        loadComponent: () =>
          import('./pages/moka/quiz/quiz-edit/quiz-edit').then((m) => m.QuizEdit),
      },
      {
        path: 'kviz/szerkeszto/:id',
        title: 'Kvíz – Szerkesztés',
        loadComponent: () =>
          import('./pages/moka/quiz/quiz-edit/quiz-edit').then((m) => m.QuizEdit),
      },
      {
        // What an answer is worth: read by everyone, set by the role manager.
        path: 'kviz/pontozas',
        title: 'Kvíz – Pontozás',
        loadComponent: () =>
          import('./pages/moka/quiz/quiz-scoring/quiz-scoring').then((m) => m.QuizScoringPage),
      },
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
