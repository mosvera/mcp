/**
 * Outbound network guard for the mosvera-mcp wire fixtures.
 *
 * Preloaded (node --require) into every server process the wire suite
 * spawns. Any socket connect to a non-loopback host is refused before DNS
 * or TCP, so no test can reach a provider API, a package registry or any
 * other live service. Every refused attempt is appended to NETGUARD_LOG so
 * the suite can assert that compile-only tools make no outbound attempt.
 */
const fs = require('fs');
const net = require('net');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
const original = net.Socket.prototype.connect;

net.Socket.prototype.connect = function guardedConnect(...args) {
  let opts = args[0];
  if (Array.isArray(opts)) [opts] = opts;
  let host;
  let port;
  if (opts && typeof opts === 'object') {
    if (opts.path) return original.apply(this, args);
    host = opts.host;
    port = opts.port;
  } else if (typeof opts === 'number' || /^\d+$/.test(String(opts))) {
    port = opts;
    host = typeof args[1] === 'string' ? args[1] : undefined;
  } else {
    // IPC path
    return original.apply(this, args);
  }
  const target = host || 'localhost';
  if (!LOOPBACK.has(target)) {
    if (process.env.NETGUARD_LOG) {
      fs.appendFileSync(process.env.NETGUARD_LOG, `${target}:${port}\n`);
    }
    const err = new Error(`net-guard: blocked outbound connect to ${target}:${port}`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return original.apply(this, args);
};
