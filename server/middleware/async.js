// Express 4 does not catch rejected promises from async route handlers: the
// rejection escapes the request entirely and, on Node 18+, takes the whole
// server process down. Every route here is async, so a single bad write (a
// stale activity id, a deleted room, a duplicate key) would stop the app for
// everyone until it was restarted.
//
// `guard` re-wraps a router's handlers so a rejection is passed to next()
// like any other error, where errorHandler turns it into a JSON response.

function wrap(entry) {
  const fn = entry.handle;
  if (typeof fn !== 'function' || fn.length > 3) return;  // error handlers take 4
  entry.handle = function wrapped(req, res, next) {
    try {
      return Promise.resolve(fn.call(this, req, res, next)).catch(next);
    } catch (e) {
      return next(e);
    }
  };
}

export function guard(router) {
  for (const layer of router.stack) {
    if (layer.route) {
      layer.route.stack.forEach(wrap);        // get/post/put/delete handlers
    } else if (layer.handle?.stack) {
      guard(layer.handle);                    // a nested router
    } else {
      wrap(layer);                            // router.use(...) middleware
    }
  }
  return router;
}

// Final middleware: log the failure and answer with JSON, never HTML — the
// client reads `error` off the body to show a toast.
export function errorHandler(err, _req, res, _next) {
  console.error('[api]', err?.sqlMessage || err?.message || err);
  if (res.headersSent) return;
  // A broken reference or duplicate is the caller's mistake, not a server fault.
  const bad = ['ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW', 'ER_ROW_IS_REFERENCED_2',
    'ER_ROW_IS_REFERENCED', 'ER_DUP_ENTRY', 'ER_BAD_NULL_ERROR', 'ER_DATA_TOO_LONG'];
  if (bad.includes(err?.code)) {
    return res.status(409).json({ error: 'That change conflicts with existing data — reload and try again' });
  }
  res.status(500).json({ error: 'Something went wrong on the server' });
}
