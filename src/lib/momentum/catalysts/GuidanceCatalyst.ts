import { Catalyst } from './Catalyst';

export class GuidanceCatalyst implements Catalyst {
  readonly name = 'Guidance';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('GUIDANCE');
  }
}
