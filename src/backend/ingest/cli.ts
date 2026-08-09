import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const { runIngestion } = await import('./index.js');

const result = await runIngestion();
if (!result) process.exit(1);
process.exit(0);
