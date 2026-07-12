import { Catalyst } from './Catalyst';

export class PhaseIICatalyst implements Catalyst {
  readonly name = 'Phase II';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('PHASE II');
  }
}
