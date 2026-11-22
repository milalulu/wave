import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = process.env.WAVE_LAYOUT_OUTPUT || fileURLToPath(new URL('../../docs/design/layout-recovery/', import.meta.url));
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
const reports=[];
for (const [w,h] of [[1366,768],[1440,900],[1920,1080]]) {
 await page.setViewportSize({width:w,height:h-24});
 for(const scenario of ['normal','long','empty','library','missing']) {
  await page.goto('http://localhost:1420/tests/layout/index.html?scenario='+scenario);
  await page.locator('.pulse-shell').waitFor();
  if(scenario==='library') await page.locator('#wave-main').getByRole('button',{name:'Local Files',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(500);
  const metrics=await page.evaluate(()=>{
   const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,scrollW:e.scrollWidth,scrollH:e.scrollHeight,clientW:e.clientWidth,clientH:e.clientHeight};};
   return {shell:rect('.pulse-shell'),main:rect('#wave-main'),body:rect('.echoes-body'),cover:rect('.echoes-album'),queue:rect('.echoes-dock'),list:rect('.echoes-dock-scroll'),player:rect('.player-bar'),rows:document.querySelectorAll('.virtual-row').length};
  });
  await page.screenshot({path:`${out}/${w}x${h}-${scenario}.png`});
  assert.ok(metrics.shell.scrollW <= w + 1, 'Shell horizontal overflow');
  assert.ok(metrics.shell.scrollH <= h - 24 + 1, 'Shell vertical overflow');
  assert.ok(metrics.main.scrollW <= metrics.main.clientW + 1, 'Main horizontal overflow');
  assert.ok(metrics.player.y + metrics.player.h <= h - 24 + 1, 'Player outside viewport');
  if (scenario !== 'library') {
   assert.ok(metrics.main.scrollH <= metrics.main.clientH + 1, 'Home vertical overflow');
   const backdrop = await page.locator('.pulse-backdrop').boundingBox();
   assert.ok(backdrop && backdrop.x === 0 && backdrop.y === 0 && Math.abs(backdrop.width-w)<1 && Math.abs(backdrop.height-(h-24))<1, 'Backdrop must cover the full application viewport');
   assert.ok(metrics.queue.y + metrics.queue.h <= metrics.player.y, 'Queue overlaps player');
   assert.ok(Math.abs(metrics.cover.w - metrics.cover.h) < 1, 'Cover must remain square');
  }
  if (scenario === 'library') {
   assert.ok(metrics.rows < 50, 'Library must remain virtualized');
   await page.locator('#wave-main').evaluate(e => e.scrollTop = e.scrollHeight);
   await page.waitForTimeout(100);
   await page.screenshot({path:`${out}/${w}x${h}-library-end.png`});
   assert.ok(await page.locator('#wave-main .track-title').filter({hasText:'Echoes 1000'}).count(), 'Last library track reachable');
  }
  if (scenario === 'normal') {
   await page.locator('.echoes-dock-scroll').evaluate(e => e.scrollTop = e.scrollHeight);
   await page.waitForTimeout(100);
   assert.ok(await page.locator('.echoes-dock').getByText('Echoes 1000', {exact:true}).count(), 'Last queue track reachable');
  }
  reports.push({w,h,scenario,...metrics});
 }
}
await page.goto('http://localhost:1420/tests/layout/index.html?scenario=long');
await page.locator('.echoes-home').waitFor();
for (const [width,height] of [[1920,1056],[1366,744],[1024,744],[1440,876]]) {
 await page.setViewportSize({width,height});
 await page.waitForTimeout(500);
 const overflow = await page.locator('.pulse-shell').evaluate(e=>e.scrollWidth-e.clientWidth);
 assert.ok(overflow <= 1, `Resize overflow at ${width}`);
 await page.screenshot({path:`${out}/resize-${width}.png`});
}
await page.locator('.echoes-header-actions button[aria-expanded]').click();
assert.equal(await page.locator('.echoes-dock').count(), 0);
assert.ok(await page.locator('#wave-main').evaluate(e=>e.scrollWidth <= e.clientWidth+1 && e.scrollHeight <= e.clientHeight+1), 'Closed queue layout overflow');
await page.screenshot({path:`${out}/queue-closed.png`});
await page.locator('.echoes-header-actions button[aria-expanded]').click();
assert.equal(await page.locator('.echoes-dock').count(), 1);
await page.emulateMedia({reducedMotion:'reduce'});
assert.equal(await page.locator('.echoes-art-waves').evaluate(e => getComputedStyle(e).animationName), 'none');
assert.equal(await page.locator('.echoes-home-art').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
const buttonsUncovered = await page.locator('.echoes-home').evaluate(e => [...e.querySelectorAll('.echoes-header button, .echoes-main-play, .echoes-cover-play, .echoes-dock-tabs button')].every(b => {
 const r=b.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit && b.contains(hit);
}));
assert.ok(buttonsUncovered, 'Decorative layers must not intercept controls');
await fs.writeFile(`${out}/metrics.json`,JSON.stringify(reports,null,2));
console.log(`PASS: ${reports.length} layout scenarios; overflow, player clearance, square covers, virtualized scrolling.`);
await browser.close();
