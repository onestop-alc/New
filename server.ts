import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';
import { runIngestion } from './src/backend/ingest/index.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = 3000;

// --- Vite Middleware ---
async function startServer() {
  // Start the background cron job (runs every 30 mins).
  // Writing needs either a direct Postgres URL or the Supabase service_role key.
  const canIngest = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (canIngest) {
    cron.schedule('*/30 * * * *', () => {
      runIngestion().catch(console.error);
    });
    // Run once on startup
    setTimeout(() => {
      runIngestion().catch(console.error);
    }, 5000);
  } else {
    console.warn("WARNING: no DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Ingestion is disabled.");
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
