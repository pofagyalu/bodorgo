import { Routes } from '@angular/router';
import { Tours } from './pages/tours/tours';
import { Chat } from './pages/chat/chat';
import { Szavazasok } from './pages/szavazasok/szavazasok';
import { Versenyek } from './pages/versenyek/versenyek';
import { AboutComponent } from './about/about.component';
import { HomeComponent } from './home/home.component';
import { NotFoundComponent } from './not-found/not-found.component';
import { LoginComponent } from './auth/login/login.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, data: { animation: 'HomePage' } },
  { path: 'taborok', title: 'Bódorgó táborok', component: Tours },
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
  { path: '**', component: NotFoundComponent },
];
