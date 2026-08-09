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
  // Ingestion runs in Supabase (Edge Function + pg_cron every 30 minutes), so
  // the dev server does NOT schedule it: two schedulers would double the feed
  // traffic and race each other. Set LOCAL_INGEST_CRON=1 to run it here
  // instead — e.g. while the cloud function is being reworked.
  const canIngest = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (process.env.LOCAL_INGEST_CRON === '1' && canIngest) {
    console.log('LOCAL_INGEST_CRON=1: running ingestion locally every 30 minutes.');
    cron.schedule('*/30 * * * *', () => {
      runIngestion().catch(console.error);
    });
    setTimeout(() => {
      runIngestion().catch(console.error);
    }, 5000);
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
