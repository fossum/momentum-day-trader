import { Catalyst } from './Catalyst';

export class PartnershipCatalyst implements Catalyst {
  readonly name = 'Partnership';
  validate(headline: string): boolean {
    const upper = headline.toUpperCase();
    return upper.includes('PARTNERSHIP') || upper.includes('COOPERATION') || upper.includes('COOPERATE');
  }
}
