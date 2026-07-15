import { Catalyst } from './Catalyst';
import { FDACatalyst } from './FDACatalyst';
import { EarningsCatalyst } from './EarningsCatalyst';
import { ClinicalTrialCatalyst } from './ClinicalTrialCatalyst';
import { PartnershipCatalyst } from './PartnershipCatalyst';
import { ContractCatalyst } from './ContractCatalyst';
import { AcquisitionCatalyst } from './AcquisitionCatalyst';
import { PatentCatalyst } from './PatentCatalyst';
import { MergerCatalyst } from './MergerCatalyst';
import { BuyoutCatalyst } from './BuyoutCatalyst';
import { SECFilingCatalyst } from './SECFilingCatalyst';
import { DrugApprovalCatalyst } from './DrugApprovalCatalyst';
import { PhaseIICatalyst } from './PhaseIICatalyst';
import { PhaseIIICatalyst } from './PhaseIIICatalyst';
import { RevenueCatalyst } from './RevenueCatalyst';
import { GuidanceCatalyst } from './GuidanceCatalyst';
import { CatalystResult } from '../types';

export * from './Catalyst';
export * from './FDACatalyst';
export * from './EarningsCatalyst';
export * from './ClinicalTrialCatalyst';
export * from './PartnershipCatalyst';
export * from './ContractCatalyst';
export * from './AcquisitionCatalyst';
export * from './PatentCatalyst';
export * from './MergerCatalyst';
export * from './BuyoutCatalyst';
export * from './SECFilingCatalyst';
export * from './DrugApprovalCatalyst';
export * from './PhaseIICatalyst';
export * from './PhaseIIICatalyst';
export * from './RevenueCatalyst';
export * from './GuidanceCatalyst';

export const ALL_CATALYSTS: Catalyst[] = [
  new FDACatalyst(),
  new EarningsCatalyst(),
  new ClinicalTrialCatalyst(),
  new PartnershipCatalyst(),
  new ContractCatalyst(),
  new AcquisitionCatalyst(),
  new PatentCatalyst(),
  new MergerCatalyst(),
  new BuyoutCatalyst(),
  new SECFilingCatalyst(),
  new DrugApprovalCatalyst(),
  new PhaseIICatalyst(),
  new PhaseIIICatalyst(),
  new RevenueCatalyst(),
  new GuidanceCatalyst()
];

/**
 * Validate that a news headline contains a qualifying catalyst keyword.
 * Ross Cameron's strategy requires a fundamental driver — no catalyst, no trade.
 */
export function validateCatalyst(headline: string): CatalystResult {
  if (!headline || headline.trim() === '') {
    return { valid: false, matchedKeyword: null };
  }

  for (const catalyst of ALL_CATALYSTS) {
    if (catalyst.validate(headline)) {
      return { valid: true, matchedKeyword: catalyst.name };
    }
  }

  return { valid: false, matchedKeyword: null };
}
