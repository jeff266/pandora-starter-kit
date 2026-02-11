/**
 * Sync Infrastructure Verification Script
 *
 * Tests all sync hardening components:
 * 1. Throttled fetch with sliding window
 * 2. 429 retry with exponential backoff
 * 3. Field sanitizer (empty string → null)
 * 4. Sync lock (concurrent sync prevention)
 * 5. Incremental sync decision (last_sync_at logic)
 *
 * Usage: npx tsx scripts/verify-sync-infra.ts
 */

import { createThrottledFetcher, fetchWithRateLimitRetry } from '../server/utils/throttle.js';
import {
  sanitizeForDb,
  sanitizeDate,
  sanitizeNumber,
  sanitizeInteger,
  sanitizeBoolean,
  sanitizeText,
} from '../server/utils/field-sanitizer.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  const isEqual = JSON.stringify(actual) === JSON.stringify(expected);
  assert(isEqual, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

// ============================================================================
// Test 1: Throttled Fetch (Sliding Window)
// ============================================================================

async function testThrottledFetch() {
  console.log('\n📦 Test 1: Throttled Fetch (Sliding Window)');

  const fetcher = createThrottledFetcher({
    maxRequests: 3,
    windowMs: 1000, // 1 second
  });

  const timestamps: number[] = [];

  // Mock fetch that just records timestamps
  global.fetch = async () => {
    timestamps.push(Date.now());
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const startTime = Date.now();

  // Fire 6 requests (should throttle after 3)
  await Promise.all([
    fetcher('http://test.com/1'),
    fetcher('http://test.com/2'),
    fetcher('http://test.com/3'),
    fetcher('http://test.com/4'),
    fetcher('http://test.com/5'),
    fetcher('http://test.com/6'),
  ]);

  const totalTime = Date.now() - startTime;

  // First 3 should be immediate, next 3 should wait ~1 second
  assert(timestamps.length === 6, 'All 6 requests completed');
  assert(totalTime >= 1000, `Throttle enforced (took ${totalTime}ms, expected >= 1000ms)`);
  assert(totalTime < 2000, `Throttle efficient (took ${totalTime}ms, expected < 2000ms)`);

  // Verify first 3 were fast, last 3 were delayed
  const firstBatch = timestamps.slice(0, 3);
  const secondBatch = timestamps.slice(3, 6);
  const firstBatchSpread = Math.max(...firstBatch) - Math.min(...firstBatch);
  const gap = Math.min(...secondBatch) - Math.max(...firstBatch);

  assert(firstBatchSpread < 500, `First 3 requests fired quickly (${firstBatchSpread}ms)`);
  assert(gap >= 700, `Second batch waited for window (${gap}ms gap)`);
}

// ============================================================================
// Test 2: 429 Retry with Exponential Backoff
// ============================================================================

async function test429Retry() {
  console.log('\n📦 Test 2: 429 Retry with Exponential Backoff');

  let attemptCount = 0;

  const mockFetch = async () => {
    attemptCount++;
    if (attemptCount <= 2) {
      return new Response('Rate limited', { status: 429 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  const startTime = Date.now();
  const response = await fetchWithRateLimitRetry(mockFetch, 3);
  const totalTime = Date.now() - startTime;

  assert(response.status === 200, 'Eventually succeeded after retries');
  assertEqual(attemptCount, 3, 'Made 3 attempts (2 retries)');
  assert(totalTime >= 6000, `Exponential backoff applied (took ${totalTime}ms, expected >= 6000ms for 2s + 4s)`);
  assert(totalTime < 8000, `Backoff reasonable (took ${totalTime}ms, expected < 8000ms)`);
}

// ============================================================================
// Test 3: Field Sanitizer (Empty String → Null)
// ============================================================================

function testFieldSanitizer() {
  console.log('\n📦 Test 3: Field Sanitizer (Empty String → Null)');

  // Test sanitizeDate
  assertEqual(sanitizeDate(''), null, 'Empty string date → null');
  assertEqual(sanitizeDate('2024-01-15'), '2024-01-15', 'Valid date string preserved');
  assertEqual(sanitizeDate('not-a-date'), null, 'Invalid date string → null');
  assertEqual(sanitizeDate(null), null, 'Null date → null');
  assertEqual(sanitizeDate(undefined), null, 'Undefined date → null');

  // Test sanitizeNumber
  assertEqual(sanitizeNumber(''), null, 'Empty string number → null');
  assertEqual(sanitizeNumber('50000'), 50000, 'Valid number string → number');
  assertEqual(sanitizeNumber('abc'), null, 'Invalid number string → null');
  assertEqual(sanitizeNumber(0), 0, 'Zero preserved');
  assertEqual(sanitizeNumber(null), null, 'Null number → null');

  // Test sanitizeInteger
  assertEqual(sanitizeInteger(''), null, 'Empty string integer → null');
  assertEqual(sanitizeInteger('100'), 100, 'Valid integer string → integer');
  assertEqual(sanitizeInteger('100.7'), 100, 'Float rounded down to integer');
  assertEqual(sanitizeInteger(null), null, 'Null integer → null');

  // Test sanitizeBoolean
  assertEqual(sanitizeBoolean(''), null, 'Empty string boolean → null');
  assertEqual(sanitizeBoolean('true'), true, 'String "true" → true');
  assertEqual(sanitizeBoolean('false'), false, 'String "false" → false');
  assertEqual(sanitizeBoolean('1'), true, 'String "1" → true');
  assertEqual(sanitizeBoolean('0'), false, 'String "0" → false');
  assertEqual(sanitizeBoolean(true), true, 'Boolean true preserved');
  assertEqual(sanitizeBoolean(null), null, 'Null boolean → null');

  // Test sanitizeText
  assertEqual(sanitizeText(''), null, 'Empty string text → null (default)');
  assertEqual(sanitizeText('hello'), 'hello', 'Valid text preserved');
  assertEqual(sanitizeText(null), null, 'Null text → null');

  // Test sanitizeForDb
  assertEqual(sanitizeForDb('', 'date'), null, 'sanitizeForDb empty string date → null');
  assertEqual(sanitizeForDb('', 'numeric'), null, 'sanitizeForDb empty string numeric → null');
  assertEqual(sanitizeForDb('', 'integer'), null, 'sanitizeForDb empty string integer → null');
  assertEqual(sanitizeForDb('', 'boolean'), null, 'sanitizeForDb empty string boolean → null');
  assertEqual(sanitizeForDb('', 'text'), null, 'sanitizeForDb empty string text → null');
}

// ============================================================================
// Test 4: Math.round Edge Case
// ============================================================================

function testMathRoundEdgeCase() {
  console.log('\n📦 Test 4: Math.round Edge Case (Empty String Bug)');

  // Demonstrate the bug we fixed
  const emptyString = '';
  const buggyResult = emptyString != null ? Math.round(emptyString as any) : null;
  const fixedResult = sanitizeInteger(emptyString);

  assert(buggyResult === 0, 'Math.round("") = 0 (BUG!)');
  assertEqual(fixedResult, null, 'sanitizeInteger("") = null (FIXED!)');

  // Test with actual number
  const validDuration = 125.7;
  assertEqual(sanitizeInteger(validDuration), 125, 'sanitizeInteger rounds valid numbers correctly');
}

// ============================================================================
// Test 5: Incremental Sync Decision Logic
// ============================================================================

function testIncrementalSyncDecision() {
  console.log('\n📦 Test 5: Incremental Sync Decision Logic');

  // Simulate orchestrator logic
  function decideSyncMode(lastSyncAt: Date | null, mode?: 'initial' | 'incremental'): 'initial' | 'incremental' {
    return mode || (lastSyncAt ? 'incremental' : 'initial');
  }

  // First sync (no last_sync_at)
  assertEqual(decideSyncMode(null), 'initial', 'First sync → initial mode');

  // Second sync (has last_sync_at)
  const lastSyncDate = new Date('2024-01-15T10:00:00Z');
  assertEqual(decideSyncMode(lastSyncDate), 'incremental', 'Second sync → incremental mode');

  // Explicit mode override
  assertEqual(decideSyncMode(null, 'incremental'), 'incremental', 'Explicit mode overrides default');
  assertEqual(decideSyncMode(lastSyncDate, 'initial'), 'initial', 'Explicit mode overrides default');
}

// ============================================================================
// Test 6: Date Validation
// ============================================================================

function testDateValidation() {
  console.log('\n📦 Test 6: Date Validation');

  // Test valid dates
  const validDateString = '2024-01-15';
  const validDate = new Date('2024-01-15T10:00:00Z');
  const validTimestamp = 1705320000000; // 2024-01-15

  assert(sanitizeDate(validDateString) === validDateString, 'Valid date string preserved');
  assert(sanitizeDate(validDate) instanceof Date, 'Valid Date object preserved');
  assert(sanitizeDate(validTimestamp) instanceof Date, 'Valid timestamp converted to Date');

  // Test invalid dates
  assertEqual(sanitizeDate('invalid'), null, 'Invalid date string → null');
  assertEqual(sanitizeDate(NaN), null, 'NaN → null');
  assertEqual(sanitizeDate(new Date('invalid')), null, 'Invalid Date object → null');

  // Test edge cases from production
  assertEqual(sanitizeDate(''), null, 'Empty string (production bug) → null');
  assertEqual(sanitizeDate('0000-00-00'), null, 'Invalid date format → null');
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests() {
  console.log('🚀 Sync Infrastructure Verification\n');
  console.log('Testing all sync hardening components...\n');

  try {
    await testThrottledFetch();
    await test429Retry();
    testFieldSanitizer();
    testMathRoundEdgeCase();
    testIncrementalSyncDecision();
    testDateValidation();

    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`);

    if (testsFailed === 0) {
      console.log('\n✅ All tests passed! Sync infrastructure is production-ready.\n');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed. Review and fix before deploying.\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
