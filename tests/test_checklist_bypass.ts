import { passesRvolFilter, passesFloatFilter, isWithinTradingWindowAt } from '../src/hooks/usePatternDetector';
import { UserPreferences, MarketGainer } from '../src/types';

console.log("==================================================");
console.log("RUNNING CHECKLIST BYPASS LOGIC TESTS");
console.log("==================================================");

// Mock function mirroring Case 0 baseline/checklist logic
function runCase0Checklist(
  liveData: { price: number; rvol: number; sharesOutstanding: number; catalyst: string },
  selectedGainer: MarketGainer,
  preferences: UserPreferences,
  mockTradingTime: Date = new Date("2026-07-10T10:00:00-04:00") // 10:00 AM EST (within trading window)
) {
  const minPrice = preferences.minPrice ?? 2.0;
  const maxPrice = preferences.maxPrice ?? 20.0;
  const minGainPercent = preferences.minGainPercent ?? 10;
  const minRvol = preferences.minRvol ?? 5.0;
  const maxFloatMillions = preferences.maxFloatMillions ?? 20;

  const checkPriceRange = preferences.checkPriceRange ?? true;
  const checkDailyGain = preferences.checkDailyGain ?? true;
  const checkRelativeVol = preferences.checkRelativeVol ?? true;
  const checkSharesFloat = preferences.checkSharesFloat ?? true;
  const checkTradingWindow = preferences.checkTradingWindow ?? true;

  const catalystValidation = preferences.catalystValidation ?? 'gemini';
  const checkNewsCatalyst = catalystValidation === 'keywords' || catalystValidation === 'gemini';
  const checkGeminiSentiment = catalystValidation === 'gemini';

  const passesPrice = !checkPriceRange || (liveData.price >= minPrice && liveData.price <= maxPrice);
  const passesGain = !checkDailyGain || (selectedGainer.changesPercentage >= minGainPercent);
  const passesRvol = !checkRelativeVol || passesRvolFilter(liveData.rvol, minRvol);
  
  const hasKnownFloat = liveData.sharesOutstanding !== 0 && !!liveData.sharesOutstanding;
  const passesFloat = !checkSharesFloat || (hasKnownFloat && passesFloatFilter(liveData.sharesOutstanding, maxFloatMillions));
  
  const passesWindow = !checkTradingWindow || isWithinTradingWindowAt(mockTradingTime, preferences.extendedTradingHours);

  // Mock catalyst result keyword matching
  const passesCatalyst = !checkNewsCatalyst || (liveData.catalyst.toLowerCase().includes("partnership") || liveData.catalyst.toLowerCase().includes("acquisition") || liveData.catalyst.toLowerCase().includes("agreement"));

  // Mock Gemini Sentiment
  let geminiPass = true;
  if (checkGeminiSentiment) {
    if (checkNewsCatalyst ? passesCatalyst : true) {
      geminiPass = liveData.catalyst.toLowerCase().includes("profit") || liveData.catalyst.toLowerCase().includes("positive");
    } else {
      geminiPass = false;
    }
  }

  return {
    passesPrice,
    passesGain,
    passesRvol,
    passesFloat,
    passesWindow,
    passesCatalyst,
    geminiPass,
    allPass: passesPrice && passesGain && passesRvol && passesFloat && passesWindow && passesCatalyst && geminiPass
  };
}

// Helper to create mock UserPreferences with required fields
function createMockPrefs(prefs: Partial<UserPreferences>): UserPreferences {
  return {
    markets: [],
    robinhoodOnly: false,
    ...prefs
  };
}

// 1. Test case: All filters active, valid stock passes
{
  const prefs = createMockPrefs({
    minPrice: 2.0,
    maxPrice: 20.0,
    minGainPercent: 10,
    minRvol: 5.0,
    maxFloatMillions: 20,
    catalystValidation: 'gemini',
    checkPriceRange: true,
    checkDailyGain: true,
    checkRelativeVol: true,
    checkSharesFloat: true,
    checkTradingWindow: true
  });
  const gainer: MarketGainer = { symbol: 'AAPL', name: 'Apple', price: 10.0, change: 1.5, changesPercentage: 15 };
  const liveData = { price: 10.0, rvol: 6.0, sharesOutstanding: 5000000, catalyst: "Agreement for positive profit" };

  const result = runCase0Checklist(liveData, gainer, prefs);
  if (result.allPass) {
    console.log("✅ Test 1: All filters enabled, valid stock passes - PASSED");
  } else {
    console.error("❌ Test 1: All filters enabled, valid stock passes - FAILED", result);
  }
}

