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

export interface SetupEvaluationResult {
  passesPrice: boolean;
  passesGain: boolean;
  passesRvol: boolean;
  passesFloat: boolean;
  passesWindow: boolean;
  passesCatalyst: boolean;
  geminiPass: boolean;
  passesPattern: boolean;
  passesStop: boolean;
  passesRR: boolean;
  allPass: boolean;
  patternResult: any;
  requiredMinRvol: number;
  calculatedRvol: number;
  calculatedStopDistance: number;
  calculatedRatio: number;
  targetPrice: number;
  stopPrice: number;
  entryPrice: number;
  geminiReason: string;
  patternReason: string;
}

