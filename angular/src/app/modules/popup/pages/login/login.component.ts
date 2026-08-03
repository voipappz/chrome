import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { AuthService } from 'src/app/auth/auth.service';
import { TAB_ID } from 'src/app/providers/tab-id.provider';
import { Router } from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import { ShareUserDataService } from 'src/app/providers/user-data.service';

@Component({
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {

    isLoading: boolean = false;
    message: string;

    loginForm: FormGroup = this.fb.group({
        domain: [null],
        username: [null],
        password: [null]
    });

    constructor(
        @Inject(TAB_ID) readonly tabId: number,
        private auth: AuthService,
        private fb: FormBuilder,
        public router: Router,
        private _snackBar: MatSnackBar,
        private userData:ShareUserDataService
    ) { }

    changeUrl() {
        var newURL = "http://stackoverflow.com/";
        chrome.tabs.update(this.tabId, { url: newURL });
    }

    openTab(url) {
        chrome.tabs.create({ url });
    }

    ngOnInit() {

    }

    private normalizeDomain(raw: string): string {
        let d = (raw || '').trim().replace(/\/+$/, '');
        if (!d.startsWith('http://') && !d.startsWith('https://')) {
            d = 'https://' + d;
        }
        return d;
    }

    onSubmit() {
        this.isLoading = true;
        const domain = this.normalizeDomain(this.loginForm.controls['domain'].value);
        this.auth.login(
            this.loginForm.controls['username'].value,
            this.loginForm.controls['password'].value,
            domain
        ).subscribe({
            next: data => {
                console.log("login success: data:", data )
                var port = chrome.runtime.connect();
                localStorage.setItem('_token', data.token);
                localStorage.setItem('_id', data.user.uuid);
                localStorage.setItem('_domain', domain);
                data.user_uuid=data.user.uuid;
                port.postMessage({ event: "login", data, domain });
                this.userData.setUserData(data.user);
                this.router.navigate(['main']);
                this.isLoading = false;
            },
            error: error => {
                this.isLoading = false;
                this._snackBar.open(error.error.message,'close',{
                    duration: 2000,
                    verticalPosition:'top',
                    panelClass: ['error-snackbar']
                });
                console.error('There was an error!', error);
            }
        })
    }
}
