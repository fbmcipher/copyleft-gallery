// Source registry. Adding a source = new adapter file + one line here.
// Museums are first-class but not the only class: commons and web make the
// corpus follow the plan instead of the other way around.
import { metSource } from './met.js';
import { vamSource } from './vam.js';
import { aicSource } from './aic.js';
import { cmaSource } from './cma.js';
import { commonsSource } from './commons.js';
import { webSource } from './web.js';

export const SOURCES = {
  [metSource.key]: metSource,
  [vamSource.key]: vamSource,
  [aicSource.key]: aicSource,
  [cmaSource.key]: cmaSource,
  [commonsSource.key]: commonsSource,
  [webSource.key]: webSource,
};

export const SOURCE_KEYS = Object.keys(SOURCES);

// Some sources depend on configuration (web needs BRAVE_API_KEY).
export function availableSourceKeys() {
  return SOURCE_KEYS.filter((k) => (SOURCES[k].available ? SOURCES[k].available() : true));
}
