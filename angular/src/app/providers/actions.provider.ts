import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CONFIG } from '../config';

@Injectable({
  providedIn: 'root'
})
export class ActionsProvider {

  constructor(private http:HttpClient) { }

    public hangUp(uuid):Observable<any>{
      const token = localStorage.getItem('_token');
      const domain = localStorage.getItem('_domain') || CONFIG.API_ENDPOINT;
      return this.http.delete<any>(
        `${domain}/v1/calls/${uuid}`,
        { headers: new HttpHeaders({ Authorization: token }) }
      );
    }
}
