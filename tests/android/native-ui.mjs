import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE);const {chromium}=require('playwright');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224',{noDefaults:true});const page=browser.contexts()[0].pages()[0];
const out='docs/design/android-native';await fs.mkdir(out,{recursive:true});const reports=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.locator('.pulse-shell').waitFor({timeout:30000});
 for(const name of ['Home','Search','Wave','Library','Settings']){
  await page.locator('.bottom-nav').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(400);
  await page.screenshot({path:`${out}/${name.toLowerCase()}.png`});
  const r=await page.evaluate(()=>{const m=document.querySelector('#wave-main'),s=document.querySelector('.pulse-shell');return {width:innerWidth,height:innerHeight,overflow:m.scrollWidth-m.clientWidth,shellOverflow:s.scrollWidth-s.clientWidth,view:s.getAttribute('data-view'),pulse:!!document.querySelector('.pulse-backdrop')};});
  reports.push({name,...r});
 }
 await page.locator('.bottom-nav').getByRole('button',{name:'Home',exact:true}).click();
 await fs.writeFile(`${out}/metrics.json`,JSON.stringify({reports,errors},null,2));console.log(JSON.stringify({reports,errors},null,2));
 if(reports.some(r=>r.overflow>1||r.shellOverflow>1)||errors.length)process.exitCode=1;
}finally{await browser.close();}
