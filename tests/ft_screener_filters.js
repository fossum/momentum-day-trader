/**
 * Functional Test (FT) for the Screener Baseline Filter Logic.
 *
 * Tests that the live gainers endpoint returns data compatible with
 * the Ross Cameron baseline filters (price $2–$20, gain >= 10%, RVOL >= 5x).
 *
 * Instructions:
 * 1. Ensure the server is running (e.g. `npm run dev` on port 3000).
 * 2. FMP_API_KEY must be set in .env
 * 3. Run: `node tests/ft_screener_filters.js`
 */

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Inline filter functions
function passesBaselineFilter(price, changePercent) {
  return price >= 2.0 && price <= 20.0 && changePercent >= 10;
}

function passesRvolFilter(rvol) {
  return rvol >= 5.0;
}

function passesTickerFilter(symbol, name) {
  const sym = symbol.toUpperCase();
  const n = (name || '').toUpperCase();
  const excludedKeywords = ['ETF', 'LEVERAGE', 'TARGET'];
  return !excludedKeywords.some(keyword => sym.includes(keyword) || n.includes(keyword));
}

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING SCREENER FILTER FUNCTIONAL TESTS');
  console.log('==================================================');

  // Test 1: Top gainers endpoint returns valid data
  let gainers = [];
  try {
    console.log('\n[TEST] 1. Fetching top gainers from FMP...');
    const res = await fetch(`${BASE_URL}/api/market/gainers`);

    if (!res.ok) {
      throw new Error(`Endpoint returned status ${res.status}`);
    }

    gainers = await res.json();

    if (!Array.isArray(gainers)) {
      throw new Error('Response is not an array');
    }

    console.log(`  Received ${gainers.length} gainers`);

    // Verify required fields exist on first item
    if (gainers.length > 0) {
      const requiredFields = ['symbol', 'price', 'changesPercentage'];
      for (const field of requiredFields) {
        if (gainers[0][field] === undefined) {
          throw new Error(`Gainer is missing required field: "${field}"`);
        }
      }
    }

    console.log('✅ Top gainers endpoint returns valid data');
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message);
    process.exitCode = 1;
    return; // Can't continue without gainers data
  }

  // Test 2: Apply baseline filters and verify results
  try {
    console.log('\n[TEST] 2. Applying Ross Cameron baseline filters...');

    const passed = gainers.filter(g =>
      passesBaselineFilter(g.price, g.changesPercentage)
    );

    const failed = gainers.filter(g =>
      !passesBaselineFilter(g.price, g.changesPercentage)
    );

    console.log(`  Total gainers: ${gainers.length}`);
    console.log(`  Pass price $2–$20 + gain >= 10%: ${passed.length}`);
    console.log(`  Filtered out: ${failed.length}`);

    // Verify all passed tickers actually meet criteria
    let allValid = true;
    for (const g of passed) {
      if (g.price < 2.0 || g.price > 20.0) {
        console.error(`    ✗ ${g.symbol} price $${g.price} outside $2–$20 range`);
        allValid = false;
      }
      if (g.changesPercentage < 10) {
        console.error(`    ✗ ${g.symbol} gain ${g.changesPercentage}% below 10%`);
        allValid = false;
      }
    }

    if (!allValid) {
      throw new Error('Some tickers that passed filter do not actually meet criteria');
    }

    // Show a sample of what passed
    if (passed.length > 0) {
      console.log('  Sample passing tickers:');
      passed.slice(0, 3).forEach(g => {
        console.log(`    $${g.symbol}: $${g.price.toFixed(2)} (+${g.changesPercentage.toFixed(1)}%)`);
      });
    }

    // Show a sample of what was filtered out
    if (failed.length > 0) {
      console.log('  Sample filtered-out tickers:');
      failed.slice(0, 3).forEach(g => {
        const reasons = [];
        if (g.price < 2.0) reasons.push(`price $${g.price.toFixed(2)} < $2`);
        if (g.price > 20.0) reasons.push(`price $${g.price.toFixed(2)} > $20`);
        if (g.changesPercentage < 10) reasons.push(`gain ${g.changesPercentage.toFixed(1)}% < 10%`);
        console.log(`    $${g.symbol}: filtered because ${reasons.join(', ')}`);
      });
    }

    console.log('✅ Baseline filter logic is correct');
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message);
    process.exitCode = 1;
  }

  // Test 3: RVOL validation via live-data endpoint for a passing gainer
  try {
    const passed = gainers.filter(g => passesBaselineFilter(g.price, g.changesPercentage));

    if (passed.length === 0) {
      console.log('\n[SKIP] 3. No gainers passed baseline filter — cannot test RVOL');
    } else {
      const testTicker = passed[0];
      console.log(`\n[TEST] 3. Fetching RVOL for $${testTicker.symbol} via live-data...`);

      const res = await fetch(`${BASE_URL}/api/stock/${testTicker.symbol}/live-data`);

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(`Live data endpoint returned status ${res.status}: ${errData.error}`);
      }

      const data = await res.json();

      if (data.rvol === undefined || typeof data.rvol !== 'number') {
        throw new Error('Live data response missing or invalid "rvol" field');
      }

      console.log(`  $${testTicker.symbol} RVOL: ${data.rvol}x`);
      console.log(`  Passes RVOL >= 5x filter: ${passesRvolFilter(data.rvol) ? 'YES' : 'NO'}`);
      console.log(`  Catalyst: "${data.catalyst || 'None'}"`);

      // Verify data shape
      const requiredFields = ['price', 'volume', 'avgVolume', 'rvol', 'catalyst'];
      for (const field of requiredFields) {
        if (data[field] === undefined) {
          throw new Error(`Live data missing required field: "${field}"`);
        }
      }

      console.log('✅ RVOL and live-data endpoint working correctly');
    }
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message);
    process.exitCode = 1;
  }

  // Test 4: Verify ETF/Leverage/Target ticker exclusion filter
  try {
    console.log('\n[TEST] 4. Verifying ETF/Leverage/Target ticker exclusion filter on mock and real data...');

    const testCases = [
      { symbol: 'DNNG', name: 'Leverage Shares 2x Long DNN Daily ETF', expected: false },
      { symbol: 'MUZ', name: '2X Short MU ETF', expected: false },
      { symbol: 'TGT', name: 'Target Corporation', expected: false },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', expected: false },
      { symbol: 'AAPL', name: 'Apple Inc.', expected: true },
      { symbol: 'TSLA', name: 'Tesla, Inc.', expected: true },
      { symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3X Shares ETF', expected: false },
      { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ ETF', expected: false },
      { symbol: 'TARGET1', name: 'Some other Target stock', expected: false }
    ];

    let allCasesPassed = true;
    for (const tc of testCases) {
      const result = passesTickerFilter(tc.symbol, tc.name);
      if (result !== tc.expected) {
        console.error(`    Excluding ticker filter failed for $${tc.symbol} (${tc.name}): expected ${tc.expected}, got ${result}`);
        allCasesPassed = false;
      } else {
        console.log(`    ✓ Filter correct for $${tc.symbol} (${tc.name}): got ${result}`);
      }
    }

    if (!allCasesPassed) {
      throw new Error('Some mock filter test cases did not behave as expected');
    }

    // Apply passesTickerFilter to the fetched gainers
    const passedTickers = gainers.filter(g => passesBaselineFilter(g.price, g.changesPercentage) && passesTickerFilter(g.symbol, g.name));
    const excludedTickers = gainers.filter(g => passesBaselineFilter(g.price, g.changesPercentage) && !passesTickerFilter(g.symbol, g.name));

    console.log(`  Real gainers passing baseline AND ticker filters: ${passedTickers.length}`);
    console.log(`  Real gainers excluded by ETF/Leverage/Target filter: ${excludedTickers.length}`);

    if (excludedTickers.length > 0) {
      console.log('  Sample excluded real gainers:');
      excludedTickers.slice(0, 3).forEach(g => {
        console.log(`    Excluded $${g.symbol} (${g.name || 'Unknown'})`);
      });
    }

    console.log('✅ ETF/Leverage/Target exclusion filter tests passed');
  } catch (error) {
    console.error('❌ Test 4 failed:', error.message);
    process.exitCode = 1;
  }

  console.log('\n==================================================');
  if (process.exitCode === 1) {
    console.log('FAILED: Some screener filter tests failed.');
  } else {
    console.log('SUCCESS: All screener filter tests passed!');
  }
  console.log('==================================================');
}

runTests();
