import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { interval } from 'rxjs';
import { takeWhile } from 'rxjs/operators';
import { AuthService } from 'src/app/auth/auth.service';
import { CONFIG } from 'src/app/config';
import { ActionsProvider } from 'src/app/providers/actions.provider';
import { HandleRequestService } from 'src/app/providers/handleRequest.service';
import { ShareUserDataService } from 'src/app/providers/user-data.service';

@Component({
    selector: 'app-main',
    templateUrl: './main.component.html',
    styleUrls: ['./main.component.scss']
})
export class MainComponent implements OnInit {
    callStatus;
    callId;
    page_title=CONFIG.PAGE_TITLE;
    statuses:any=[];
    user:any={};
    constructor(
        public actions:ActionsProvider,
        private auth: AuthService,
        private handleRequest:HandleRequestService,
        public router: Router,
        private userData:ShareUserDataService
    ) { }
    ngOnDestroy(){
        if(this.timer.timerVar)this.timer.timerVar.unsubscribe()
    }
    ngOnInit(): void {
        this.page_title=CONFIG.PAGE_TITLE
        const port = chrome.runtime.connect({name:"main"});
        let user_uuid = localStorage.getItem('_id');
        if (user_uuid) {
            port.postMessage({
                event: "login",
                user_uuid
            });
        }
        this.userData.getUserData().then(res=>{
            this.user = res; 
            if(!this.user.status) {
                this.user.available_flag='available'
                this.startTimer()
            }
        })
        console.log("oninit")
        
        this.updateCallStatus();
        setInterval(()=>{
            this.updateCallStatus(); 
           
        },2000);
        // port.onMessage.addListener(function (msg) {
        //     console.log("message recieved", msg);
        //     this.callStatus = "message rec"
        // });
        this.handleRequest.get("/api/statuses",{search:{type:'on_break'}}).subscribe(res=>{
            console.log("statuses", res)
            this.statuses=res.body
        })
    }
    statusChanged(event){
        console.log("status changed", event)
        this.user.status = event.value;
        if(this.user.status!=''){
            this.user.available_flag='logged_out'
            if(this.timer.timerVar)this.timer.timerVar.unsubscribe()
            this.startTimer();
        }
    }
    userAvailableChanged(event){
        this.user.available_flag=event.value
        this.user.status=null;
        if(this.user.available_flag=='available'){
            if(this.timer.timerVar)this.timer.timerVar.unsubscribe()
            this.startTimer();
        }
        
    }

    timer:any={seconds:0, string:'', timerVar:null};
    startTimer(){
        console.log("startTimer")
        this.timer = {seconds:0, string:'', timerVar:null}
        // console.log("startTimer", obj, start_time, prop_name)
        let hours = 0;
        let seconds = 0;
        let minutes = 0;
        this.timer[seconds] = 0;//Math.floor(new Date().getTime()/1000) -(+start_time)//0 ; //TODO call_start_at timestamp from server
        this.timer.string = this.secondsToString(this.timer.seconds)//'';
        this.timer.timerVar = interval(1000)/*.pipe(takeWhile(val=>this.dataAvailable))*/.subscribe(x => {
          this.timer.seconds++;
          this.timer.string = this.secondsToString(this.timer.seconds)
          
        //   this.ref.markForCheck();
        })
        
    
      }
      
      private secondsToString(sec){
        // console.log("secondsToStringdd",sec)
        let time_string = "";
        var hours   = Math.floor(sec / 3600);
        var minutes = Math.floor((sec - (hours * 3600)) / 60);
        var seconds = sec - (hours * 3600) - (minutes * 60);
        // if(hours>0){
          time_string += (hours>0)? hours.toString()+":" : '00:'
        // }
        time_string += (minutes<10)? "0"+minutes.toString()+":" : minutes.toString()+":";
        time_string += (seconds<10)? "0"+seconds.toString() : seconds.toString();
        return time_string;
      }
    private updateCallStatus() {
        // chrome.browserAction.setBadgeText({text:CONFIG.PAGE_TITLE})//.setTitle({title:CONFIG.PAGE_TITLE})
        // chrome.browserAction.setBadgeBackgroundColor({color:"green"})//.setBadgeText({text:CONFIG.PAGE_TITLE})

        let call_status = JSON.parse(localStorage.getItem('call'));
            console.log(call_status);
            
        if(call_status && call_status.call && call_status.call.uuid){
            this.callId = call_status.call.uuid;
            if(call_status.event == "call:ringing") {
                this.callStatus = "ringing";
                
            } else if(call_status.event == "call:hangup") {
                this.callStatus = "hangup";
            } else if(call_status.event == "call:answer") {
                this.callStatus = "answer";
            }
        }
    }

    hangUp(){
        this.actions.hangUp(this.callId).subscribe({
            next:()=>{
                this.destroyCall();
            },
            error:(error)=>{
                this.destroyCall();
                console.error(error);
            }
        })
    }

    logout() {
        var port = chrome.runtime.connect();
        port.postMessage({ event: "logout" });
        this.auth.logout();
        this.router.navigate(['login']);
    }

    private destroyCall() {
        localStorage.removeItem('call');
        this.callId = "";
    }

}
