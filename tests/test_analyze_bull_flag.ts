import { analyzeBullFlag, Candle } from '../src/hooks/usePatternDetector';

console.log("==================================================");
console.log("RUNNING ANALYZE BULL FLAG DIAGNOSTIC TESTS");
console.log("==================================================");

// Helper to create 9-period EMA baseline candles
function createBaseCandles(count: number, basePrice: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      date: `2026-07-10T09:3${i}:00-04:00`,
      open: basePrice,
      high: basePrice + 0.05,
      low: basePrice - 0.05,
      close: basePrice,
      volume: 1000
    });
  }
  return candles;
}

// 1. Test case: Insufficient candles
{
  const candles = createBaseCandles(3, 10);
  const result = analyzeBullFlag(candles);
  if (!result.detected && result.reason?.includes("Insufficient candle data")) {
    console.log("✅ Case 1: Insufficient data test passed.");
  } else {
    console.error("❌ Case 1: Insufficient data test failed.", result);
  }
}

// 2. Test case: Valid Bull Flag
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole: 2 strong green candles making higher highs, high volume
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.0,
    high: 10.5,
    low: 9.9,
    close: 10.4,
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.4,
    high: 11.2,
    low: 10.3,
    close: 11.0,
    volume: 15000
  });

  // Pullback: 2 small red candles, low volume, holding above EMA
  // EMA of close values is roughly around 10.2 - 10.4
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 11.0,
    high: 11.0,
    low: 10.7,
    close: 10.8,
    volume: 3000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 10.8,
    high: 10.8,
    low: 10.5,
    close: 10.6,
    volume: 2000
  });

  const result = analyzeBullFlag(candles, undefined, 6.0);
  if (result.detected && result.resistanceLevel === 11.2 && result.pullbackLow === 10.5) {
    console.log("✅ Case 2: Valid Bull Flag detection passed.");
  } else {
    console.error("❌ Case 2: Valid Bull Flag detection failed.", result);
  }
}

// 3. Test case: Flagpole not green
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole with a red candle (close < open)
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.5,
    high: 10.6,
    low: 9.9,
    close: 10.1, // Red
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.1,
    high: 11.2,
    low: 10.0,
    close: 11.0,
    volume: 15000
  });

  // Pullback
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 11.0,
    high: 11.0,
    low: 10.7,
    close: 10.8,
    volume: 3000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 10.8,
    high: 10.8,
    low: 10.5,
    close: 10.6,
    volume: 2000
  });

  const result = analyzeBullFlag(candles);
  if (!result.detected && result.reason?.includes("Flagpole candles are not all green")) {
    console.log("✅ Case 3: Flagpole not all green diagnosis passed.");
  } else {
    console.error("❌ Case 3: Flagpole not all green diagnosis failed.", result);
  }
}

// 4. Test case: Flagpole not making higher highs
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole: consecutive green candles but second one has a lower high
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.0,
    high: 11.5, // High high
    low: 9.9,
    close: 10.4,
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.4,
    high: 11.0, // Lower high
    low: 10.3,
    close: 10.9,
    volume: 15000
  });

  // Pullback
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 10.9,
    high: 10.9,
    low: 10.7,
    close: 10.8,
    volume: 3000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 10.8,
    high: 10.8,
    low: 10.5,
    close: 10.6,
    volume: 2000
  });

  const result = analyzeBullFlag(candles);
  if (!result.detected && result.reason?.includes("making higher highs")) {
    console.log("✅ Case 4: Flagpole not making higher highs diagnosis passed.");
  } else {
    console.error("❌ Case 4: Flagpole not making higher highs diagnosis failed.", result);
  }
}

// 5. Test case: Pullback average volume too high
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.0,
    high: 10.5,
    low: 9.9,
    close: 10.4,
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.4,
    high: 11.2,
    low: 10.3,
    close: 11.0,
    volume: 15000
  }); // Avg flagpole volume = 12,500

  // Pullback: high volume (avg = 8,000, which is 64% of flagpole)
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 11.0,
    high: 11.0,
    low: 10.7,
    close: 10.8,
    volume: 9000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 10.8,
    high: 10.8,
    low: 10.5,
    close: 10.6,
    volume: 7000
  });

  const result = analyzeBullFlag(candles);
  if (!result.detected && result.reason?.includes("volume is too high")) {
    console.log("✅ Case 5: Pullback volume too high diagnosis passed.");
  } else {
    console.error("❌ Case 5: Pullback volume too high diagnosis failed.", result);
  }
}

// 6. Test case: Pullback broke below 9 EMA
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.0,
    high: 10.5,
    low: 9.9,
    close: 10.4,
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.4,
    high: 11.2,
    low: 10.3,
    close: 11.0,
    volume: 15000
  });

  // Pullback: low goes all the way down to 8.0, which is far below EMA
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 11.0,
    high: 11.0,
    low: 8.0,
    close: 8.5,
    volume: 3000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 8.5,
    high: 8.5,
    low: 8.0,
    close: 8.2,
    volume: 2000
  });

  const result = analyzeBullFlag(candles);
  if (!result.detected && result.reason?.includes("broke below the 9 EMA")) {
    console.log("✅ Case 6: Pullback broke below EMA diagnosis passed.");
  } else {
    console.error("❌ Case 6: Pullback broke below EMA diagnosis failed.", result);
  }
}

// 7. Test case: Proximity Check Failing
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.0,
    high: 10.5,
    low: 9.9,
    close: 10.4,
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.4,
    high: 11.2,
    low: 10.3,
    close: 11.0,
    volume: 15000
  }); // resistance: 11.2

  // Pullback: close is 10.6, resistance is 11.2 (diff 5.35%)
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 11.0,
    high: 11.0,
    low: 10.7,
    close: 10.8,
    volume: 3000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 10.8,
    high: 10.8,
    low: 10.5,
    close: 10.6,
    volume: 2000
  });

  // Default maxProximityPercent is 2.0% -> should fail proximity check
  const result = analyzeBullFlag(candles, undefined, 2.0);
  if (!result.detected && result.reason?.includes("Proximity check failed")) {
    console.log("✅ Case 7: Proximity check failing test passed.");
  } else {
    console.error("❌ Case 7: Proximity check failing test failed.", result);
  }
}

// 8. Test case: Proximity Check Passing (with close price)
{
  const candles = createBaseCandles(10, 10);
  
  // Flagpole
  candles.push({
    date: '2026-07-10T09:40:00-04:00',
    open: 10.0,
    high: 10.5,
    low: 9.9,
    close: 10.4,
    volume: 10000
  });
  candles.push({
    date: '2026-07-10T09:41:00-04:00',
    open: 10.4,
    high: 11.2,
    low: 10.3,
    close: 11.0,
    volume: 15000
  }); // resistance: 11.2

  // Pullback: close is 10.98 (within 2% of 11.2, close <= open so red/doji)
  candles.push({
    date: '2026-07-10T09:42:00-04:00',
    open: 11.0,
    high: 11.02,
    low: 10.95,
    close: 10.98,
    volume: 3000
  });
  candles.push({
    date: '2026-07-10T09:43:00-04:00',
    open: 10.98,
    high: 11.0,
    low: 10.95,
    close: 10.98,
    volume: 2000
  });

  const result = analyzeBullFlag(candles, undefined, 2.0);
  if (result.detected && result.resistanceLevel === 11.2) {
    console.log("✅ Case 8: Proximity check passing test passed.");
  } else {
    console.error("❌ Case 8: Proximity check passing test failed.", result);
  }
}

console.log("==================================================");
