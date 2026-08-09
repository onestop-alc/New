import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const { runIngestion } = await import('./index.js');

const dryRun = process.argv.includes('--dry-run');
const seasonal = process.argv.includes('--seasonal');

const result = await runIngestion({ dryRun, seasonal });
if (!result) process.exit(1);
process.exit(0);
