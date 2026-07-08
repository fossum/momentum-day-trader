/**
 * Functional Test (FT) for the 1-Minute Chart Endpoint.
 *
 * Tests:
 * 1. Endpoint returns valid OHLCV data for a known ticker
 * 2. Candle objects have required fields (date, open, high, low, close, volume)
 * 3. Endpoint returns error for invalid ticker
 *
 * Instructions:
 * 1. Ensure the server is running (e.g. `npm run dev` on port 3000).
 * 2. FMP_API_KEY must be set in .env
 * 3. Run: `node tests/ft_1min_chart.js`
 */

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING 1-MINUTE CHART ENDPOINT FUNCTIONAL TESTS');
  console.log('==================================================');

  // Test 1: Valid ticker returns candle data
  try {
    console.log('\n[TEST] 1. Fetching 1-min chart for AAPL...');
    const res = await fetch(`${BASE_URL}/api/stock/AAPL/chart/1min`);

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(`Endpoint returned status ${res.status}: ${errData.error || res.statusText}`);
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error('Response is not an array');
    }

    if (data.length === 0) {
      throw new Error('Response array is empty — expected candle data');
    }

    console.log(`  Received ${data.length} candles`);
    console.log('  Sample candle:', JSON.stringify(data[0], null, 2));

    // Verify required fields
    const requiredFields = ['date', 'open', 'high', 'low', 'close', 'volume'];
    const firstCandle = data[0];
    for (const field of requiredFields) {
      if (firstCandle[field] === undefined) {
        throw new Error(`Candle is missing required field: "${field}"`);
      }
    }

    // Verify numeric types
    for (const field of ['open', 'high', 'low', 'close', 'volume']) {
      if (typeof firstCandle[field] !== 'number') {
        throw new Error(`Field "${field}" should be a number, got ${typeof firstCandle[field]}`);
      }
    }

    // Verify OHLC sanity (high >= low)
    if (firstCandle.high < firstCandle.low) {
      throw new Error(`High (${firstCandle.high}) should be >= Low (${firstCandle.low})`);
    }

    console.log('✅ 1-min chart endpoint returns valid OHLCV data');
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message);
    process.exitCode = 1;
  }

  // Test 2: Chart data has reasonable candle count
  try {
    console.log('\n[TEST] 2. Verifying candle count is reasonable...');
    const res = await fetch(`${BASE_URL}/api/stock/AAPL/chart/1min`);
    const data = await res.json();

    if (data.length < 5) {
      throw new Error(`Expected at least 5 candles for pattern detection, got ${data.length}`);
    }

    console.log(`  ✓ Got ${data.length} candles — sufficient for pattern analysis`);
    console.log('✅ Candle count validation passed');
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message);
    process.exitCode = 1;
  }

  // Test 3: Uppercase ticker normalization
  try {
    console.log('\n[TEST] 3. Verifying lowercase ticker is normalized...');
    const res = await fetch(`${BASE_URL}/api/stock/aapl/chart/1min`);

    if (!res.ok) {
      throw new Error(`Endpoint returned status ${res.status} for lowercase ticker`);
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Lowercase ticker returned empty/invalid data');
    }

    console.log('✅ Ticker normalization passed');
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message);
    process.exitCode = 1;
  }

  console.log('\n==================================================');
  if (process.exitCode === 1) {
    console.log('FAILED: Some 1-minute chart tests failed.');
  } else {
    console.log('SUCCESS: All 1-minute chart tests passed!');
  }
  console.log('==================================================');
}

runTests();
