import { Catalyst } from './Catalyst';

export class EarningsCatalyst implements Catalyst {
  readonly name = 'Earnings';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('EARNINGS');
  }
}
