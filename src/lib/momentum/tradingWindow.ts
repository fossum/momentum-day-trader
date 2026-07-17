/**
 * @fileoverview Trading window utilities and constants for the Ross Cameron momentum strategy.
 * Defines the morning trading window bounds (9:30 AM - 11:30 AM EST), lunchtime lull threshold,
 * and helper functions to validate if a given date falls within these periods.
 */

/** Market open time in minutes from midnight (9:30 AM EST). */
export const MARKET_OPEN_MINUTES = 9 * 60 + 30;

/** Ross Cameron morning trading window close time in minutes from midnight (11:30 AM EST). */
export const CAMERON_CLOSE_MINUTES = 11 * 60 + 30;

/** Regular market close time in minutes from midnight (4:00 PM EST). */
export const MARKET_CLOSE_MINUTES = 16 * 60;

/** Lunchtime lull start time in minutes from midnight (10:30 AM EST). */
export const LULL_START_MINUTES = 10 * 60 + 30;

/**
 * Check if the current time is within the Ross Cameron trading window.
 * 
 * @param extendedHours - Whether to extend the trading window to regular market close (4:00 PM EST).
 * @returns True if the current time is within the window, false otherwise.
 */
export function isWithinTradingWindow(extendedHours: boolean = false): boolean {
  return isWithinTradingWindowAt(new Date(), extendedHours);
}

/**
 * Check if a specific date and time is within the Ross Cameron trading window.
 * 
 * @param date - The Date object representing the time to check.
 * @param extendedHours - Whether to extend the window to regular market close (4:00 PM EST).
 * @returns True if the date is within the window, false otherwise.
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

    const endMinutes = extendedHours ? MARKET_CLOSE_MINUTES : CAMERON_CLOSE_MINUTES;

    return totalMinutes >= MARKET_OPEN_MINUTES && totalMinutes <= endMinutes;
  } catch {
    return true;
  }
}

/**
 * Check if the current time is after 10:30 AM EST (the lunchtime lull starts).
 * 
 * @returns True if after 10:30 AM EST, false otherwise.
 */
export function isAfterLunchtimeLull(): boolean {
  return isAfterLunchtimeLullAt(new Date());
}

/**
 * Check if a specific date and time is after 10:30 AM EST.
 * 
 * @param date - The Date object to check.
 * @returns True if after 10:30 AM EST, false otherwise.
 */
export function isAfterLunchtimeLullAt(date: Date): boolean {
  try {
    const etString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    return totalMinutes >= LULL_START_MINUTES;
  } catch {
    return false;
  }
}

