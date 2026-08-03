import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login.component';
import { MainComponent } from './pages/main/main.component';
import { PopupComponent } from './pages/popup/popup.component';
import { AuthGuardService } from '../../auth/auth.guard';
const routes: Routes = [
  {
    path: '',
    component: MainComponent,
    canActivate: [AuthGuardService]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PopupRoutingModule {}
