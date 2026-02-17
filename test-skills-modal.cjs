const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  
  console.log('Navigating to Skills page...');
  try {
    await page.goto('http://localhost:5000/skills', { waitUntil: 'networkidle0', timeout: 30000 });
  } catch (e) {
    console.log('Error loading page:', e.message);
    await browser.close();
    return;
  }
  
  // Wait for skills to load
  await page.waitForSelector('div', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  console.log('Taking screenshot of Skills page...');
  await page.screenshot({ path: 'screenshots/skills-page.png', fullPage: true });
  console.log('✓ Saved: screenshots/skills-page.png');
  
  // Look for any skill card with "Click for details" badge
  console.log('Looking for skill with detail modal...');
  
  const clicked = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('span'));
    const badge = elements.find(el => el.textContent.includes('Click for details'));
    if (badge) {
      const card = badge.closest('div[style*="background"]');
      if (card) {
        card.click();
        return true;
      }
    }
    return false;
  });
  
  if (!clicked) {
    console.log('No skill with "Click for details" badge found');
    await browser.close();
    return;
  }
  
  console.log('Clicked skill card, waiting for modal...');
  await page.waitForTimeout(1000);
  
  console.log('Taking screenshot of modal...');
  await page.screenshot({ path: 'screenshots/skills-modal-open.png', fullPage: false });
  console.log('✓ Saved: screenshots/skills-modal-open.png');
  
  // Scroll modal
  await page.evaluate(() => {
    const modal = document.querySelector('div[style*="maxHeight: 90vh"]');
    if (modal) {
      modal.scrollTo(0, 400);
    }
  });
  await page.waitForTimeout(300);
  
  console.log('Taking screenshot of modal scrolled...');
  await page.screenshot({ path: 'screenshots/skills-modal-scrolled.png', fullPage: false });
  console.log('✓ Saved: screenshots/skills-modal-scrolled.png');
  
  await browser.close();
  console.log('\nDone! Screenshots saved.');
})();
