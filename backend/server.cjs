// CommonJS wrapper for Hostinger LiteSpeed lsnode.js, which loads the entry
// file via require() and can't `require()` ES Modules directly. The actual
// server is in server.js (ESM); we dynamically import() it here so the file
// lsnode.js sees is CommonJS-loadable. server.js then calls app.listen(PORT)
// itself, so lsnode.js doesn't need to do anything with our return value.
//
// Why this exists: with "type":"module" on backend/package.json, server.js
// is ESM. Hostinger's bridge does `require(entryFile)` which throws
// ERR_REQUIRE_ESM on ESM entry points. The .cjs extension forces this file
// to be CommonJS regardless of the surrounding package.json.

import("./server.js").catch((err) => {
  console.error("[server.cjs] failed to import server.js:", err);
  process.exit(1);
});
