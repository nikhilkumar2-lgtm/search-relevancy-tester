import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

export const config = {
  debug: process.env.DEBUG_REQUESTS !== 'false',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  port: Number(process.env.PORT) || 4000,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
  accessToken: process.env.ACCESS_TOKEN || '',
  dataDir: path.resolve(root, process.env.DATA_DIR || 'data'),
  clientDist: path.join(root, 'client', 'dist'),
  // Service account: path to JSON key file, or the JSON itself (optionally base64).
  googleKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
  googleCredentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
};
