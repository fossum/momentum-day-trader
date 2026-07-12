/**
 * Check if a gainer passes the Ross Cameron baseline criteria.
 * Default: Price $2.00 to $20.00, Daily Gain >= 10%
 */
export function passesBaselineFilter(
  price: number,
  changePercent: number,
  minPrice: number = 2.0,
  maxPrice: number = 20.0,
  minGainPercent: number = 10
): boolean {
  return price >= minPrice && price <= maxPrice && changePercent >= minGainPercent;
}

/**
 * Check if RVOL meets the minimum threshold (Default: 5x).
 */
export function passesRvolFilter(
  rvol: number,
  minRvol: number = 5.0
): boolean {
  return rvol >= minRvol;
}

/**
 * Check if the float (using shares outstanding as proxy) is under the maximum (Default: 20M).
 */
export function passesFloatFilter(
  sharesOutstanding: number,
  maxFloatMillions: number = 20
): boolean {
  return sharesOutstanding >= 1000 && sharesOutstanding <= (maxFloatMillions * 1000000);
}

export const formatCompact = (num: number, locale = 'en-US'): string => {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(num);
};
