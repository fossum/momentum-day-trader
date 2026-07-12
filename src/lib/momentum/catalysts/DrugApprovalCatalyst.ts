import { Catalyst } from './Catalyst';

export class DrugApprovalCatalyst implements Catalyst {
  readonly name = 'Drug Approval';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('DRUG APPROVAL');
  }
}
