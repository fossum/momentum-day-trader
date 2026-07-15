import { Catalyst } from './Catalyst';

export class AcquisitionCatalyst implements Catalyst {
  readonly name = 'Acquisition';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('ACQUISITION');
  }
}
