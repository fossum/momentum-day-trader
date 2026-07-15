import { Catalyst } from './Catalyst';

export class PhaseIIICatalyst implements Catalyst {
  readonly name = 'Phase III';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('PHASE III');
  }
}
