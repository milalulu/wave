import {createRequire} from 'node:module';import fs from 'node:fs/promises';
const require=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE);const {chromium}=require('playwright');
const browser=await chromium.launch();const page=await browser.newPage({isMobile:true,hasTouch:true,deviceScaleFactor:1});const out='docs/design/android-ui';await fs.mkdir(out,{recursive:true});let errors=[];page.on('pageerror',e=>errors.push(e.message));const reports=[];
for(const [w,h] of [[360,800],[412,915],[800,360]]){
 await page.setViewportSize({width:w,height:h});
 for(const view of ['home','search','library','queue','playlist','album','artist','downloads','wave','wrapped','nowPlaying','settings']){
 errors=[];await page.goto(`http://localhost:1420/tests/layout/index.html?view=${view}&scenario=long`);await page.locator('.pulse-shell').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
 if(view==='library')await page.locator('#wave-main').getByRole('button',{name:'Local Files',exact:true}).click();
 const r=await page.evaluate(()=>{const m=document.querySelector('#wave-main'),s=document.querySelector('.pulse-shell'),nav=document.querySelector('.bottom-nav'),mini=document.querySelector('.mini-player');return {overflow:m.scrollWidth-m.clientWidth,shellOverflow:s.scrollWidth-s.clientWidth,vertical:s.scrollHeight-s.clientHeight,navVisible:getComputedStyle(nav).display!=='none',miniWidth:mini.getBoundingClientRect().width,viewport:innerWidth};});
 await page.screenshot({path:`${out}/${w}-${view}.png`});reports.push({w,h,view,...r,errors:[...errors]});
 }
}
await page.setViewportSize({width:360,height:800});
await page.goto('http://localhost:1420/tests/layout/index.html?scenario=long');
await page.locator('.mini-player-main').click();
await page.locator('.np-collapse button').click();
if(await page.locator('.pulse-shell').getAttribute('data-view')!=='home')throw new Error('Cannot close mobile player');
await page.locator('.bottom-nav').getByRole('button',{name:'Search',exact:true}).click();
await page.locator('.search-box input').fill('Long mobile query');
await page.setViewportSize({width:360,height:460});
const searchButton=page.locator('.search-box > .btn');await searchButton.scrollIntoViewIfNeeded();
const hit=await searchButton.evaluate(e=>{const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===top||e.contains(top);});
if(!hit)throw new Error('Search covered with keyboard-sized viewport');
console.log('PASS: mobile navigation, player close, keyboard-sized search viewport');
await fs.writeFile(`${out}/metrics.json`,JSON.stringify(reports,null,2));const failures=reports.filter(r=>r.overflow>1||r.shellOverflow>1||r.vertical>1||!r.navVisible||r.errors.length);console.log(JSON.stringify(failures,null,2));if(failures.length)process.exitCode=1;await browser.close();
