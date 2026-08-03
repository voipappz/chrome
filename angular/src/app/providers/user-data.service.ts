import { forwardRef, Injectable } from '@angular/core';
import { Inject } from '@angular/core';
import { HandleRequestService } from './handleRequest.service';
@Injectable({
  providedIn: 'root'
})
export class ShareUserDataService {

    user:any;
    dir:string='ltr';
    language:any;
    customer_data:any = {
      url:  "https://admin-staging.voipappz.io/assets/admin/layout4/img/VA_logo_white.png",
      url_login: "assets/img/VA_logo_white.png"
    }
    constructor(private handleRequest:HandleRequestService){
      console.warn("ShareUserDataService")
        this.user = {};
        this.language = "en";
    }
    setUserData(_user, _field=""){
      if(_field != "" && _field != "language"){
        this.user[_field] = _user[_field];
      }else if (_field == "language"){
        this.user.profile.language = _user.profile.language;
        this.language = this.user.profile.language;
        //this.events.publish('reloadLanguage',this.language);
      }else{
        this.user = _user;
        if(this.user.extension){
          this.user.extension.environment = this.user.environment
        }
        this.language = (this.user.profile && this.user.profile.language)? this.user.profile.language : 'he';
        //this.events.publish('reloadLanguage',this.language);
        // console.warn("ShareUserDataService setAcl:true",this.user.acl)
        // this.aclSvc.setAbilities(this.user.acl.data)

      }

      //console.log("setUserData", this.user, this.language )
    }
    getUserData(field=""):Promise<any>{
      console.log("getUserData", this.user, this.language )
      if( ShareUserDataService.equals(this.user, {})) {
        console.log("getUserData - no user data", this.user, this.language )
        //this.authStatus.tokenStatus();
        return new Promise(resolve=>{
          this.handleRequest.get("/api/users/"+localStorage.getItem('_id'))
          .subscribe(res=>{
            console.log("getUserData load from server ",res,  this.user, this.language )
              this.setUserData(res.body)
              // return res.body
              resolve(res.body)
            },err=>{
              console.error("loading user - error ", err)
              resolve({})
            }
          )
        })
      }else{  
        if(field!=""){
          // return this.user[field]
          return new Promise(resolve=>{
            resolve(this.user[field])
          })
        }else{
          // return this.user;
          return new Promise(resolve=>{
            resolve(this.user)
          })
        }
      }
    }
    getUserLang(){
      //console.log("getUserLang", this.user , this.language)
      return this.language;
    }

    
    setCustomerData(data){
      console.log("setCustomerData",data, this.customer_data )
      this.customer_data = data;
      console.log("setCustomerData",data, this.customer_data )
    }
    getCustomerData(){
      console.log("getCustomerData", this.customer_data )
      return this.customer_data;


    }
    setAppDir(lang:string){
      this.dir = (lang=="he") ? 'rtl' : 'lrt';
    }
    getAppDir(){
      return this.dir;
    }


    
      /*private _recursiveProperties: string[] = ['RecursiveProperty', ...];
  
      public equals(obj1: any, obj2: any): boolean {*/
      public static equals(obj1: any, obj2: any): boolean {
          if (typeof obj1 !== typeof obj2) {
              return false;
          }
          if ((obj1 === undefined && obj2 !== undefined) ||
              (obj2 === undefined && obj1 !== undefined) ||
              (obj1 === null && obj2 !== null) ||
              (obj2 === null && obj1 !== null)) {
              return false;
          }
          if (typeof obj1 === 'object') {
              if (Array.isArray(obj1)) {
                  if (!Array.isArray(obj2) || obj1.length !== obj2.length) {
                      return false;
                  }
                  for (let i = 0; i < obj1.length; i++) {
                      if (!this.equals(obj1[i], obj2[i])) {
                          return false;
                      }
                  }
              } else {
                  for (let prop in obj1) {
                      if (obj1.hasOwnProperty(prop)) {
                          if (!obj2.hasOwnProperty(prop)) {
                              return false;
                          }
                          //Endless loop fix for recursive properties
                          /*if (this._recursiveProperties.indexOf(prop) >= 0) {
                              if (obj1[prop] !== obj2[prop]) {
                                  return false;
                              }
                          } else */
                          if (!this.equals(obj1[prop], obj2[prop])) {
                              return false;
                          }
                      }
                  }
                  for (let prop in obj2) {
                      if (obj2.hasOwnProperty(prop)) {
                          if (!obj1.hasOwnProperty(prop)) {
                              return false;
                          }
                      }
                  }
              }
              return true;
          }
          return obj1 === obj2;
      }
}
