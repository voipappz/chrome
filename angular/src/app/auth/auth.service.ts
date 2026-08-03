import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CONFIG } from '../config';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  constructor(private http:HttpClient) { }

    public login(email, password, domain: string): Observable<any> {
      const body = new HttpParams()
        .set('email', email)
        .set('password', password);

      return this.http.post<any>(
        domain + '/auth/user_login?' + body.toString(),
        { email, password }
      );
    }
    public logout(){
      localStorage.removeItem('_token');
      localStorage.removeItem('_id');
    }
    public isAuthenticated(): boolean {
      
      const token = localStorage.getItem('_token') || "";
      // Check whether the token is expired and return
      // true or false
      //return !this.jwtHelper.isTokenExpired(token);
      // const params = new HttpParams().set('token', token);
      // this.http.post<any>(
      //   'https://api.voipappz.io/auth/user_token_status?'+params.toString(), {token}
      // );
      return token != "";
    }
}
