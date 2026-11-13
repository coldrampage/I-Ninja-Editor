// Node smoke test for the temporary module-to-window compatibility pattern.
// Browser Window globals are supplied as properties of the global object; modules
// can read and assign those existing properties while this migration bridge remains.
globalThis.__iNinjaModuleBridgeSmoke = 41;
const fixture = 'data:text/javascript,' + encodeURIComponent(
  'if (__iNinjaModuleBridgeSmoke !== 41) throw new Error("global read failed");' +
  '__iNinjaModuleBridgeSmoke = 42;'
);
await import(fixture);
if (globalThis.__iNinjaModuleBridgeSmoke !== 42) {
  throw new Error('global property setter failed');
}
delete globalThis.__iNinjaModuleBridgeSmoke;
console.log('PASS ES-module global compatibility read/write');
