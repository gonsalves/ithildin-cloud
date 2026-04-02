import express from 'express';
import session from 'express-session';
import ConnectSQLite from 'connect-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authRoutes } from './auth/routes.js';
import { webRoutes } from './web/routes.js';
import { Manager } from './orchestrator/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'web', 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'static')));

// Sessions
const SQLiteStore = ConnectSQLite(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: config.dataDir }) as session.Store,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Orchestrator
const manager = new Manager();
app.locals.manager = manager;

// Routes
app.use(authRoutes);
app.use(webRoutes);

// Start
app.listen(config.port, async () => {
  console.log(`Ithildin running at http://localhost:${config.port}`);

  // Start orchestrator (provisions all enabled users)
  try {
    await manager.start();
  } catch (err) {
    console.error('Failed to start orchestrator:', err);
  }
});

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received. Shutting down...`);
    manager.stop();
    process.exit(0);
  });
}
