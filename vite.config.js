// Vite config — serves PNG plots that live OUTSIDE Note_x/ (under the project
// root, in the batch */01 Plots/ folders) at the URL prefix /data/png_plots/...
//
// The popup feature in Note_x/src/strain_popup.js fetches PNGs at e.g.:
//   /data/png_plots/batch%201%20-%20Tranverse/01%20Plots/F1_2/Figure_8_Group_1_East_Side_F1_2.png

import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  server: {
    fs: {
      // Vite by default refuses to serve files outside its root. Allow the
      // entire project root so the middleware below can reach batch folders.
      allow: [PROJECT_ROOT],
    },
  },
  plugins: [
    {
      name: 'serve-batch-png',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next();
          const m = req.url.match(/^\/data\/png_plots\/([^?#]*)/);
          if (!m) return next();
          const rel = decodeURIComponent(m[1]);
          const abs = path.join(PROJECT_ROOT, rel);
          if (!abs.startsWith(PROJECT_ROOT)) {
            res.statusCode = 403;
            return res.end('Forbidden');
          }
          fs.stat(abs, (err, stat) => {
            if (err || !stat.isFile()) {
              res.statusCode = 404;
              return res.end('Not found');
            }
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=300');
            fs.createReadStream(abs).pipe(res);
          });
        });
      },
    },
  ],
});
