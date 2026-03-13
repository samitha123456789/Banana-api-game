require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const https = require('https');
const { connectToDatabase } = require('./db');
const jwt = require('jsonwebtoken');
const {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_EXPIRES_IN
} = require('./auth');
const { sendEmail, buildGameOTPEmail } = require('./email');

const app = express();
const PORT = process.env.PORT || 3000;

// Cookie options for auth tokens (HttpOnly, SameSite; Secure in production)
const COOKIE_ACCESS_MAX_AGE = 15 * 60; // 15 minutes in seconds
const COOKIE_REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/'
};

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: COOKIE_ACCESS_MAX_AGE * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: COOKIE_REFRESH_MAX_AGE * 1000 });
}

function clearAuthCookies(res) {
  res.cookie('accessToken', '', { ...cookieOptions, maxAge: 0 });
  res.cookie('refreshToken', '', { ...cookieOptions, maxAge: 0 });
}

// Root of the project (one level up from server/)
const projectRoot = path.join(__dirname, '..');

app.use(express.json());
app.use(cookieParser());

// Serve static assets from separate folders
app.use('/js', express.static(path.join(projectRoot, 'js')));
app.use('/css', express.static(path.join(projectRoot, 'css')));

// Serve HTML pages
app.get('/', function (req, res) {
  res.sendFile(path.join(projectRoot, 'html', 'index.html'));
});
app.get('/reset-password.html', function (req, res) {
  res.sendFile(path.join(projectRoot, 'html', 'reset-password.html'));
});
app.get('/admin.html', function (req, res) {
  res.sendFile(path.join(projectRoot, 'html', 'admin.html'));
});

// Simple health-check route that verifies MongoDB connectivity
app.get('/api/health', async (req, res) => {
  try {
    const db = await connectToDatabase();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', mongo: 'connected' });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'error', mongo: 'disconnected' });
  }
});

// Example route: list databases (for debugging, not for production use)
app.get('/api/databases', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const admin = db.admin();
    const dbs = await admin.listDatabases();
    res.json(dbs);
  } catch (err) {
    console.error('Failed to list databases:', err);
    res.status(500).json({ error: 'Failed to list databases' });
  }
});

// Fetch a fresh Banana puzzle (proxy to external Banana Game API)
app.get('/api/banana-question', async (req, res) => {
  const apiUrl = process.env.BANANA_API_URL;

  https.get(apiUrl, (apiRes) => {
    let raw = '';
    apiRes.on('data', (chunk) => {
      raw += chunk;
    });
    apiRes.on('end', () => {
      try {
        const data = JSON.parse(raw);
        // Expect { question: <imageUrl>, solution: <number> }
        if (!data || !data.question || typeof data.solution === 'undefined') {
          return res.status(502).json({ error: 'Unexpected response from Banana API.' });
        }
        res.json(data);
      } catch (err) {
        console.error('Banana API parse error:', err);
        res.status(502).json({ error: 'Failed to parse Banana API response.' });
      }
    });
  }).on('error', (err) => {
    console.error('Banana API request failed:', err);
    res.status(502).json({ error: 'Failed to reach Banana API.' });
  });
});

// Fetch a fresh Tomato puzzle (proxy to external Tomato API)
// Default URL points to the public Tomato puzzle API documented at:
// https://marcconrad.com/uob/tomato/api.php
app.get('/api/tomato-question', async (req, res) => {
  const apiUrl = process.env.TOMATO_API_URL || 'https://marcconrad.com/uob/tomato/api.php';

  https.get(apiUrl, (apiRes) => {
    let raw = '';
    apiRes.on('data', (chunk) => {
      raw += chunk;
    });
    apiRes.on('end', () => {
      try {
        const data = JSON.parse(raw);
        // Expect { question: <imageUrl>, solution: <number> } similar to Banana API
        if (!data || !data.question || typeof data.solution === 'undefined') {
          return res.status(502).json({ error: 'Unexpected response from Tomato API.' });
        }
        res.json(data);
      } catch (err) {
        console.error('Tomato API parse error:', err);
        res.status(502).json({ error: 'Failed to parse Tomato API response.' });
      }
    });
  }).on('error', (err) => {
    console.error('Tomato API request failed:', err);
    res.status(502).json({ error: 'Failed to reach Tomato API.' });
  });
});

// ========== AUTH & USER STORAGE (MongoDB-backed) ==========

