require('dotenv').config();
const express = require('express');
const path = require('path');
const { connectToDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve the front-end files from the project root
app.use(express.static(__dirname));

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

// ========== AUTH & USER STORAGE (MongoDB-backed) ==========

// Sign up a new user
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    const normalizedUsername = (username || '').trim().toLowerCase();
    const trimmedEmail = (email || '').trim();

    if (!normalizedUsername || normalizedUsername.length < 2) {
      return res.status(400).json({ error: 'Username must be at least 2 characters.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
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

    const userDoc = {
      username: normalizedUsername,
      email: trimmedEmail,
      password,
      highScore: 0,
      totalGames: 0,
      wins: 0,
      achievements: []
    };

    await users.insertOne(userDoc);

    res.status(201).json({
      username: userDoc.username,
      email: userDoc.email,
      highScore: userDoc.highScore,
      totalGames: userDoc.totalGames,
      wins: userDoc.wins,
      achievements: userDoc.achievements
    });
  } catch (err) {
    console.error('Signup failed:', err);
    res.status(500).json({ error: 'Failed to sign up.' });
  }
});

// Log in an existing user, or create a "guest" user if none exists (matches front-end behaviour)
app.post('/api/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body || {};

    if (!usernameOrEmail) {
      return res.status(400).json({ error: 'Username or email is required.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');

    const input = usernameOrEmail.trim();
    const isEmail = input.indexOf('@') !== -1;

    let userDoc = await users.findOne({
      $or: [
        { username: input.toLowerCase() },
        { email: new RegExp('^' + input + '$', 'i') }
      ]
    });

    if (!userDoc) {
      const guestName = (isEmail ? input.split('@')[0] : input).toLowerCase();
      const guestEmail = isEmail ? input : guestName + '@bananaquest.game';

      userDoc = {
        username: guestName,
        email: guestEmail,
        password,
        highScore: 0,
        totalGames: 0,
        wins: 0,
        achievements: []
      };

      await users.insertOne(userDoc);
    } else if (userDoc.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    res.json({
      username: userDoc.username,
      email: userDoc.email,
      highScore: userDoc.highScore || 0,
      totalGames: userDoc.totalGames || 0,
      wins: userDoc.wins || 0,
      achievements: userDoc.achievements || []
    });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

// Get a single user by username
app.get('/api/users/:username', async (req, res) => {
  try {
    const usernameParam = (req.params.username || '').toLowerCase();
    if (!usernameParam) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const db = await connectToDatabase();
    const users = db.collection('users');
    const userDoc = await users.findOne({ username: usernameParam });

    if (!userDoc) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      username: userDoc.username,
      email: userDoc.email,
      highScore: userDoc.highScore || 0,
      totalGames: userDoc.totalGames || 0,
      wins: userDoc.wins || 0,
      achievements: userDoc.achievements || []
    });
  } catch (err) {
    console.error('Get user failed:', err);
    res.status(500).json({ error: 'Failed to load user.' });
  }
});

// Update a user's game stats and achievements
app.put('/api/users/:username', async (req, res) => {
  try {
    const usernameParam = (req.params.username || '').toLowerCase();
    if (!usernameParam) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const body = req.body || {};

    const updateFields = {
      username: usernameParam,
      email: body.email || '',
      highScore: body.highScore || 0,
      totalGames: body.totalGames || 0,
      wins: body.wins || 0,
      achievements: Array.isArray(body.achievements) ? body.achievements : []
    };

    const db = await connectToDatabase();
    const users = db.collection('users');

    const result = await users.updateOne(
      { username: usernameParam },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json(updateFields);
  } catch (err) {
    console.error('Update user failed:', err);
    res.status(500).json({ error: 'Failed to save user.' });
  }
});

// Leaderboard: top 10 users by high score
app.get('/api/leaderboard', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const users = db.collection('users');

    const top = await users
      .find({}, { projection: { _id: 0, username: 1, highScore: 1 } })
      .sort({ highScore: -1 })
      .limit(10)
      .toArray();

    res.json(top);
  } catch (err) {
    console.error('Leaderboard failed:', err);
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

app.listen(PORT, async () => {
  try {
    await connectToDatabase();
  } catch (err) {
    console.error('Failed to connect to MongoDB on startup:', err);
  }
  console.log(`Banana Quest server running at http://localhost:${PORT}`);
});

