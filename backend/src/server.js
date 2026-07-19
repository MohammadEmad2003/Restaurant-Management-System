import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { syncEngine } from './sync/syncEngine.js';
import { ensureSeeded } from './seed/seed.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
if (config.env !== 'test') app.use(morgan('dev'));

// Health + meta
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  mode: config.persistenceMode,
  sync: syncEngine.status(),
  time: Date.now(),
}));

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

async function start() {
  // Seed mock data on first run so the system shows results immediately.
  await ensureSeeded();

  // Boot the offline-first sync engine (no-op until Firebase configured).
  syncEngine.start();

  const server = app.listen(config.port, () => {
    logger.success(`Backend listening on http://localhost:${config.port}  (mode: ${config.persistenceMode})`);
    logger.info('API base: http://localhost:' + config.port + '/api');
    logger.info('Login as admin/admin123 or cashier/cashier123 (seeded).');
  });

  // Clear, non-crashing message when the port is already taken (another server still running).
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use — another instance is still running.`);
      logger.info(`Free it first:  Linux/WSL: "fuser -k ${config.port}/tcp"  ·  Windows: "netstat -ano | findstr :${config.port}" then "taskkill /PID <pid> /F"`);
      logger.info(`Or run on a different port:  PORT=4001 npm run dev`);
      process.exit(1);
    }
    logger.error(`Server error: ${err.stack || err.message}`);
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error(`Fatal: ${err.stack || err.message}`);
  process.exit(1);
});

export default app;