/** Build user payload (no password). */
function toUserPayload(doc) {
  const payload = {
    username: doc.username,
    email: doc.email || '',
    highScore: doc.highScore || 0,
    totalGames: doc.totalGames || 0,
    wins: doc.wins || 0,
    achievements: Array.isArray(doc.achievements) ? doc.achievements : []
  };
  if (doc.role === 'admin') payload.isAdmin = true;
  if (doc.banned) payload.banned = true;
  return payload;
}

/** Issue access + refresh tokens and persist refresh token in DB. */
async function issueTokens(db, username) {
  const accessToken = signAccessToken({ username });
  const refreshToken = signRefreshToken({ username });
  const refreshTokens = db.collection('refresh_tokens');
  const decoded = jwt.decode(refreshToken);
  const expiresAt = decoded && decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await refreshTokens.insertOne({ username, token: refreshToken, expiresAt });
  return { accessToken, refreshToken, expiresIn: ACCESS_EXPIRES_IN };
}

/** Auth middleware: require valid token from cookie or Bearer header, set req.user = { username }. */
async function requireAuth(req, res, next) {
  const token = req.cookies?.accessToken || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { username: payload.username };
    const db = await connectToDatabase();
    const userDoc = await db.collection('users').findOne({ username: payload.username });
    if (userDoc && userDoc.banned) {
      return res.status(403).json({ error: 'Account is banned.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/** Admin-only middleware: must be used after requireAuth. */
async function requireAdmin(req, res, next) {
  try {
    const db = await connectToDatabase();
    const userDoc = await db.collection('users').findOne({ username: req.user.username });
    if (!userDoc || userDoc.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify admin.' });
  }
}

const crypto = require('crypto');

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function generateOTP() {
  return String(crypto.randomInt(100000, 999999));
}

/** Validate strong password: min 8 chars, uppercase, lowercase, number, symbol. */
function isStrongPassword(password) {
  if (!password || typeof password !== 'string' || password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

// Signup step 1: send OTP to email
app.post('/api/signup/send-otp', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    const normalizedUsername = (username || '').trim().toLowerCase();
    const trimmedEmail = (email || '').trim();

    if (!normalizedUsername || normalizedUsername.length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters.' });
    }
    if (!trimmedEmail) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');
    const pending = db.collection('pending_signups');

    const existingByUsername = await users.findOne({ username: normalizedUsername });
    if (existingByUsername) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }
    const existingByEmail = await users.findOne({ email: new RegExp('^' + trimmedEmail + '$', 'i') });
    if (existingByEmail) {
      return res.status(409).json({ error: 'Email is already in use.' });
    }

    const otp = generateOTP();
    const hashedPassword = await hashPassword(password);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await pending.deleteMany({ email: new RegExp('^' + trimmedEmail + '$', 'i'), username: normalizedUsername });
    await pending.insertOne({
      email: trimmedEmail,
      username: normalizedUsername,
      password: hashedPassword,
      otp,
      expiresAt
    });

    const signupMail = buildGameOTPEmail(otp, 'signup');
    const emailSent = await sendEmail(trimmedEmail, signupMail.subject, signupMail.text, signupMail.html);

    if (!emailSent) {
      return res.status(503).json({ error: 'Unable to send email. Please try again later or check email configuration.' });
    }

    res.json({ message: 'OTP sent to your email. Check your inbox.' });
  } catch (err) {
    console.error('Signup send-otp failed:', err);
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// Signup step 2: verify OTP and create account
app.post('/api/signup/verify-otp', async (req, res) => {
  try {
    const { username, email, otp } = req.body || {};

    const normalizedUsername = (username || '').trim().toLowerCase();
    const trimmedEmail = (email || '').trim();
    const otpStr = String(otp || '').trim();

    if (!normalizedUsername || !trimmedEmail || !otpStr) {
      return res.status(400).json({ error: 'Username, email and OTP are required.' });
    }

    const db = await connectToDatabase();
    const pending = db.collection('pending_signups');
    const users = db.collection('users');

    const pendingDoc = await pending.findOne({
      email: new RegExp('^' + trimmedEmail + '$', 'i'),
      username: normalizedUsername
    });

    if (!pendingDoc) {
      return res.status(400).json({ error: 'No signup request found. Please request a new OTP.' });
    }
    if (new Date() > new Date(pendingDoc.expiresAt)) {
      await pending.deleteOne({ _id: pendingDoc._id });
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    if (pendingDoc.otp !== otpStr) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    const userDoc = {
      username: pendingDoc.username,
      email: pendingDoc.email,
      password: pendingDoc.password,
      highScore: 0,
      totalGames: 0,
      wins: 0,
      achievements: []
    };

    await users.insertOne(userDoc);
    await pending.deleteOne({ _id: pendingDoc._id });

    const tokens = await issueTokens(db, userDoc.username);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    res.status(201).json(toUserPayload(userDoc));
  } catch (err) {
    console.error('Signup verify-otp failed:', err);
    res.status(500).json({ error: 'Failed to complete signup.' });
  }
});

// Legacy: direct signup without OTP (kept for compatibility)
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    const normalizedUsername = (username || '').trim().toLowerCase();
    const trimmedEmail = (email || '').trim();

    if (!normalizedUsername || normalizedUsername.length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters.' });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');

    const existingByUsername = await users.findOne({ username: normalizedUsername });
    if (existingByUsername) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    if (trimmedEmail) {
      const existingByEmail = await users.findOne({ email: new RegExp('^' + trimmedEmail + '$', 'i') });
      if (existingByEmail) {
        return res.status(409).json({ error: 'Email is already in use.' });
      }
    }

    const hashedPassword = await hashPassword(password);
    const userDoc = {
      username: normalizedUsername,
      email: trimmedEmail,
      password: hashedPassword,
      highScore: 0,
      totalGames: 0,
      wins: 0,
      achievements: []
    };

    await users.insertOne(userDoc);
    const tokens = await issueTokens(db, userDoc.username);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    res.status(201).json(toUserPayload(userDoc));
  } catch (err) {
    console.error('Signup failed:', err);
    res.status(500).json({ error: 'Failed to sign up.' });
  }
});

// Log in (verify password, return JWT + refresh token)
app.post('/api/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body || {};

    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: 'Username or email and password are required.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');

    const input = usernameOrEmail.trim();
    const userDoc = await users.findOne({
      $or: [
        { username: input.toLowerCase() },
        { email: new RegExp('^' + input + '$', 'i') }
      ]
    });

    if (!userDoc) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (userDoc.banned) {
      return res.status(403).json({ error: 'Account is banned. Contact support.' });
    }

    const isLegacyPlainPassword = !userDoc.password.startsWith('$2');
    const passwordValid = isLegacyPlainPassword
      ? userDoc.password === password
      : await comparePassword(password, userDoc.password);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const tokens = await issueTokens(db, userDoc.username);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    res.json(toUserPayload(userDoc));
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

// Refresh access token using refresh token (from cookie or body)
app.post('/api/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || (req.body && req.body.refreshToken);
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    const payload = verifyRefreshToken(refreshToken);
    const username = payload.username;

    const db = await connectToDatabase();
    const refreshTokens = db.collection('refresh_tokens');
    const stored = await refreshTokens.findOne({ username, token: refreshToken });
    if (!stored) {
      return res.status(401).json({ error: 'Invalid or revoked refresh token.' });
    }
    if (new Date() > new Date(stored.expiresAt)) {
      await refreshTokens.deleteOne({ token: refreshToken });
      return res.status(401).json({ error: 'Refresh token expired.' });
    }

    await refreshTokens.deleteOne({ token: refreshToken });
    const tokens = await issueTokens(db, username);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    const users = db.collection('users');
    const userDoc = await users.findOne({ username });
    const userPayload = userDoc ? toUserPayload(userDoc) : { username, email: '', highScore: 0, totalGames: 0, wins: 0, achievements: [] };

    res.json(userPayload);
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }
    console.error('Refresh failed:', err);
    res.status(500).json({ error: 'Failed to refresh token.' });
  }
});

// Get current user from auth cookie (for session restore)
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const users = db.collection('users');
    const userDoc = await users.findOne({ username: req.user.username });
    if (!userDoc) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(toUserPayload(userDoc));
  } catch (err) {
    console.error('Get me failed:', err);
    res.status(500).json({ error: 'Failed to load user.' });
  }
});

