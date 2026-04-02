import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const router = Router();
const SALT_ROUNDS = 12;

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('signup', { error: null });
});

router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('signup', { error: 'Email and password are required.' });
  }

  if (password.length < 8) {
    return res.render('signup', { error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (existing) {
      return res.render('signup', { error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.insert(schema.users).values({ email, passwordHash }).run();
    const userId = Number(result.lastInsertRowid);

    // Create default config
    db.insert(schema.userConfigs).values({ userId }).run();

    req.session.userId = userId;
    req.session.email = email;
    res.redirect('/settings');
  } catch (err) {
    console.error('Signup error:', err);
    res.render('signup', { error: 'Something went wrong. Please try again.' });
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Email and password are required.' });
  }

  try {
    const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (!user) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.render('login', { error: 'Invalid email or password.' });
    }

    req.session.userId = user.id;
    req.session.email = user.email;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Something went wrong. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export { router as authRoutes };
