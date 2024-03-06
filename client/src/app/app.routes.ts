import { Routes } from '@angular/router';
import { ToursComponent } from './tours/tours.component';
import { AboutComponent } from './about/about.component';
import { HomeComponent } from './home/home.component';
import { NotFoundComponent } from './not-found/not-found.component';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, data: { animation: 'HomePage' } },
  { path: 'taborok', title: 'Bódorgó táborok', component: ToursComponent },
  {
    path: 'rolunk',
    title: 'Bódorgók akik vagyunk',
    component: AboutComponent,
    data: { animation: 'AboutPage' },
  },
  { path: 'login', title: 'Bódorgó, gyere bé', component: LoginComponent },
  { path: 'signup', title: 'Bódorgó avatás', component: SignupComponent },
  { path: '**', component: NotFoundComponent },
];