// Logout: clear auth cookies
app.post('/api/logout', function (req, res) {
  clearAuthCookies(res);
  res.json({ message: 'Logged out.' });
});

// Forgot password: send OTP only (no link)
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    const trimmedEmail = (email || '').trim();
    if (!trimmedEmail) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');
    const userDoc = await users.findOne({ email: new RegExp('^' + trimmedEmail + '$', 'i') });

    if (!userDoc) {
      return res.json({ message: 'If an account exists with this email, you will receive an OTP.' });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await users.updateOne(
      { username: userDoc.username },
      {
        $set: { passwordResetOtp: otp, passwordResetOtpExpires: expiresAt },
        $unset: { passwordResetToken: '', passwordResetExpires: '' }
      }
    );

    const resetMail = buildGameOTPEmail(otp, 'password_reset');
    if (process.env.NODE_ENV !== 'production') {
      console.log('Forgot password: sending OTP only (no link) to', userDoc.email);
    }
    const emailSent = await sendEmail(userDoc.email, resetMail.subject, resetMail.text, resetMail.html);

    if (!emailSent) {
      return res.status(503).json({ error: 'Unable to send email. Please try again later.' });
    }

    res.json({ message: 'If an account exists with this email, you will receive an OTP.' });
  } catch (err) {
    console.error('Forgot password failed:', err);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

// Reset password using email + OTP (no link)
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    const trimmedEmail = (email || '').trim();
    const otpStr = String(otp || '').trim();

    if (!trimmedEmail || !otpStr || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP and new password are required.' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');

    const userDoc = await users.findOne({
      email: new RegExp('^' + trimmedEmail + '$', 'i'),
      passwordResetOtp: otpStr,
      passwordResetOtpExpires: { $gt: new Date() }
    });

    if (!userDoc) {
      return res.status(400).json({ error: 'Invalid or expired OTP. Request a new one if needed.' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await users.updateOne(
      { username: userDoc.username },
      {
        $set: { password: hashedPassword },
        $unset: { passwordResetOtp: '', passwordResetOtpExpires: '' }
      }
    );

    res.json({ message: 'Password has been reset. You can log in with your new password.' });
  } catch (err) {
    console.error('Reset password failed:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// Get a single user by username (requires auth, own profile only)
app.get('/api/users/:username', requireAuth, async (req, res) => {
  try {
    const usernameParam = (req.params.username || '').toLowerCase();
    if (!usernameParam) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (req.user.username !== usernameParam) {
      return res.status(403).json({ error: 'You can only view your own profile.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');
    const userDoc = await users.findOne({ username: usernameParam });

    if (!userDoc) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json(toUserPayload(userDoc));
  } catch (err) {
    console.error('Get user failed:', err);
    res.status(500).json({ error: 'Failed to load user.' });
  }
});

// Update a user's profile: username and/or game stats (requires auth, own profile only)
app.put('/api/users/:username', requireAuth, async (req, res) => {
  try {
    const usernameParam = (req.params.username || '').toLowerCase();
    if (!usernameParam) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (req.user.username !== usernameParam) {
      return res.status(403).json({ error: 'You can only update your own profile.' });
    }

    const body = req.body || {};
    const db = await connectToDatabase();
    const users = db.collection('users');

    // Username change: validate, update doc, re-issue tokens
    const newUsername = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (newUsername && newUsername !== usernameParam) {
      if (newUsername.length < 2) {
        return res.status(400).json({ error: 'Username must be at least 2 characters.' });
      }
      const existing = await users.findOne({ username: newUsername });
      if (existing) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      const updateResult = await users.updateOne(
        { username: usernameParam },
        { $set: { username: newUsername } }
      );
      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const refreshTokens = db.collection('refresh_tokens');
      await refreshTokens.deleteMany({ username: usernameParam });
      const tokens = await issueTokens(db, newUsername);
      setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
      const userDoc = await users.findOne({ username: newUsername });
      return res.json(toUserPayload(userDoc));
    }

    // Stats/achievements update (existing behaviour)
    const updateFields = {
      highScore: body.highScore ?? 0,
      totalGames: body.totalGames ?? 0,
      wins: body.wins ?? 0,
      achievements: Array.isArray(body.achievements) ? body.achievements : []
    };
    if (body.email !== undefined) updateFields.email = body.email;

    const result = await users.updateOne(
      { username: usernameParam },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const userDoc = await users.findOne({ username: usernameParam });
    res.json(toUserPayload(userDoc));
  } catch (err) {
    console.error('Update user failed:', err);
    res.status(500).json({ error: 'Failed to save user.' });
  }
});

// Leaderboard: top 10 users by high score (exclude banned and admins)
app.get('/api/leaderboard', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const users = db.collection('users');

    const top = await users
      .find(
        { banned: { $ne: true }, role: { $ne: 'admin' } },
        { projection: { _id: 0, username: 1, highScore: 1 } }
      )
      .sort({ highScore: -1 })
      .limit(10)
      .toArray();

    res.json(top);
  } catch (err) {
    console.error('Leaderboard failed:', err);
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

// ========== GAME CONFIG (public: used by frontend) ==========
const DEFAULT_GAME_CONFIG = {
  easy: { label: 'Easy', time: 90, retries: 6, rounds: 5, pointsBase: 100, bonusPerSecond: 2, class: 'easy' },
  medium: { label: 'Medium', time: 60, retries: 4, rounds: 10, pointsBase: 150, bonusPerSecond: 3, class: 'medium' },
  hard: { label: 'Hard', time: 30, retries: 2, rounds: 15, pointsBase: 200, bonusPerSecond: 5, class: 'hard' }
};

app.get('/api/game-config', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const settings = db.collection('game_settings');
    const doc = await settings.findOne({ _id: 'difficulty' });
    const config = doc && doc.levels ? doc.levels : DEFAULT_GAME_CONFIG;
    res.json(config);
  } catch (err) {
    console.error('Game config failed:', err);
    res.status(500).json({ error: 'Failed to load game config.' });
  }
});

// ========== ADMIN ROUTES ==========

/** Ensure admin user exists (from .env ADMIN_EMAIL / ADMIN_PASSWORD). */
async function ensureAdminUser(db) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;
  const users = db.collection('users');
  const existing = await users.findOne({ $or: [ { email: new RegExp('^' + adminEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }, { username: 'admin' } ] });
  if (existing) {
    if (existing.role !== 'admin') {
      await users.updateOne({ _id: existing._id }, { $set: { role: 'admin' } });
    }
    return;
  }
  const hashedPassword = await hashPassword(adminPassword);
  await users.insertOne({
    username: 'admin',
    email: adminEmail,
    password: hashedPassword,
    highScore: 0,
    totalGames: 0,
    wins: 0,
    achievements: [],
    role: 'admin'
  });
  console.log('Admin user ensured (email: ' + adminEmail + ')');
}

// List all users (admin only; exclude password)
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const users = db.collection('users');
    const list = await users
      .find({}, { projection: { password: 0 } })
      .sort({ username: 1 })
      .toArray();
    res.json(list.map(doc => ({ ...toUserPayload(doc), banned: !!doc.banned, role: doc.role || null })));
  } catch (err) {
    console.error('Admin list users failed:', err);
    res.status(500).json({ error: 'Failed to list users.' });
  }
});

// Get one user (admin only)
app.get('/api/admin/users/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = (req.params.username || '').toLowerCase();
    if (!username) return res.status(400).json({ error: 'Username required.' });
    const db = await connectToDatabase();
    const userDoc = await db.collection('users').findOne({ username }, { projection: { password: 0 } });
    if (!userDoc) return res.status(404).json({ error: 'User not found.' });
    res.json({ ...toUserPayload(userDoc), banned: !!userDoc.banned, role: userDoc.role || null });
  } catch (err) {
    console.error('Admin get user failed:', err);
    res.status(500).json({ error: 'Failed to load user.' });
  }
});

// Update user (admin only): edit fields or ban/unban
app.put('/api/admin/users/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = (req.params.username || '').toLowerCase();
    if (!username) return res.status(400).json({ error: 'Username required.' });
    if (username === 'admin') return res.status(400).json({ error: 'Cannot modify admin user.' });
    const body = req.body || {};
    const db = await connectToDatabase();
    const users = db.collection('users');
    const updateFields = {};
    if (typeof body.banned === 'boolean') updateFields.banned = body.banned;
    if (typeof body.highScore === 'number') updateFields.highScore = body.highScore;
    if (typeof body.totalGames === 'number') updateFields.totalGames = body.totalGames;
    if (typeof body.wins === 'number') updateFields.wins = body.wins;
    if (Array.isArray(body.achievements)) updateFields.achievements = body.achievements;
    if (typeof body.email === 'string') updateFields.email = body.email.trim();
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }
    const result = await users.updateOne({ username }, { $set: updateFields });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found.' });
    const userDoc = await users.findOne({ username }, { projection: { password: 0 } });
    res.json({ ...toUserPayload(userDoc), banned: !!userDoc.banned, role: userDoc.role || null });
  } catch (err) {
    console.error('Admin update user failed:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// Delete user (admin only); cannot delete admin
app.delete('/api/admin/users/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = (req.params.username || '').toLowerCase();
    if (!username) return res.status(400).json({ error: 'Username required.' });
    const db = await connectToDatabase();
    const users = db.collection('users');
    const userDoc = await users.findOne({ username }, { projection: { role: 1 } });
    if (!userDoc) return res.status(404).json({ error: 'User not found.' });
    if (userDoc.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin user.' });
    await db.collection('refresh_tokens').deleteMany({ username });
    await users.deleteOne({ username });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('Admin delete user failed:', err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// Get game config (admin view)
app.get('/api/admin/game-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const settings = db.collection('game_settings');
    const doc = await settings.findOne({ _id: 'difficulty' });
    const config = doc && doc.levels ? doc.levels : DEFAULT_GAME_CONFIG;
    res.json(config);
  } catch (err) {
    console.error('Admin get game config failed:', err);
    res.status(500).json({ error: 'Failed to load game config.' });
  }
});

// Update game config (admin only)
app.put('/api/admin/game-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const levels = body.easy && body.medium && body.hard ? body : null;
    if (!levels) return res.status(400).json({ error: 'Send easy, medium, hard objects with time, retries, rounds, pointsBase, bonusPerSecond.' });
    const normalize = (key, def) => {
      const o = levels[key] || def;
      return {
        label: o.label || def.label,
        time: Math.max(5, Math.min(300, Number(o.time) || def.time)),
        retries: Math.max(1, Math.min(20, Number(o.retries) || def.retries)),
        rounds: Math.max(1, Math.min(50, Number(o.rounds) || def.rounds)),
        pointsBase: Math.max(0, Number(o.pointsBase) ?? def.pointsBase),
        bonusPerSecond: Math.max(0, Number(o.bonusPerSecond) ?? def.bonusPerSecond),
        class: o.class || def.class
      };
    };
    const config = {
      easy: normalize('easy', DEFAULT_GAME_CONFIG.easy),
      medium: normalize('medium', DEFAULT_GAME_CONFIG.medium),
      hard: normalize('hard', DEFAULT_GAME_CONFIG.hard)
    };
    const db = await connectToDatabase();
    const settings = db.collection('game_settings');
    await settings.updateOne(
      { _id: 'difficulty' },
      { $set: { levels: config, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json(config);
  } catch (err) {
    console.error('Admin update game config failed:', err);
    res.status(500).json({ error: 'Failed to update game config.' });
  }
});

// Admin dashboard stats
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = await connectToDatabase();
    const users = db.collection('users');
    const totalUsers = await users.countDocuments({});
    const bannedCount = await users.countDocuments({ banned: true });
    const totalGames = await users.aggregate([ { $group: { _id: null, sum: { $sum: '$totalGames' } } } ]).toArray();
    const totalWins = await users.aggregate([ { $group: { _id: null, sum: { $sum: '$wins' } } } ]).toArray();
    const topScore = await users.find({ banned: { $ne: true }, role: { $ne: 'admin' } }).sort({ highScore: -1 }).limit(1).toArray();
    res.json({
      totalUsers,
      bannedCount,
      totalGames: (totalGames[0] && totalGames[0].sum) || 0,
      totalWins: (totalWins[0] && totalWins[0].sum) || 0,
      topScore: (topScore[0] && topScore[0].highScore) || 0
    });
  } catch (err) {
    console.error('Admin stats failed:', err);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// 404 for unmatched API routes (so wrong server or path returns JSON)
app.use('/api', function (req, res) {
  res.status(404).json({ error: 'Not found', path: req.method + ' ' + req.path });
});

app.listen(PORT, async () => {
  try {
    const db = await connectToDatabase();
    await ensureAdminUser(db);
  } catch (err) {
    console.error('Failed to connect to MongoDB on startup:', err);
  }
  console.log(`Banana Challenge Arena server running at http://localhost:${PORT}`);
  console.log('API routes: /api/health, /api/me, /api/game-config, /api/login, /admin.html ...');
});
