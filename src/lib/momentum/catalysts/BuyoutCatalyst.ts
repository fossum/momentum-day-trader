import { Catalyst } from './Catalyst';

export class BuyoutCatalyst implements Catalyst {
  readonly name = 'Buyout';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('BUYOUT');
  }
}
