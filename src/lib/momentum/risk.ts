export const MAX_STOP_DISTANCE_DEFAULT = 0.20;
export const MIN_STOP_DISTANCE_DEFAULT = 0.05;
export const MIN_REWARD_RISK_RATIO_DEFAULT = 2.0;

/**
 * Validate the stop distance is within the maximum.
 * Returns true if the trade is acceptable, false if the stop is too wide or too narrow.
 */
export function validateStopDistance(
  entryPrice: number,
  pullbackLow: number,
  maxStopDistance: number = MAX_STOP_DISTANCE_DEFAULT,
  minStopDistance: number = MIN_STOP_DISTANCE_DEFAULT
): boolean {
  const stopDistance = Number((entryPrice - pullbackLow).toFixed(2));
  return stopDistance >= minStopDistance && stopDistance <= maxStopDistance;
}

/**
 * Calculate the profit target ensuring a minimum reward:risk ratio.
 * The target is set at the resistance breakout level if it provides >= min R:R.
 * If not, the target is calculated based on the required R:R.
 *
 * Returns the target price and actual R:R ratio, or null if the setup is invalid.
 */
export function calculateTarget(
  entryPrice: number,
  stopPrice: number,
  resistanceLevel?: number,
  minRewardRiskRatio: number = MIN_REWARD_RISK_RATIO_DEFAULT,
  minStopDistance: number = MIN_STOP_DISTANCE_DEFAULT
): { targetPrice: number; ratio: number } | null {
  const stopDistance = entryPrice - stopPrice;
  if (isNaN(stopDistance) || stopDistance < minStopDistance) return null;

  const minTarget = entryPrice + stopDistance * minRewardRiskRatio;

  // If resistance level provides at least required R:R, use it
  if (resistanceLevel !== undefined && resistanceLevel >= minTarget) {
    const ratio = (resistanceLevel - entryPrice) / stopDistance;
    return { targetPrice: resistanceLevel, ratio: parseFloat(ratio.toFixed(2)) };
  }

  // Otherwise, use the calculated minimum target
  return {
    targetPrice: parseFloat(minTarget.toFixed(2)),
    ratio: minRewardRiskRatio
  };
}
