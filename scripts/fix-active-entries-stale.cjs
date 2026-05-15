const fs = require('fs');
let c = fs.readFileSync('src/state/active-run-registry.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Add stale non-async check to activeRunEntries() too
c = c.replace(
    `\t\t\t// PID liveness check: async runs with dead PID are stale — don't surface them
\t\t\tif (manifest.async?.pid) {
\t\t\t\ttry { process.kill(manifest.async.pid, 0); } catch { continue; }
\t\t\t}
\t\t\tentries.push(entry);`,
    `\t\t\t// PID liveness check: async runs with dead PID are stale — don't surface them
\t\t\tif (manifest.async?.pid) {
\t\t\t\ttry { process.kill(manifest.async.pid, 0); } catch { continue; }
\t\t\t}
\t\t\t// Stale non-async run: live-session/scaffold runs older than 30 min
\t\t\tif (!manifest.async) {
\t\t\t\tconst updatedAt = typeof manifest.updatedAt === 'string' ? Date.parse(manifest.updatedAt) : NaN;
\t\t\t\tif (Number.isFinite(updatedAt) && Date.now() - updatedAt > 30 * 60 * 1000) continue;
\t\t\t}
\t\t\tentries.push(entry);`
);

// Also fix the manifest type to include updatedAt
c = c.replace(
    'const manifest = (cached?.raw ?? JSON.parse(fs.readFileSync(entry.manifestPath, "utf-8"))) as { status?: unknown; async?: { pid?: number } };',
    'const manifest = (cached?.raw ?? JSON.parse(fs.readFileSync(entry.manifestPath, "utf-8"))) as { status?: unknown; updatedAt?: string; async?: { pid?: number } };'
);

fs.writeFileSync('src/state/active-run-registry.ts', c);
console.log('Added stale non-async check to activeRunEntries');
