import { Catalyst } from './Catalyst';

export class SECFilingCatalyst implements Catalyst {
  readonly name = 'SEC Filing';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('SEC FILING');
  }
}
