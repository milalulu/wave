import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const require=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE);
const {chromium}=require('playwright');
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
try {
 await page.goto('http://localhost:1420/tests/playback/index.html');await page.waitForFunction(()=>window.audioTest);
 const run=fn=>page.evaluate(fn);
 await run(async()=>{const t=window.audioTest;await t.engine.playTracks(t.tracks);});
 await page.waitForFunction(()=>window.audioTest.engine.snapshot.state==='playing'&&window.audioTest.engine.snapshot.position>.15);
 checks.push('Real WAV decoding and playback clock');
 const peak = () => run(async () => {
   const data = new Uint8Array(128);
   for (let frame = 0; frame < 18; frame++) {
     await new Promise((resolve) => window.requestAnimationFrame(resolve));
     window.audioTest.engine.getSpectrum(data);
   }
   return Math.max(...data);
 });
 const flat = await peak();
 await run(() => window.audioTest.engine.setEqualizer(Array(10).fill(-12)));
 const cut = await peak();
 assert.ok(flat > 30 && cut < flat - 15, `Equalizer attenuation: ${flat} → ${cut}`);
 await run(() => window.audioTest.engine.setEqualizer([]));
 checks.push('Equalizer attenuates the real audio signal');
 await run(()=>window.audioTest.engine.pause());
 const paused=await run(()=>window.audioTest.engine.snapshot.position);await page.waitForTimeout(350);
 assert.ok(Math.abs((await run(()=>window.audioTest.engine.snapshot.position))-paused)<.08);checks.push('Pause stops clock');
 await run(()=>window.audioTest.engine.seek(2));await page.waitForFunction(()=>Math.abs(window.audioTest.engine.snapshot.position-2)<.1);
 await run(()=>window.audioTest.engine.play());await page.waitForFunction(()=>window.audioTest.engine.snapshot.position>2.15);checks.push('Seek and resume');
 await run(()=>window.audioTest.engine.setPlaybackRate(2));const before=await run(()=>window.audioTest.engine.snapshot.position);await page.waitForTimeout(400);
 const after=await run(()=>window.audioTest.engine.snapshot.position);assert.ok(after-before>.5&&after-before<1.3);checks.push('2x rate advances at expected pace');
 await run(()=>window.audioTest.engine.next());await page.waitForFunction(()=>window.audioTest.engine.snapshot.current?.id==='1'&&window.audioTest.engine.snapshot.state==='playing');checks.push('Next selects and plays next source');
 await run(()=>window.audioTest.engine.removeFromQueue(1));await page.waitForFunction(()=>window.audioTest.engine.snapshot.current?.id==='2'&&window.audioTest.engine.snapshot.state==='playing'&&window.audioTest.engine.snapshot.position<1);checks.push('Remove current switches actual source');
 const plays=await run(()=>window.audioTest.played);
 await run(()=>{const e=window.audioTest.engine;e.setRepeat('one');e.seek(5.7);});
 await page.waitForFunction(p=>window.audioTest.played>p&&window.audioTest.engine.snapshot.current?.id==='2'&&window.audioTest.engine.snapshot.position<2,plays);checks.push('Repeat one restarts');
 await run(()=>{const e=window.audioTest.engine;e.setRepeat('all');e.seek(5.7);});
 await page.waitForFunction(()=>window.audioTest.engine.snapshot.current?.id==='0'&&window.audioTest.engine.snapshot.state==='playing');checks.push('Repeat all wraps queue');
 await run(()=>window.audioTest.engine.clearQueue());await page.waitForFunction(()=>window.audioTest.engine.snapshot.state==='idle');checks.push('Clear stops playback');
 assert.deepEqual(await run(()=>window.audioTest.errors),[]);
 await run(async()=>{const {engine,tracks}=window.audioTest;engine.setPlaybackRate(1);engine.setRepeat('off');await engine.playTracks(tracks);engine.seek(2);});
 await page.waitForFunction(()=>window.audioTest.engine.snapshot.state==='playing'&&window.audioTest.engine.snapshot.position>=2);
 await page.context().setOffline(true);
 await page.waitForFunction(()=>!window.navigator.onLine);
 await run(()=>window.audioTest.interruptStream());
 await page.waitForFunction(()=>window.audioTest.engine.snapshot.state==='paused');
 const interrupted=await run(()=>window.audioTest.engine.snapshot);
 assert.equal(interrupted.current.id,'0');
 assert.ok(interrupted.position>=2);
 await page.context().setOffline(false);
 await page.waitForFunction(pos=>window.audioTest.engine.snapshot.state==='playing'&&window.audioTest.engine.snapshot.position>pos+.1,interrupted.position);
 assert.equal(await run(()=>window.audioTest.engine.snapshot.current.id),'0');
 checks.push('Browser reconnect resumes the interrupted track at its saved position');
 assert.deepEqual(errors,[]);
 await fs.mkdir('docs/audits',{recursive:true});await fs.writeFile('docs/audits/playback-browser.json',JSON.stringify({checks,errors},null,2));console.log('PASS',checks);
} finally {await page.evaluate(()=>window.audioTest?.dispose()).catch(()=>{});await browser.close();}
