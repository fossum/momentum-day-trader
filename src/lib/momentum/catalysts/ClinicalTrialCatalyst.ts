import { Catalyst } from './Catalyst';

export class ClinicalTrialCatalyst implements Catalyst {
  readonly name = 'Clinical Trial';
  validate(headline: string): boolean {
    return headline.toUpperCase().includes('CLINICAL TRIAL');
  }
}
