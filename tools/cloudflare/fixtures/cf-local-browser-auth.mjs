import { isolatedStack } from './assert-local-stack.mjs';
import { chromium, webkit, devices } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
const browserName=process.env.CARELINK_LOCAL_BROWSER||'chromium';if(!['chromium','webkit'].includes(browserName))throw Error('unsupported local browser');
const e=isolatedStack();const api=new URL(e.API_URL);if(!['127.0.0.1','localhost'].includes(api.hostname))throw Error('nonlocal API refused');
const app='http://127.0.0.1:18744';const admin=createClient(api.href,e.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const email=`synthetic-${randomUUID()}@example.invalid`;const password=randomBytes(24).toString('hex');
const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw Error('synthetic identity setup failed');
const browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true});const context=await browser.newContext({...browserName==='webkit'?devices['iPhone 13']:{},serviceWorkers:'block'});const allowed=new Set([app,api.origin]);let blocked=0;
await context.route('**/*',route=>{let x;try{x=new URL(route.request().url())}catch{return route.abort()};if(allowed.has(x.origin))return route.continue();blocked++;return route.abort();});
const page=await context.newPage();
try {await page.goto(app+'/auth/login?redirect=/mypage',{waitUntil:'domcontentloaded'});await page.locator('#login-email').waitFor({state:'visible',timeout:15000});await page.locator('#login-email').fill(email);await page.locator('#login-password').fill(password);await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(url=>url.origin===app&&url.pathname==='/mypage',{timeout:15000});console.log(`synthetic ${browserName} login and navigation: success`); console.log('external requests blocked:',blocked);}catch(e){console.log('browser login test failed:',e.name);console.log('local page path:',new URL(page.url()).pathname);process.exitCode=1;}finally{await browser.close()}
