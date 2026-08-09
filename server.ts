import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import cron from 'node-cron';
import { runIngestion } from './src/backend/ingest/index.js';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = 3000;

// Setup Database Pool for API
let pool: Pool | null = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// --- API Routes ---

app.get('/api/stories', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { rows } = await pool.query(`
      SELECT id, display_title, provinces, deaths, injuries, source_count, first_published, created_at 
      FROM stories
      ORDER BY first_published DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stories/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not configured' });
  try {
    const storyId = req.params.id;
    const storyRes = await pool.query('SELECT * FROM stories WHERE id = $1', [storyId]);
    if (storyRes.rows.length === 0) return res.status(404).json({ error: 'Story not found' });
    
    const articlesRes = await pool.query('SELECT * FROM articles WHERE story_id = $1 ORDER BY published ASC', [storyId]);
    
    res.json({
      ...storyRes.rows[0],
      articles: articlesRes.rows
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
