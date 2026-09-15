import { Routes } from '@angular/router';
import { Tours } from './pages/tours/tours';
import { TourDetails } from './pages/tour-details/tour-details';
import { Chat } from './pages/chat/chat';
import { Szavazasok } from './pages/szavazasok/szavazasok';
import { Versenyek } from './pages/versenyek/versenyek';
import { Home } from './pages/home/home';
import { NotFoundComponent } from './not-found/not-found.component';
import { LoginComponent } from './auth/login/login.component';
import { Profile } from './pages/profile/profile';
import { TourEdit } from './pages/tour-edit/tour-edit';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'taborok', title: 'Bódorgó táborok', component: Tours },
  // Both declared before the generic taborok/:id below, so "uj" and
  // ":id/szerkesztes" match here first rather than being swallowed as a
  // tour id/slug.
  { path: 'taborok/uj', title: 'Új tábor', component: TourEdit },
  { path: 'taborok/:id/szerkesztes', title: 'Tábor szerkesztése', component: TourEdit },
  { path: 'taborok/:id', title: 'Tábor részletei', component: TourDetails },
  // Chat/Szavazások/Versenyek are routed but still in early development
  { path: 'chat', title: 'Bódorgó chat', component: Chat },
  { path: 'szavazasok', title: 'Bódorgó szavazások', component: Szavazasok },
  { path: 'versenyek', title: 'Bódorgó versenyek', component: Versenyek },
  { path: 'login', title: 'Bódorgó, gyere bé', component: LoginComponent },
  { path: 'profil', title: 'Profil', component: Profile },
  { path: '**', component: NotFoundComponent },
];
