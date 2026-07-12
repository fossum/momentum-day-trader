import { Catalyst } from './Catalyst';

export class PatentCatalyst implements Catalyst {
  readonly name = 'Patent';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('PATENT');
  }
}
