import { Catalyst } from './Catalyst';

export class FDACatalyst implements Catalyst {
  readonly name = 'FDA';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('FDA');
  }
}
