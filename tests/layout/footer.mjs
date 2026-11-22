import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(process.env.WAVE_PLAYWRIGHT_PACKAGE)('playwright');
const b=await chromium.launch();const p=await b.newPage();
for(const width of [1366,1440,1920]){
 await p.setViewportSize({width,height:744});
 await p.goto('http://localhost:1420/tests/layout/index.html?view=home&scenario=long');
 const controls=p.locator('.player-bar .player-buttons');await controls.waitFor({state:'visible'});
 for(const button of await controls.locator('button').all())assert.ok(await button.isVisible());
 await p.locator('.echoes-footer-compact button[aria-expanded]').click();
 const panel=p.locator('.echoes-tools-open');await panel.waitFor({state:'visible'});
 const bounds=await panel.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0);
 assert.ok(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await p.screenshot({path:`docs/design/footer-menu-${width}.png`});
}
await b.close();console.log('PASS footer playback controls and overflow menu at 3 widths');
