import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CONFIG } from '../config';

@Injectable({
  providedIn: 'root'
})
export class HandleRequestService {

  constructor(private http:HttpClient) { }

    public get(url,urlParams:any=""):Observable<any>{
      console.log("handlerequest - get", url, urlParams)
      const token = localStorage.getItem('_token') 
      let dataUrl:any = { headers: { Authorization:token} ,observe: 'response' };
      if (urlParams != "") {
        dataUrl = { ...dataUrl, ...{params: new HttpParams({ fromString:HandleRequestService.serialize(urlParams)})}};
      }
      
      const apiEndpoint = localStorage.getItem('_domain') || CONFIG.API_ENDPOINT;
      return this.http.get<any>(apiEndpoint + url, dataUrl)
    }
    


    /*********************
  *
  *     HELPERS
  *
  *********************/
  private static serialize(obj, prefix?) {
    var str = [],
      p;
    for (p in obj) {
        if (obj.hasOwnProperty(p)) {
          var k = prefix ?
                    Array.isArray(obj) ?
                      (typeof obj[p]=='string'? prefix + "[]" : prefix + "[" +p+"]") :
                      prefix + "[" + encodeURIComponent(p) + "]"
                    : encodeURIComponent(p),
            v = obj[p];
          str.push((v !== null && typeof v === "object") ?
            HandleRequestService.serialize(v, k) :
            k + "=" + v);
            //console.log(obj[p]);

        }
    }
    return str.join("&");
  }
  public static parseIfValidJson(str: string): Object | boolean {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return JSON.parse(str);
  }
}