// 2. Test case: All filters active, stock with bad price range fails
{
  const prefs = createMockPrefs({
    minPrice: 2.0,
    maxPrice: 20.0,
    minGainPercent: 10,
    minRvol: 5.0,
    maxFloatMillions: 20,
    catalystValidation: 'gemini',
    checkPriceRange: true
  });
  const gainer: MarketGainer = { symbol: 'AAPL', name: 'Apple', price: 25.0, change: 1.5, changesPercentage: 15 };
  const liveData = { price: 25.0, rvol: 6.0, sharesOutstanding: 5000000, catalyst: "Agreement for positive profit" };

  const result = runCase0Checklist(liveData, gainer, prefs);
  if (!result.passesPrice && !result.allPass) {
    console.log("✅ Test 2: Price range filter works correctly - PASSED");
  } else {
    console.error("❌ Test 2: Price range filter works correctly - FAILED", result);
  }
}

// 3. Test case: Price Range bypass active, stock with bad price range still passes price range check
{
  const prefs = createMockPrefs({
    minPrice: 2.0,
    maxPrice: 20.0,
    minGainPercent: 10,
    minRvol: 5.0,
    maxFloatMillions: 20,
    catalystValidation: 'gemini',
    checkPriceRange: false
  });
  const gainer: MarketGainer = { symbol: 'AAPL', name: 'Apple', price: 25.0, change: 1.5, changesPercentage: 15 };
  const liveData = { price: 25.0, rvol: 6.0, sharesOutstanding: 5000000, catalyst: "Agreement for positive profit" };

  const result = runCase0Checklist(liveData, gainer, prefs);
  if (result.passesPrice) {
    console.log("✅ Test 3: Price range bypass works correctly - PASSED");
  } else {
    console.error("❌ Test 3: Price range bypass works correctly - FAILED", result);
  }
}

// 4. Test case: Catalyst Validation = keywords (Gemini is bypassed)
{
  const prefs = createMockPrefs({
    minPrice: 2.0,
    maxPrice: 20.0,
    minGainPercent: 10,
    minRvol: 5.0,
    maxFloatMillions: 20,
    catalystValidation: 'keywords'
  });
  const gainer: MarketGainer = { symbol: 'AAPL', name: 'Apple', price: 10.0, change: 1.5, changesPercentage: 15 };
  // Headline contains valid keyword "partnership" but negative sentiment "loss"
  const liveData = { price: 10.0, rvol: 6.0, sharesOutstanding: 5000000, catalyst: "partnership with loss" };

  const result = runCase0Checklist(liveData, gainer, prefs);
  if (result.passesCatalyst && result.geminiPass && result.allPass) {
    console.log("✅ Test 4: Catalyst keywords-only validation (Gemini bypassed) works - PASSED");
  } else {
    console.error("❌ Test 4: Catalyst keywords-only validation (Gemini bypassed) works - FAILED", result);
  }
}

// 5. Test case: Catalyst Validation = bypassed (both keywords and Gemini bypassed)
{
  const prefs = createMockPrefs({
    minPrice: 2.0,
    maxPrice: 20.0,
    minGainPercent: 10,
    minRvol: 5.0,
    maxFloatMillions: 20,
    catalystValidation: 'bypassed'
  });
  const gainer: MarketGainer = { symbol: 'AAPL', name: 'Apple', price: 10.0, change: 1.5, changesPercentage: 15 };
  // Headline contains NO keywords and is negative, but catalyst check is bypassed
  const liveData = { price: 10.0, rvol: 6.0, sharesOutstanding: 5000000, catalyst: "No news driver and loss" };

  const result = runCase0Checklist(liveData, gainer, prefs);
  if (result.passesCatalyst && result.geminiPass && result.allPass) {
    console.log("✅ Test 5: Catalyst bypassed validation works - PASSED");
  } else {
    console.error("❌ Test 5: Catalyst bypassed validation works - FAILED", result);
  }
}
