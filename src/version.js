// Build version, taken from this module's own URL (index.html import map adds ?v=<version>,
// see tools/bump-version.mjs). So the dashboard shows the version of the code that actually ran.
export const VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';
