/**
 * Functional Test (FT) for the Pattern Detection Module.
 *
 * Tests all pure-logic functions from usePatternDetector.ts:
 * 1. 9-period EMA calculation
 * 2. Bull flag pattern detection (positive & negative cases)
 * 3. Catalyst keyword validation
 * 4. Stop distance validation ($0.20 max)
 * 5. Target price / R:R ratio calculation
 *
 * Instructions:
 * 1. This test runs against the compiled module, so the dev server must be running
 *    or the module must be importable.
 * 2. Run: `node tests/ft_pattern_detector.js`
 *
 * Note: Since usePatternDetector.ts is a TypeScript module, we inline the logic
 * for testing. The test verifies the algorithm behavior independent of the TS runtime.
 */

// ============================================================
// Inline pure-logic implementations (mirroring usePatternDetector.ts)
// ============================================================

const CATALYST_KEYWORDS = [
  'FDA', 'Earnings', 'Clinical Trial', 'Partnership', 'Contract',
  'Acquisition', 'Patent', 'Merger', 'Buyout', 'SEC Filing',
  'Drug Approval', 'Phase II', 'Phase III', 'Revenue', 'Guidance'
];

const MAX_STOP_DISTANCE = 0.20;
const MIN_REWARD_RISK_RATIO = 2.0;

function calculate9EMA(candles, period = 9) {
  if (candles.length === 0) return [];
  if (candles.length < period) {
    const sum = candles.reduce((acc, c) => acc + c.close, 0);
    const sma = sum / candles.length;
    return candles.map(() => sma);
  }

  const multiplier = 2 / (period + 1);
  const emaValues = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
    emaValues.push(sum / (i + 1));
  }
  emaValues[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    const prevEma = emaValues[i - 1];
    const ema = (candles[i].close - prevEma) * multiplier + prevEma;
    emaValues.push(ema);
  }

  return emaValues;
}

function getDatePart(dateStr) {
  if (!dateStr) return '';
  if (!dateStr.includes('-') && !dateStr.includes('/')) {
    // If it doesn't look like a date (e.g., in time-only tests), treat them all as the same date
    return 'same-date';
  }
  if (dateStr.includes(' ')) {
    return dateStr.split(' ')[0];
  }
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0];
  }
  return dateStr;
}

function isMicroRedOrDoji(c) {
  if (c.close > c.open) return false;
  const body = c.open - c.close;
  const relativeBody = body / c.open;
  // Body <= $0.02 OR relative change <= 0.2% of open price
  return body <= 0.02 || relativeBody <= 0.002;
}

function isMicroGreenOrDoji(c) {
  if (c.close <= c.open + 0.005) return true; // Standard red/doji is already conforming
  const body = c.close - c.open;
  const relativeBody = body / c.open;
  // Green body <= $0.02 OR relative change <= 0.2% of open price
  return body <= 0.02 || relativeBody <= 0.002;
}

