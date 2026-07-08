/**
 * Functional Test (FT) for Trading Window Enforcement Logic.
 *
 * Tests the `isWithinTradingWindowAt` function that determines whether
 * the engine should accept trades based on the Ross Cameron window.
 *
 * Default: 9:30 AM – 11:30 AM EST
 * Extended: 9:30 AM – 4:00 PM EST
 *
 * Instructions:
 * Run: `node tests/ft_trading_window.js`
 */

// ============================================================
// Inline implementation (mirroring usePatternDetector.ts)
// ============================================================

function isWithinTradingWindowAt(date, extendedHours = false) {
  try {
    const etString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    if (day === 0 || day === 6) return false;

    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60 + 30;     // 9:30 AM
    const cameronClose = 11 * 60 + 30;  // 11:30 AM
    const marketClose = 16 * 60;         // 4:00 PM

    const endMinutes = extendedHours ? marketClose : cameronClose;

    return totalMinutes >= marketOpen && totalMinutes <= endMinutes;
  } catch {
    return true;
  }
}

// Helper to create a date at a specific ET time
// We use explicit UTC offsets since ET is UTC-5 (EST) or UTC-4 (EDT)
// July = EDT = UTC-4
function makeETDate(year, month, day, hour, minute) {
  // month is 1-indexed here for readability
  // EDT offset is UTC-4, so to get e.g. 10:00 AM ET, we need 14:00 UTC
  const utcHour = hour + 4; // EDT offset
  return new Date(Date.UTC(year, month - 1, day, utcHour, minute, 0));
}

// ============================================================
// Test Suite
// ============================================================

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ ${testName}`);
  } else {
    console.error(`  ❌ ${testName}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING TRADING WINDOW FUNCTIONAL TESTS');
  console.log('==================================================');

  // ----- Default Window (9:30 – 11:30 AM EST) -----
  console.log('\n--- Default Window (9:30 – 11:30 AM ET) ---');

  {
    // Test 1: 10:00 AM ET on a Wednesday — should be IN window
    const date = makeETDate(2026, 7, 8, 10, 0); // Wed July 8, 10:00 AM ET
    assert(isWithinTradingWindowAt(date, false) === true, '10:00 AM ET Wednesday → IN window');
  }

  {
    // Test 2: 9:30 AM ET — exactly at open (boundary)
    const date = makeETDate(2026, 7, 8, 9, 30);
    assert(isWithinTradingWindowAt(date, false) === true, '9:30 AM ET → IN window (boundary)');
  }

  {
    // Test 3: 11:30 AM ET — exactly at close (boundary)
    const date = makeETDate(2026, 7, 8, 11, 30);
    assert(isWithinTradingWindowAt(date, false) === true, '11:30 AM ET → IN window (boundary)');
  }

  {
    // Test 4: 9:29 AM ET — just before open
    const date = makeETDate(2026, 7, 8, 9, 29);
    assert(isWithinTradingWindowAt(date, false) === false, '9:29 AM ET → OUTSIDE window');
  }

  {
    // Test 5: 11:31 AM ET — just after close
    const date = makeETDate(2026, 7, 8, 11, 31);
    assert(isWithinTradingWindowAt(date, false) === false, '11:31 AM ET → OUTSIDE window');
  }

  {
    // Test 6: 2:00 PM ET — afternoon
    const date = makeETDate(2026, 7, 8, 14, 0);
    assert(isWithinTradingWindowAt(date, false) === false, '2:00 PM ET → OUTSIDE default window');
  }

  {
    // Test 7: 8:00 AM ET — pre-market
    const date = makeETDate(2026, 7, 8, 8, 0);
    assert(isWithinTradingWindowAt(date, false) === false, '8:00 AM ET → OUTSIDE window (pre-market)');
  }

  // ----- Extended Window (9:30 AM – 4:00 PM ET) -----
  console.log('\n--- Extended Window (9:30 AM – 4:00 PM ET) ---');

  {
    // Test 8: 2:00 PM ET with extended hours — should be IN window
    const date = makeETDate(2026, 7, 8, 14, 0);
    assert(isWithinTradingWindowAt(date, true) === true, '2:00 PM ET extended → IN window');
  }

  {
    // Test 9: 4:00 PM ET with extended hours — boundary
    const date = makeETDate(2026, 7, 8, 16, 0);
    assert(isWithinTradingWindowAt(date, true) === true, '4:00 PM ET extended → IN window (boundary)');
  }

  {
    // Test 10: 4:01 PM ET with extended hours — just after close
    const date = makeETDate(2026, 7, 8, 16, 1);
    assert(isWithinTradingWindowAt(date, true) === false, '4:01 PM ET extended → OUTSIDE window');
  }

  {
    // Test 11: 11:31 AM ET with extended hours — should still be IN
    const date = makeETDate(2026, 7, 8, 11, 31);
    assert(isWithinTradingWindowAt(date, true) === true, '11:31 AM ET extended → IN window');
  }

  // ----- Weekend Tests -----
  console.log('\n--- Weekend Tests ---');

  {
    // Test 12: Saturday 10:00 AM ET — weekend
    const date = makeETDate(2026, 7, 11, 10, 0); // July 11, 2026 = Saturday
    assert(isWithinTradingWindowAt(date, false) === false, 'Saturday 10:00 AM → OUTSIDE (weekend)');
  }

  {
    // Test 13: Sunday 10:00 AM ET — weekend
    const date = makeETDate(2026, 7, 12, 10, 0); // July 12, 2026 = Sunday
    assert(isWithinTradingWindowAt(date, false) === false, 'Sunday 10:00 AM → OUTSIDE (weekend)');
  }

  {
    // Test 14: Saturday with extended hours — still blocked
    const date = makeETDate(2026, 7, 11, 10, 0);
    assert(isWithinTradingWindowAt(date, true) === false, 'Saturday extended hours → OUTSIDE (weekend)');
  }

  // ----- Summary -----
  console.log('\n==================================================');
  console.log(`RESULTS: ${passedTests}/${totalTests} tests passed`);
  if (process.exitCode === 1) {
    console.log('FAILED: Some trading window tests failed.');
  } else {
    console.log('SUCCESS: All trading window tests passed!');
  }
  console.log('==================================================');
}

runTests();
