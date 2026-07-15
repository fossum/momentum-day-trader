import { Catalyst } from './Catalyst';

export class RevenueCatalyst implements Catalyst {
  readonly name = 'Revenue';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('REVENUE');
  }
}
