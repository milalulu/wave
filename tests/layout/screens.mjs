import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE);
const {chromium}=require('playwright');
const out='docs/design/secondary-screens'; await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch(); const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>(errors.push(e.message),console.log('ERROR',e.message)));const reports=[];
for(const [w,h] of [[1366,768],[1440,900],[1920,1080]]) {
 await page.setViewportSize({width:w,height:h-24});
 for(const view of ['search','library','queue','playlist','album','artist','artistRadio','downloads','wave','wrapped','nowPlaying','settings','diagnostics','agent']) {
 errors.length=0;
 await page.goto(`http://localhost:1420/tests/layout/index.html?view=${view}&scenario=long`);
 await page.locator('.pulse-shell').waitFor();
 if(view==='library') await page.locator('#wave-main').getByRole('button',{name:'Local Files',exact:true}).click();
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
 const result=await page.evaluate(()=>{
 const main=document.querySelector('#wave-main'),shell=document.querySelector('.pulse-shell'),p=document.querySelector('.player-bar').getBoundingClientRect();
 return {mainOverflow:main.scrollWidth-main.clientWidth,shellOverflow:shell.scrollWidth-shell.clientWidth,vertical:shell.scrollHeight-shell.clientHeight,footerBottom:p.bottom,content:main.innerText.length};});
 await page.screenshot({path:`${out}/${w}-${view}.png`});
 reports.push({w,h,view,...result,errors:[...errors]});
 }
}
await page.setViewportSize({width:1366,height:744});
await page.goto('http://localhost:1420/tests/layout/index.html?view=playlist&scenario=long');
for (const name of ['New','Import link']) {
 await page.locator('#wave-main').getByRole('button',{name,exact:true}).click();
 const modal=page.locator('.modal');await modal.waitFor();
 const box=await modal.boundingBox();
 if(!box || box.x<0 || box.y<0 || box.x+box.width>1366 || box.y+box.height>744) throw new Error('Dialog outside viewport');
 await page.screenshot({path:`${out}/dialog-${name.replace(' ','-')}.png`});
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
}
console.log('2 playlist dialogs open, fit and dismiss with Escape');
await fs.writeFile(`${out}/metrics.json`,JSON.stringify(reports,null,2));
const failures=reports.filter(r=>r.mainOverflow>1||r.shellOverflow>1||r.vertical>1||r.footerBottom>r.h-23||r.errors.length||!r.content);
console.log(JSON.stringify(failures,null,2));
if(failures.length) process.exitCode=1;
console.log(`${reports.length} screen checks`);await browser.close();
