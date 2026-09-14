import { Routes } from '@angular/router';
import { Tours } from './pages/tours/tours';
import { TourDetails } from './pages/tour-details/tour-details';
import { Chat } from './pages/chat/chat';
import { Szavazasok } from './pages/szavazasok/szavazasok';
import { Versenyek } from './pages/versenyek/versenyek';
import { AboutComponent } from './about/about.component';
import { Home } from './pages/home/home';
import { NotFoundComponent } from './not-found/not-found.component';
import { LoginComponent } from './auth/login/login.component';
import { Profile } from './pages/profile/profile';

export const routes: Routes = [
  { path: '', component: Home, data: { animation: 'HomePage' } },
  { path: 'taborok', title: 'Bódorgó táborok', component: Tours },
  { path: 'taborok/:id', title: 'Tábor részletei', component: TourDetails },
  // Chat/Szavazások/Versenyek are routed but still in early development
  { path: 'chat', title: 'Bódorgó chat', component: Chat },
  { path: 'szavazasok', title: 'Bódorgó szavazások', component: Szavazasok },
  { path: 'versenyek', title: 'Bódorgó versenyek', component: Versenyek },
  {
    path: 'rolunk',
    title: 'Bódorgók akik vagyunk',
    component: AboutComponent,
    data: { animation: 'AboutPage' },
  },
  { path: 'login', title: 'Bódorgó, gyere bé', component: LoginComponent },
  { path: 'profil', title: 'Profil', component: Profile },
  { path: '**', component: NotFoundComponent },
];
