const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  
  console.log('Navigating to Skills page...');
  await page.goto('http://localhost:5000/skills', { waitUntil: 'networkidle0', timeout: 30000 });
  
  // Wait for skills to load
  await page.waitForSelector('[style*="gridTemplateColumns"]', { timeout: 10000 });
  
  console.log('Taking screenshot of Skills page...');
  await page.screenshot({ path: 'screenshots/skills-page.png', fullPage: false });
  console.log('✓ Saved: screenshots/skills-page.png');
  
  // Find and click a skill card with metadata (pipeline-hygiene)
  console.log('Looking for Pipeline Hygiene skill...');
  const skillCards = await page.$$('div[style*="background"][style*="surface"]');
  
  let clicked = false;
  for (let i = 0; i < skillCards.length && !clicked; i++) {
    const text = await skillCards[i].evaluate(el => el.textContent);
    if (text.includes('Pipeline Hygiene') && text.includes('Click for details')) {
      console.log('Found Pipeline Hygiene skill, clicking...');
      await skillCards[i].click();
      clicked = true;
    }
  }
  
  if (!clicked) {
    console.log('Could not find Pipeline Hygiene skill with "Click for details" badge');
    await browser.close();
    return;
  }
  
  // Wait for modal to appear
  await page.waitForSelector('div[style*="position: fixed"][style*="rgba(0, 0, 0, 0.7)"]', { timeout: 5000 });
  await page.waitForTimeout(500); // Let modal animate in
  
  console.log('Taking screenshot of modal...');
  await page.screenshot({ path: 'screenshots/skills-modal-open.png', fullPage: false });
  console.log('✓ Saved: screenshots/skills-modal-open.png');
  
  // Scroll modal to see all content
  const modalBody = await page.$('div[style*="maxHeight: 90vh"]');
  if (modalBody) {
    await modalBody.evaluate(el => el.scrollTo(0, 300));
    await page.waitForTimeout(300);
    
    console.log('Taking screenshot of modal scrolled...');
    await page.screenshot({ path: 'screenshots/skills-modal-scrolled.png', fullPage: false });
    console.log('✓ Saved: screenshots/skills-modal-scrolled.png');
  }
  
  await browser.close();
  console.log('\nDone! Screenshots saved to screenshots/');
})();
