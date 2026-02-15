#!/usr/bin/env tsx
/**
 * Screenshot Helper for UI Development
 *
 * Usage:
 *   tsx scripts/screenshot-ui.ts <url> <output-filename>
 *
 * Example:
 *   tsx scripts/screenshot-ui.ts http://localhost:5173 homepage.png
 *   tsx scripts/screenshot-ui.ts http://localhost:5173/deals deal-list.png
 */

import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';

async function takeScreenshot(url: string, outputPath: string) {
  console.log(`📸 Taking screenshot of ${url}...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Set viewport to 1440x900 per Phase B spec
    await page.setViewport({ width: 1440, height: 900 });

    // Navigate to URL
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait a bit for any animations
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Take screenshot
    const screenshotDir = path.dirname(outputPath);
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: true });

    console.log(`✅ Screenshot saved to ${outputPath}`);

    // Get page title
    const title = await page.title();
    console.log(`   Page title: ${title}`);

  } catch (error) {
    console.error('❌ Screenshot failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Main execution
const args = process.argv.slice(2);
const url = args[0] || 'http://localhost:5173';
const outputFilename = args[1] || 'screenshot.png';
const outputPath = path.join(process.cwd(), 'screenshots', outputFilename);

takeScreenshot(url, outputPath)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