function detectBullFlag(candles, currentPrice, maxProximityPercent = 2.0, maxFlagpoleRedCandles = 1, maxPullbackGreenCandles = 1) {
  if (candles.length === 0) return null;
  const lastDate = getDatePart(candles[candles.length - 1].date);
  const filtered = candles.filter(c => getDatePart(c.date) === lastDate);
  if (filtered.length < 4) return null;

  candles = filtered;
  const emaValues = calculate9EMA(candles);

  const maxScanDepth = Math.max(4, candles.length - 10);
  for (let pullbackEnd = candles.length - 1; pullbackEnd >= maxScanDepth; pullbackEnd--) {
    for (let pullbackLen = 2; pullbackLen <= 4 && pullbackLen <= pullbackEnd; pullbackLen++) {
      const pullbackStart = pullbackEnd - pullbackLen + 1;
      const pullbackCandles = candles.slice(pullbackStart, pullbackEnd + 1);

      let pullbackColorPass = false;
      const greenCandles = pullbackCandles.filter(c => c.close > c.open + 0.005);
      if (greenCandles.length <= maxPullbackGreenCandles) {
        pullbackColorPass = greenCandles.every(isMicroGreenOrDoji);
      }
      if (!pullbackColorPass) continue;

      const pullbackHoldsEma = pullbackCandles.every((c, i) => {
        const emaIdx = pullbackStart + i;
        return emaIdx < emaValues.length && c.low >= emaValues[emaIdx] * 0.998;
      });
      if (!pullbackHoldsEma) continue;

      for (let flagpoleLen = 2; flagpoleLen <= 3 && flagpoleLen <= pullbackStart; flagpoleLen++) {
        const flagpoleStart = pullbackStart - flagpoleLen;
        const flagpoleCandles = candles.slice(flagpoleStart, pullbackStart);

        let flagpoleColorPass = false;
        const nonGreenCandles = flagpoleCandles.filter(c => c.close <= c.open);
        if (nonGreenCandles.length <= maxFlagpoleRedCandles) {
          flagpoleColorPass = nonGreenCandles.every(isMicroRedOrDoji);
        }
        if (flagpoleColorPass && flagpoleCandles.length > 1) {
          if (flagpoleCandles[flagpoleCandles.length - 1].close <= flagpoleCandles[0].open) {
            flagpoleColorPass = false;
          }
        }
        if (!flagpoleColorPass) continue;

        let makingNewHighs = true;
        for (let i = 1; i < flagpoleCandles.length; i++) {
          if (flagpoleCandles[i].high <= flagpoleCandles[i - 1].high) {
            makingNewHighs = false;
            break;
          }
        }
        if (!makingNewHighs) continue;

        const avgFlagpoleVol = flagpoleCandles.reduce((s, c) => s + c.volume, 0) / flagpoleCandles.length;
        const avgPullbackVol = pullbackCandles.reduce((s, c) => s + c.volume, 0) / pullbackCandles.length;

        if (avgFlagpoleVol === 0) continue;
        if (avgPullbackVol >= avgFlagpoleVol * 0.5) continue;

        const resistanceLevel = Math.max(...flagpoleCandles.map(c => c.high));
        const pullbackLow = Math.min(...pullbackCandles.map(c => c.low));

        // Proximity Check
        const priceToCheck = currentPrice !== undefined ? currentPrice : candles[candles.length - 1].close;
        const pctDiff = Math.abs(priceToCheck - resistanceLevel) / resistanceLevel;
        if (pctDiff > (maxProximityPercent / 100)) {
          continue;
        }

        return {
          detected: true,
          resistanceLevel,
          pullbackLow,
          flagpoleCandles,
          pullbackCandles
        };
      }
    }
  }

  return null;
}

function validateStopDistance(entryPrice, pullbackLow) {
  const stopDistance = Number((entryPrice - pullbackLow).toFixed(2));
  return stopDistance > 0 && stopDistance <= MAX_STOP_DISTANCE;
}

function calculateTarget(entryPrice, stopPrice, resistanceLevel) {
  const stopDistance = entryPrice - stopPrice;
  if (stopDistance <= 0) return null;

  const minTarget = entryPrice + stopDistance * MIN_REWARD_RISK_RATIO;

  if (resistanceLevel !== undefined && resistanceLevel >= minTarget) {
    const ratio = (resistanceLevel - entryPrice) / stopDistance;
    return { targetPrice: resistanceLevel, ratio: parseFloat(ratio.toFixed(2)) };
  }

  return {
    targetPrice: parseFloat(minTarget.toFixed(2)),
    ratio: MIN_REWARD_RISK_RATIO
  };
}

function validateCatalyst(headline) {
  if (!headline || headline.trim() === '') {
    return { valid: false, matchedKeyword: null };
  }

  const upperHeadline = headline.toUpperCase();
  for (const keyword of CATALYST_KEYWORDS) {
    if (upperHeadline.includes(keyword.toUpperCase())) {
      return { valid: true, matchedKeyword: keyword };
    }
  }

  return { valid: false, matchedKeyword: null };
}

function passesBaselineFilter(price, changePercent) {
  return price >= 2.0 && price <= 20.0 && changePercent >= 10;
}

function passesRvolFilter(rvol) {
  return rvol >= 5.0;
}

// ============================================================
// Test Helpers
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

