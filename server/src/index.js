import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { router } from './routes/api.js';
import { gtRouter } from './routes/groundTruth.js';
import { requireToken } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', requireToken);
app.use('/api/gt', gtRouter);
app.use('/api', router);
app.use('/api', notFound);

// Serve the built client when present (npm run build).
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}
app.use(errorHandler);

app.listen(config.port, () => console.log(`Relevancy Evaluator API on http://localhost:${config.port}`));
