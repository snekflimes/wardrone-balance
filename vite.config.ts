import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import type { Plugin } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

function localBalanceDbPlugin(): Plugin {
  const dbFile = path.resolve(process.cwd(), 'balance', '.balance-db.json');
  const backupsDir = path.resolve(process.cwd(), 'balance', '.balance-backups');

  async function ensureDirs() {
    await fs.mkdir(path.dirname(dbFile), { recursive: true });
    await fs.mkdir(backupsDir, { recursive: true });
  }

  return {
    name: 'local-balance-db',
    configureServer(server) {
      server.middlewares.use('/api/storage/balance', async (req, res) => {
        try {
          await ensureDirs();
          if (req.method === 'GET') {
            try {
              const raw = await fs.readFile(dbFile, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(raw);
              return;
            } catch {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'not_found' }));
              return;
            }
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += String(chunk);
            });
            req.on('end', async () => {
              try {
                const parsed = JSON.parse(body || '{}');
                const payload = {
                  ...parsed,
                  updatedAt: new Date().toISOString(),
                };
                const encoded = JSON.stringify(payload, null, 2);
                await fs.writeFile(dbFile, encoded, 'utf-8');
                const backupFile = path.join(backupsDir, `balance-${Date.now()}.json`);
                await fs.writeFile(backupFile, encoded, 'utf-8');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              } catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'invalid_json' }));
              }
            });
            return;
          }

          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'method_not_allowed' }));
        } catch {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localBalanceDbPlugin()],
  // Чтобы приложение корректно работало при хостинге в подпапке, например https://snek.su/wardrone/
  base: '/wardrone/',
  server: {
    port: 5173
  }
});

