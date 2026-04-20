import { Routes } from '@angular/router';
import { ReviewDashboardComponent } from './features/review-dashboard/review-dashboard.component';

export const routes: Routes = [
  { path: '', component: ReviewDashboardComponent },
  { path: '**', redirectTo: '' }
];