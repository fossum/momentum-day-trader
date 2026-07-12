export interface Catalyst {
  readonly name: string;
  validate(headline: string): boolean;
}
