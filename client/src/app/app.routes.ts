import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { memberGuard } from './auth/member.guard';
import { adminGuard } from './auth/admin.guard';

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
    loadComponent: () => import('./pages/tours/tours').then((m) => m.Tours),
  },
  // Both declared before the generic taborok/:id below, so "uj" and
  // ":id/szerkesztes" match here first rather than being swallowed as a
  // tour id/slug.
  {
    path: 'taborok/uj',
    title: 'Új tábor',
    loadComponent: () => import('./pages/tour-edit/tour-edit').then((m) => m.TourEdit),
  },
  {
    path: 'taborok/:id/szerkesztes',
    title: 'Tábor szerkesztése',
    loadComponent: () => import('./pages/tour-edit/tour-edit').then((m) => m.TourEdit),
  },
  {
    path: 'taborok/:id/befizetes',
    title: 'Előleg befizetés',
    loadComponent: () => import('./pages/payment/payment').then((m) => m.Payment),
  },
  {
    path: 'taborok/:id',
    title: 'Tábor részletei',
    loadComponent: () => import('./pages/tour-details/tour-details').then((m) => m.TourDetails),
  },
  // Chat/Szavazások/Versenyek are routed but still in early development
  {
    path: 'chat',
    title: 'Bódorgó chat',
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
    path: 'profil',
    title: 'Profil',
    loadComponent: () => import('./pages/profile/profile').then((m) => m.Profile),
  },
  {
    path: 'klub',
    canActivate: [memberGuard],
    loadComponent: () => import('./pages/klub/klub').then((m) => m.Klub),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'attekintes' },
      {
        path: 'attekintes',
        title: 'Klub áttekintés',
        loadComponent: () => import('./pages/klub/overview/overview').then((m) => m.Overview),
      },
      {
        path: 'penzugyek',
        title: 'Klubpénzügyek',
        loadComponent: () => import('./pages/klub/finance/finance').then((m) => m.Finance),
      },
      {
        path: 'felhasznalok',
        title: 'Klub felhasználók',
        loadComponent: () => import('./pages/klub/members/members').then((m) => m.Members),
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
        loadComponent: () => import('./pages/klub/documents/documents').then((m) => m.Documents),
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
