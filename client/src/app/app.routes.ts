import { Routes } from '@angular/router';
import { ToursComponent } from './tours/tours.component';
import { AboutComponent } from './about/about.component';
import { HomeComponent } from './home/home.component';
import { NotFoundComponent } from './not-found/not-found.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, data: { animation: 'HomePage' } },
  { path: 'taborok', component: ToursComponent },
  {
    path: 'rolunk',
    component: AboutComponent,
    data: { animation: 'AboutPage' },
  },
  { path: '**', component: NotFoundComponent },
];
