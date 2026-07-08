import { Trade } from '../types';

export const calculateTradePnlPercent = (trade: Trade) => {
  if (!trade.entryPrice || trade.entryPrice <= 0) return 0;
  return ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
};
