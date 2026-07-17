/**
 * Check if the current time is within the Ross Cameron trading window.
 * Default: 9:30 AM – 11:30 AM EST
 * Extended: 9:30 AM – 4:00 PM EST
 */
export function isWithinTradingWindow(extendedHours: boolean = false): boolean {
  return isWithinTradingWindowAt(new Date(), extendedHours);
}

/**
 * Testable version that accepts a Date object instead of using system clock.
 * Used by functional tests.
 */
export function isWithinTradingWindowAt(date: Date, extendedHours: boolean = false): boolean {
  try {
    const etString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    if (day === 0 || day === 6) return false;

    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60 + 30;
    const cameronClose = 11 * 60 + 30;
    const marketClose = 16 * 60;

    const endMinutes = extendedHours ? marketClose : cameronClose;

    return totalMinutes >= marketOpen && totalMinutes <= endMinutes;
  } catch {
    return true;
  }
}

/**
 * Check if the current time is after 10:30 AM EST (the lunchtime lull starts).
 */
export function isAfterLunchtimeLull(): boolean {
  return isAfterLunchtimeLullAt(new Date());
}

export function isAfterLunchtimeLullAt(date: Date): boolean {
  try {
    const etString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    const lullStart = 10 * 60 + 30; // 10:30 AM

    return totalMinutes >= lullStart;
  } catch {
    return false;
  }
}