function assertClose(actual, expected, tolerance, testName) {
  assert(Math.abs(actual - expected) <= tolerance, `${testName} (actual: ${actual}, expected: ${expected})`);
}

// ============================================================
// Test Suite
// ============================================================

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING PATTERN DETECTOR FUNCTIONAL TESTS');
  console.log('==================================================');

  // ----- 9 EMA Tests -----
  console.log('\n--- 9 EMA Calculation ---');

  {
    // Test 1: EMA with exactly 9 candles returns a valid EMA at position 8 (SMA seed)
    const candles = Array.from({ length: 9 }, (_, i) => ({
      date: `2025-01-01T09:${30 + i}:00`, open: 10 + i * 0.1, high: 10.5 + i * 0.1,
      low: 9.5 + i * 0.1, close: 10 + i * 0.1, volume: 100000
    }));
    const ema = calculate9EMA(candles);
    assert(ema.length === 9, 'EMA returns 9 values for 9 candles');

    // The 9th value should be the SMA of all closes
    const avgClose = candles.reduce((s, c) => s + c.close, 0) / 9;
    assertClose(ema[8], avgClose, 0.001, 'EMA[8] equals SMA seed');
  }

  {
    // Test 2: EMA with fewer than 9 candles returns SMA
    const candles = [
      { date: '2025-01-01T09:30:00', open: 5, high: 5.5, low: 4.5, close: 5.2, volume: 50000 },
      { date: '2025-01-01T09:31:00', open: 5.2, high: 5.6, low: 5.0, close: 5.4, volume: 60000 }
    ];
    const ema = calculate9EMA(candles);
    assert(ema.length === 2, 'EMA returns 2 values for 2 candles');
    const avgClose = (5.2 + 5.4) / 2;
    assertClose(ema[0], avgClose, 0.001, 'Short EMA uses SMA fallback');
  }

  {
    // Test 3: Empty candles
    const ema = calculate9EMA([]);
    assert(ema.length === 0, 'EMA returns empty array for empty input');
  }

  // ----- Bull Flag Detection Tests -----
  console.log('\n--- Bull Flag Detection ---');

  {
    // Test 4: Valid bull flag pattern (2 green flagpole + 2 red low-volume pullback)
    const candles = [
      // Pre-pattern candle
      { date: '09:30', open: 5.0, high: 5.1, low: 4.9, close: 5.05, volume: 50000 },
      // Padding candles for EMA seed (need at least 9 total)
      { date: '09:31', open: 5.05, high: 5.15, low: 5.0, close: 5.10, volume: 55000 },
      { date: '09:32', open: 5.10, high: 5.20, low: 5.05, close: 5.15, volume: 50000 },
      { date: '09:33', open: 5.15, high: 5.25, low: 5.10, close: 5.20, volume: 50000 },
      { date: '09:34', open: 5.20, high: 5.30, low: 5.15, close: 5.25, volume: 50000 },
      { date: '09:35', open: 5.25, high: 5.35, low: 5.20, close: 5.30, volume: 50000 },
      { date: '09:36', open: 5.30, high: 5.40, low: 5.25, close: 5.35, volume: 50000 },
      // Flagpole: 2 green candles making new highs with heavy volume
      { date: '09:37', open: 5.35, high: 5.60, low: 5.30, close: 5.55, volume: 500000 },
      { date: '09:38', open: 5.55, high: 5.80, low: 5.50, close: 5.75, volume: 600000 },
      // Pullback: 2 red candles with LOW volume (< 50% of flagpole avg)
      { date: '09:39', open: 5.75, high: 5.76, low: 5.60, close: 5.65, volume: 80000 },
      { date: '09:40', open: 5.65, high: 5.68, low: 5.55, close: 5.60, volume: 70000 },
    ];

    const result = detectBullFlag(candles, undefined, 5.0);
    assert(result !== null, 'Detects valid bull flag pattern');
    if (result) {
      assert(result.detected === true, 'detected flag is true');
      assertClose(result.resistanceLevel, 5.80, 0.01, 'Resistance level at flagpole high');
      assert(result.pullbackLow >= 5.50 && result.pullbackLow <= 5.60, 'Pullback low in expected range');
      assert(result.flagpoleCandles.length >= 2, 'Flagpole has 2+ candles');
      assert(result.pullbackCandles.length >= 2, 'Pullback has 2+ candles');
    }

    // Test 4.1: Default proximity check (2.0%) should reject this setup (pullback close 5.60 vs resistance 5.80 is 3.45%)
    const resultDefault = detectBullFlag(candles);
    assert(resultDefault === null, 'Rejects bull flag when default 2% proximity check is exceeded');
  }

  {
    // Test 5: No pattern — pullback volume too high (>= 50% of flagpole)
    const candles = [
      { date: '09:30', open: 5.0, high: 5.1, low: 4.9, close: 5.05, volume: 50000 },
      { date: '09:31', open: 5.05, high: 5.15, low: 5.0, close: 5.10, volume: 55000 },
      { date: '09:32', open: 5.10, high: 5.20, low: 5.05, close: 5.15, volume: 50000 },
      { date: '09:33', open: 5.15, high: 5.25, low: 5.10, close: 5.20, volume: 50000 },
      { date: '09:34', open: 5.20, high: 5.30, low: 5.15, close: 5.25, volume: 50000 },
      { date: '09:35', open: 5.25, high: 5.35, low: 5.20, close: 5.30, volume: 50000 },
      { date: '09:36', open: 5.30, high: 5.40, low: 5.25, close: 5.35, volume: 50000 },
      // Flagpole
      { date: '09:37', open: 5.35, high: 5.60, low: 5.30, close: 5.55, volume: 200000 },
      { date: '09:38', open: 5.55, high: 5.80, low: 5.50, close: 5.75, volume: 200000 },
      // Pullback with HEAVY volume (>= 50% of flagpole) — should FAIL
      { date: '09:39', open: 5.75, high: 5.76, low: 5.60, close: 5.65, volume: 150000 },
      { date: '09:40', open: 5.65, high: 5.68, low: 5.55, close: 5.60, volume: 140000 },
    ];

    const result = detectBullFlag(candles);
    assert(result === null, 'Rejects bull flag with high pullback volume (>= 50%)');
  }

  {
    // Test 6: No pattern — not enough candles
    const candles = [
      { date: '09:30', open: 5.0, high: 5.1, low: 4.9, close: 5.1, volume: 100000 },
      { date: '09:31', open: 5.1, high: 5.2, low: 5.0, close: 5.0, volume: 10000 },
    ];
    const result = detectBullFlag(candles);
    assert(result === null, 'Returns null with insufficient candles');
  }

  {
    // Test 6.1: Valid pattern with 1 micro-red candle in flagpole (when maxFlagpoleRedCandles is 1)
    const candles = [
      { date: '09:30', open: 5.0, high: 5.1, low: 4.9, close: 5.05, volume: 50000 },
      { date: '09:31', open: 5.05, high: 5.15, low: 5.0, close: 5.10, volume: 55000 },
      { date: '09:32', open: 5.10, high: 5.20, low: 5.05, close: 5.15, volume: 50000 },
      { date: '09:33', open: 5.15, high: 5.25, low: 5.10, close: 5.20, volume: 50000 },
      { date: '09:34', open: 5.20, high: 5.30, low: 5.15, close: 5.25, volume: 50000 },
      { date: '09:35', open: 5.25, high: 5.35, low: 5.20, close: 5.30, volume: 50000 },
      { date: '09:36', open: 5.30, high: 5.40, low: 5.25, close: 5.35, volume: 50000 },
      // Flagpole: 1 green candle, 1 micro-red candle, making new high
      { date: '09:37', open: 5.35, high: 5.60, low: 5.30, close: 5.55, volume: 500000 },
      { date: '09:38', open: 5.55, high: 5.80, low: 5.50, close: 5.54, volume: 600000 }, // micro-red body 0.01 (1 cent)
      // Pullback: 2 red candles
      { date: '09:39', open: 5.54, high: 5.55, low: 5.45, close: 5.46, volume: 80000 },
      { date: '09:40', open: 5.46, high: 5.48, low: 5.40, close: 5.42, volume: 70000 },
    ];

    const resultRelaxed = detectBullFlag(candles, undefined, 7.0, 1, 1);
    assert(resultRelaxed !== null, 'Accepts flagpole with 1 micro-red candle under relaxed mode');

    const resultStrict = detectBullFlag(candles, undefined, 7.0, 0, 1);
    assert(resultStrict === null, 'Rejects flagpole with 1 micro-red candle under strict mode');
  }

  {
    // Test 6.2: Valid pattern with 1 micro-green candle in pullback (when maxPullbackGreenCandles is 1)
    const candles = [
      { date: '09:30', open: 5.0, high: 5.1, low: 4.9, close: 5.05, volume: 50000 },
      { date: '09:31', open: 5.05, high: 5.15, low: 5.0, close: 5.10, volume: 55000 },
      { date: '09:32', open: 5.10, open: 5.10, high: 5.20, low: 5.05, close: 5.15, volume: 50000 },
      { date: '09:33', open: 5.15, high: 5.25, low: 5.10, close: 5.20, volume: 50000 },
      { date: '09:34', open: 5.20, high: 5.30, low: 5.15, close: 5.25, volume: 50000 },
      { date: '09:35', open: 5.25, high: 5.35, low: 5.20, close: 5.30, volume: 50000 },
      { date: '09:36', open: 5.30, high: 5.40, low: 5.25, close: 5.35, volume: 50000 },
      // Flagpole: 2 green candles
      { date: '09:37', open: 5.35, high: 5.60, low: 5.30, close: 5.55, volume: 500000 },
      { date: '09:38', open: 5.55, high: 5.80, low: 5.50, close: 5.75, volume: 600000 },
      // Pullback: 1 red candle, 1 micro-green candle
      { date: '09:39', open: 5.75, high: 5.76, low: 5.60, close: 5.65, volume: 80000 },
      { date: '09:40', open: 5.65, high: 5.67, low: 5.60, close: 5.66, volume: 70000 }, // micro-green body 0.01 (1 cent)
    ];

    const resultRelaxed = detectBullFlag(candles, undefined, 5.0, 1, 1);
    assert(resultRelaxed !== null, 'Accepts pullback with 1 micro-green candle under relaxed mode');

    const resultStrict = detectBullFlag(candles, undefined, 5.0, 1, 0);
    assert(resultStrict === null, 'Rejects pullback with 1 micro-green candle under strict mode');
  }

  // ----- Catalyst Validation Tests -----
  console.log('\n--- Catalyst Validation ---');

  {
    // Test 7: Valid catalyst with FDA keyword
    const result = validateCatalyst('Company receives FDA Phase II Approval for cancer drug');
    assert(result.valid === true, 'Detects FDA keyword');
    assert(result.matchedKeyword === 'FDA', 'Matched keyword is FDA');
  }

  {
    // Test 8: Valid catalyst with Earnings keyword
    const result = validateCatalyst('Record Earnings Beat: Q4 Revenue Up 45%');
    assert(result.valid === true, 'Detects Earnings keyword');
    assert(result.matchedKeyword === 'Earnings', 'Matched keyword is Earnings');
  }

  {
    // Test 9: No catalyst — irrelevant headline
    const result = validateCatalyst('Stock price rises on no particular news');
    assert(result.valid === false, 'Rejects headline without catalyst keywords');
    assert(result.matchedKeyword === null, 'No matched keyword');
  }

  {
    // Test 10: No catalyst — empty headline
    const result = validateCatalyst('');
    assert(result.valid === false, 'Rejects empty headline');
  }

  {
    // Test 11: No catalyst — null/undefined
    const result = validateCatalyst(null);
    assert(result.valid === false, 'Rejects null headline');
  }

  {
    // Test 12: Case-insensitive matching
    const result = validateCatalyst('company announces strategic partnership');
    assert(result.valid === true, 'Case-insensitive catalyst detection');
    assert(result.matchedKeyword === 'Partnership', 'Matched keyword preserved original case');
  }

  // ----- Stop Distance Validation Tests -----
  console.log('\n--- Stop Distance Validation ---');

  {
    // Test 13: Valid stop distance ($0.15)
    assert(validateStopDistance(5.00, 4.85) === true, 'Accepts $0.15 stop distance');
  }

  {
    // Test 14: Exactly $0.20 stop distance (boundary)
    assert(validateStopDistance(5.00, 4.80) === true, 'Accepts $0.20 stop distance (boundary)');
  }

  {
    // Test 15: Stop distance too wide ($0.25)
    assert(validateStopDistance(5.00, 4.75) === false, 'Rejects $0.25 stop distance');
  }

  {
    // Test 16: Stop distance $0.60 (high price stock)
    assert(validateStopDistance(15.00, 14.40) === false, 'Rejects $0.60 stop on $15 stock');
  }

  {
    // Test 17: Invalid (stop above entry)
    assert(validateStopDistance(5.00, 5.10) === false, 'Rejects stop above entry price');
  }

  // ----- Target / R:R Calculation Tests -----
  console.log('\n--- Target & R:R Calculation ---');

  {
    // Test 18: Valid 2:1 target
    const result = calculateTarget(5.00, 4.85); // $0.15 risk → min target $5.30
    assert(result !== null, 'Returns valid target for good setup');
    if (result) {
      assertClose(result.targetPrice, 5.30, 0.01, 'Target is entry + 2x risk');
      assert(result.ratio >= 2.0, 'R:R ratio >= 2.0');
    }
  }

  {
    // Test 19: Resistance provides > 2:1
    const result = calculateTarget(5.00, 4.85, 5.50); // resistance gives 3.33:1
    assert(result !== null, 'Returns target when resistance provides good R:R');
    if (result) {
      assertClose(result.targetPrice, 5.50, 0.01, 'Uses resistance level as target');
      assert(result.ratio >= 3.0, 'R:R ratio >= 3.0 with resistance');
    }
  }

  {
    // Test 20: Resistance too low for 2:1
    const result = calculateTarget(5.00, 4.85, 5.10); // resistance only gives 0.67:1
    assert(result !== null, 'Returns fallback target when resistance is too low');
    if (result) {
      assertClose(result.targetPrice, 5.30, 0.01, 'Falls back to calculated 2:1 target');
    }
  }

  {
    // Test 21: Invalid setup (stop above entry)
    const result = calculateTarget(5.00, 5.10);
    assert(result === null, 'Returns null for invalid stop (above entry)');
  }

  // ----- Baseline Filter Tests -----
  console.log('\n--- Baseline Screener Filters ---');

  {
    // Test 22: Passes all filters
    assert(passesBaselineFilter(5.50, 15.0) === true, '$5.50 +15% passes baseline');
  }

  {
    // Test 23: Price too low
    assert(passesBaselineFilter(1.50, 20.0) === false, '$1.50 fails price filter (< $2)');
  }

  {
    // Test 24: Price too high
    assert(passesBaselineFilter(25.00, 12.0) === false, '$25.00 fails price filter (> $20)');
  }

  {
    // Test 25: Gain too low
    assert(passesBaselineFilter(5.00, 8.0) === false, '+8% fails gain filter (< 10%)');
  }

  {
    // Test 26: Boundary — exactly $2.00 and 10%
    assert(passesBaselineFilter(2.00, 10.0) === true, '$2.00 +10% passes (boundary)');
  }

  {
    // Test 27: Boundary — exactly $20.00
    assert(passesBaselineFilter(20.00, 15.0) === true, '$20.00 passes (boundary)');
  }

  // ----- RVOL Filter Tests -----
  console.log('\n--- RVOL Filter ---');

  {
    assert(passesRvolFilter(5.0) === true, 'RVOL 5.0x passes (boundary)');
    assert(passesRvolFilter(8.5) === true, 'RVOL 8.5x passes');
    assert(passesRvolFilter(4.9) === false, 'RVOL 4.9x fails (< 5x)');
    assert(passesRvolFilter(1.0) === false, 'RVOL 1.0x fails');
  }

  // ----- Summary -----
  console.log('\n==================================================');
  console.log(`RESULTS: ${passedTests}/${totalTests} tests passed`);
  if (process.exitCode === 1) {
    console.log('FAILED: Some pattern detector tests failed.');
  } else {
    console.log('SUCCESS: All pattern detector tests passed!');
  }
  console.log('==================================================');
}

runTests();
