import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { memberGuard } from './auth/member.guard';
import { adminGuard } from './auth/admin.guard';
import { authGuard } from './auth/auth.guard';

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
  // Chat/Szavazások/Versenyek are routed but still in early development
  {
    path: 'chat',
    title: 'Bódorgó chat',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/chat/chat').then((m) => m.Chat),
  },
  {
    path: 'szavazasok',
    title: 'Bódorgó szavazások',
    loadComponent: () => import('./pages/szavazasok/szavazasok').then((m) => m.Szavazasok),
  },
  {
    path: 'versenyek',
    title: 'Bódorgó versenyek',
    loadComponent: () => import('./pages/versenyek/versenyek').then((m) => m.Versenyek),
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
        loadComponent: () => import('./pages/klub/member-edit/member-edit').then((m) => m.MemberEdit),
      },
      {
        path: 'felhasznalok/:id',
        title: 'Tag szerkesztése',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/klub/member-edit/member-edit').then((m) => m.MemberEdit),
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
    ],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
