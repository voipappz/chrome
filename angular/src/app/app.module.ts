import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from './auth/auth.service';
import { AuthGuardService } from './auth/auth.guard';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PopupModule } from './modules/popup/popup.module';
import { HandleRequestService } from './providers/handleRequest.service';
import { ShareUserDataService } from './providers/user-data.service';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule, 
    ReactiveFormsModule, 
    AppRoutingModule, 
    HttpClientModule, 
    BrowserAnimationsModule,
    PopupModule
  ],
  providers: [AuthService, AuthGuardService, HandleRequestService, ShareUserDataService],
  bootstrap: [AppComponent]
})
export class AppModule { }
