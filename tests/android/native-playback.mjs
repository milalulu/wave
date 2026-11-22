import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE)('playwright');
const adb='C:/Users/vobzo/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8'});
run('shell','am','start','-n','com.wave.desktop/.MainActivity');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224',{noDefaults:true});
const page=browser.contexts()[0].pages()[0];const checks=[];let failure=null;
const media=()=>{const s=run('shell','dumpsys','media_session');const wave=s.slice(s.indexOf('package=com.wave.desktop'));const m=wave.match(/state=PlaybackState \{state=(\w+)\(\d+\), position=(\d+)/);return m?{state:m[1],position:Number(m[2])}:null;};
try{
 await page.waitForTimeout(500);
 const main=page.locator('#wave-main');
 if(!/wave-audit/.test(await main.innerText())){
  await page.locator('.np-collapse button').click();
  await page.locator('.bottom-nav').getByRole('button',{name:'Library',exact:true}).click();
  await main.getByRole('button',{name:'Local Files',exact:true}).click();
  await main.locator('.track-row').filter({hasText:'wave-audit'}).click();
  await page.locator('.mini-player-main').click();
 }
 assert.match(await main.innerText(),/wave-audit/,'Import wave-audit.wav with the Android picker before this test');
 const play=main.getByRole('button',{name:'Play',exact:true}).first();
 if(await play.count())await play.click();
 await page.waitForTimeout(2000);
 let s=media();assert.equal(s?.state,'PLAYING');
 assert.ok(await main.getByRole('button',{name:'Pause',exact:true}).count());checks.push({check:'Play: UI and Android MediaSession agree',...s});
 await main.getByRole('button',{name:'Pause',exact:true}).first().click();await page.waitForTimeout(500);s=media();assert.equal(s?.state,'PAUSED');const pos=s.position;
 await page.waitForTimeout(1000);assert.equal(media()?.position,pos);checks.push({check:'Pause stops native position',...s});
 await main.getByRole('button',{name:'Play',exact:true}).first().click();await page.waitForTimeout(1500);s=media();assert.equal(s?.state,'PLAYING');assert.ok(s.position>pos);checks.push({check:'Resume advances native position',...s});
 run('shell','input','keyevent','3');await page.waitForTimeout(2000);s=media();assert.equal(s?.state,'PLAYING');checks.push({check:'Playback continues in background',...s});
 run('shell','input','keyevent','127');await page.waitForTimeout(800);s=media();assert.equal(s?.state,'PAUSED');checks.push({check:'Android media pause',...s});
 run('shell','am','start','-n','com.wave.desktop/.MainActivity');await page.waitForTimeout(800);
 assert.ok(await main.getByRole('button',{name:'Play',exact:true}).count());checks.push({check:'UI reflects external pause'});
 await page.screenshot({path:'docs/design/android-native/playback-paused.png'});
}catch(error){
 failure=String(error);process.exitCode=1;
}finally{
 try{run('shell','input','keyevent','127');run('shell','am','start','-n','com.wave.desktop/.MainActivity');}catch(error){failure??=String(error);process.exitCode=1;}
 await fs.writeFile('docs/design/android-native/playback.json',JSON.stringify({checks,failure},null,2));console.log({checks,failure});await browser.close();
}
