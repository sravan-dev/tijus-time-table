// LiteSpeed (lsnode.js) loads the configured startup file with CommonJS
// require(), which cannot load an ES module. Our server is ESM, so point the
// host's "startup file" at THIS .cjs shim instead of index.js. A `.cjs` file is
// always CommonJS (even though package.json says "type":"module"), so lsnode
// can require() it; it then dynamically imports the real ESM server, which
// listens on process.env.PORT.
import('./index.js').catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
