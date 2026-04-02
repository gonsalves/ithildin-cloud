import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath: process.env.DATABASE_PATH || './data/ithildin.db',
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),

  get vaultsDir() {
    return path.join(this.dataDir, 'vaults');
  },
};

// Validate required config in production
if (config.nodeEnv === 'production') {
  if (!config.encryptionKey) throw new Error('ENCRYPTION_KEY is required');
  if (config.sessionSecret === 'dev-secret-change-me') {
    throw new Error('SESSION_SECRET must be set in production');
  }
}
