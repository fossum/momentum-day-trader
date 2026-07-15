/**
 * Ross Cameron Momentum Pattern Detection Hook Wrapper
 *
 * For backwards compatibility, this module re-exports all momentum logic
 * from the modular library in src/lib/momentum.
 */

export * from '../lib/momentum';

import { ALL_CATALYSTS } from '../lib/momentum';

// Derived dynamically from modular catalysts for backwards compatibility
export const CATALYST_KEYWORDS = ALL_CATALYSTS.map(c => c.name);
