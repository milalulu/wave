import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const require=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE);
const {chromium}=require('playwright');
const adb='C:/Users/vobzo/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8'}).trim();
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224',{noDefaults:true});
const page=browser.contexts()[0].pages()[0];
const out='docs/design/android-native';
const reports=[];
const measure=async(name)=>{await page.screenshot({path:`${out}/${name}.png`});reports.push({name,...await page.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,text:document.querySelector('#wave-main')?.innerText.slice(0,500)}))});};
const rotation=run('shell','settings','get','system','user_rotation');
const auto=run('shell','settings','get','system','accelerometer_rotation');
try{
 await page.locator('.bottom-nav').getByRole('button',{name:'Wave',exact:true}).click();
 await page.waitForTimeout(1500);await measure('wave-loaded');
 await page.locator('.bottom-nav').getByRole('button',{name:'Search',exact:true}).click();
 await page.locator('input').first().click();await page.waitForTimeout(1500);
 await page.locator('input').first().fill('Длинное название песни для проверки');await measure('keyboard');
 run('shell','input','keyevent','4');await page.waitForTimeout(500);
 run('shell','settings','put','system','accelerometer_rotation','0');
 run('shell','settings','put','system','user_rotation','1');await page.waitForTimeout(2000);
 await measure('landscape-search');
 await page.locator('.bottom-nav').getByRole('button',{name:'Home',exact:true}).click();await page.waitForTimeout(500);await measure('landscape-home');
}finally{
 run('shell','settings','put','system','user_rotation',rotation);
 run('shell','settings','put','system','accelerometer_rotation',auto);
 await fs.writeFile(`${out}/input-metrics.json`,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));await browser.close();
}
