export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BullFlagResult {
  detected: boolean;
  resistanceLevel: number;
  pullbackLow: number;
  flagpoleCandles: Candle[];
  pullbackCandles: Candle[];
  nextResistance?: number;
}

export interface BullFlagDiagnostic {
  detected: boolean;
  reason?: string;
  resistanceLevel?: number;
  pullbackLow?: number;
  flagpoleCandles?: Candle[];
  pullbackCandles?: Candle[];
  nextResistance?: number;
}

export interface CatalystResult {
  valid: boolean;
  matchedKeyword: string | null;
}

export interface TradeSetup {
  resistanceLevel: number;
  stopPrice: number;
  targetPrice: number;
  riskRewardRatio: number;
  pullbackLow: number;
  flagpoleCandles: Candle[];
  pullbackCandles: Candle[];
}
