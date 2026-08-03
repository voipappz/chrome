import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuardService } from './auth/auth.guard';
import { LoginComponent } from './modules/popup/pages/login/login.component';
import { MainComponent } from './modules/popup/pages/main/main.component';

const routes: Routes = [
  {
    path: 'main',
    pathMatch: 'full',
    component:MainComponent,
    canActivate: [AuthGuardService]
  },
  {
    path: 'login',
    pathMatch: 'full',
    component:LoginComponent
  }
  // {
  //   path: 'tab',
  //   pathMatch: 'full',
  //   loadChildren: () => import('./modules/tab/tab.module').then(m => m.TabModule)
  // },
  // {
  //   path: 'options',
  //   pathMatch: 'full',
  //   loadChildren: () => import('./modules/options/options.module').then(m => m.OptionsModule)
  // }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true, relativeLinkResolution: 'legacy' })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
