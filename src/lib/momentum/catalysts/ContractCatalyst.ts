import { Catalyst } from './Catalyst';

export class ContractCatalyst implements Catalyst {
  readonly name = 'Contract';
  validate(headline: string): boolean {
    const upper = headline.toUpperCase();
    return upper.includes('CONTRACT') || upper.includes('AGREEMENT');
  }
}
