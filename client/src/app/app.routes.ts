import { Routes } from '@angular/router';
import { ToursComponent } from './tours/tours.component';
import { AboutComponent } from './about/about.component';
import { HomeComponent } from './home/home.component';
import { NotFoundComponent } from './not-found/not-found.component';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { LogoutComponent } from './auth/logout/logout.component';
import { ShopComponent } from './shop/shop.component';
import { VerifyEmailComponent } from './auth/verify-email/verify-email.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, data: { animation: '0' } },
  {
    path: 'taborok',
    title: 'Bódorgó táborok',
    component: ToursComponent,
    data: { animation: '1' },
  },
  {
    path: 'shop',
    title: 'Bódorgó piac',
    component: ShopComponent,
    data: { animation: '2' },
  },
  {
    path: 'rolunk',
    title: 'Bódorgók akik vagyunk',
    component: AboutComponent,
    data: { animation: '3' },
  },
  { path: 'login', title: 'Bódorgó, gyere bé', component: LoginComponent },
  { path: 'signup', title: 'Bódorgó avatás', component: SignupComponent },
  {
    path: 'email-confirmed',
    title: 'Bódorgó email ellenőrizve',
    component: VerifyEmailComponent,
  },
  { path: 'logout', title: 'Viszlát', component: LogoutComponent },
  { path: '**', component: NotFoundComponent },
];
