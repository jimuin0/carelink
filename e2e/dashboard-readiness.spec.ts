import { test,expect } from '@playwright/test';
import { waitForVisibleDashboard } from './dashboard-readiness';

test('dashboard readiness checks the rendered page without waiting for an unrelated deferred module',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let moduleRequested!:()=>void;
  const started=new Promise<void>(resolve=>{moduleRequested=resolve;});
  let domLoaded=false;
  page.on('domcontentloaded',()=>{domLoaded=true;});
  await page.route('**/synthetic-dashboard-module.js',async route=>{
    moduleRequested();await gate;await route.fulfill({contentType:'application/javascript',body:'export {};'});
  });
  await page.route('**/admin?synthetic_dashboard_readiness=1',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/synthetic-dashboard-module.js"></script></head><body><h1>ダッシュボード</h1></body></html>'}));
  try{
    await page.goto('/admin?synthetic_dashboard_readiness=1',{waitUntil:'commit'});
    await started;
    await waitForVisibleDashboard(page);
    expect(domLoaded).toBe(false);
    release();
    await page.waitForLoadState('domcontentloaded');
    expect(domLoaded).toBe(true);
    await expect(page.getByRole('heading',{name:'ダッシュボード',exact:true})).toBeVisible();
  }finally{release();}
});
