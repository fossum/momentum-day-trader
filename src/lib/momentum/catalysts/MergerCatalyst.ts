import { Catalyst } from './Catalyst';

export class MergerCatalyst implements Catalyst {
  readonly name = 'Merger';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('MERGER');
  }
}
