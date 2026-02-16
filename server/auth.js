require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const SALT_ROUNDS = 12;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in the environment (.env)');
}
if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error('JWT_REFRESH_SECRET is not set in the environment (.env)');
}

const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES;
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES;
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getResetTokenExpiry() {
  return new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);
}

module.exports = {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateResetToken,
  getResetTokenExpiry,
  ACCESS_EXPIRES_IN,
  RESET_TOKEN_EXPIRY_MS
};
