const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * JWT Utility Functions
 * Handles token generation and verification
 * Critical security: Never expose JWT_SECRET in client code
 */

/**
 * Generate JWT token for authenticated user
 * @param {Object} payload - User data to encode in token (typically { userId, username, email })
 * @returns {String} JWT token
 */
function generateToken(payload) {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

/**
 * Verify JWT token and extract payload
 * @param {String} token - JWT token from Authorization header
 * @returns {Object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Extract token from Authorization header
 * Expected format: "Bearer <token>"
 * @param {String} authHeader - Authorization header value
 * @returns {String|null} Token or null if invalid format
 */
function extractToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
}

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
};
