const { chromium } = require('C:/Users/Alastar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } });
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  await page.goto('file:///E:/Projects/nodic/prototypes/collaboration/collaboration.html');
  await page.locator('#tabs button').first().waitFor();
  const results = [];
  for (let i = 0; i < 5; i++) {
    await page.locator('#tabs button').nth(i).click();
    const count = await page.locator('#steps button').count();
    const steps = [];
    for (let step = 0; step < count; step++) {
      await page.locator('#steps button').nth(step).click();
      steps.push(await page.evaluate(() => ({
        a: document.querySelector('#text-0').value,
        b: document.querySelector('#text-1').value,
        graph: document.querySelector('#graph-state').textContent,
        server: document.querySelector('#server-text').textContent,
        edges: document.querySelector('#edges').textContent,
        event: document.querySelector('#events li').textContent,
      })));
    }
    results.push({ scenario: await page.locator('#tabs button').nth(i).textContent(), steps });
  }
  fs.writeFileSync('prototypes/collaboration/observations.json', JSON.stringify(results, null, 2));
  await page.locator('#tabs button').first().click();
  await page.screenshot({ path: '.scratch/prototype-desktop.png', fullPage: true });
  console.log(JSON.stringify(results));
  await browser.close();
})();
