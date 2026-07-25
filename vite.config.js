import { defineConfig } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Route 127 owns the port. It injects PORT into the process environment and
// also substitutes {port} in the launch command, so we simply honour PORT and
// never bind anything but loopback. See AGENTS.md.

/**
 * Dev-only capture endpoint. The game POSTs a canvas data URL to /__shot and we
 * write the PNG to disk, which is how the visual checks in AGENTS.md are taken
 * without a compositing browser window. Never present in a build.
 */
function screenshotEndpoint() {
  return {
    name: 'santa-screenshot-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { name, data } = JSON.parse(body);
            const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
            const out = resolve(process.cwd(), 'shots', safe.endsWith('.png') ? safe : safe + '.png');
            mkdirSync(dirname(out), { recursive: true });
            writeFileSync(out, Buffer.from(String(data).split(',')[1], 'base64'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: out }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [screenshotEndpoint()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
