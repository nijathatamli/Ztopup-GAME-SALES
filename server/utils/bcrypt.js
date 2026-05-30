const bcrypt = require('bcryptjs');

/**
 * Bcrypt Password Hashing Utilities
 * Critical security: Never store plain text passwords
 * Always use bcrypt for password hashing and comparison
 */

/**
 * Hash a plain text password
 * Uses bcrypt with salt rounds of 12 (good balance of security and performance)
 * @param {String} plainPassword - Plain text password
 * @returns {Promise<String>} Hashed password
 */
async function hashPassword(plainPassword) {
  const saltRounds = 12;
  return await bcrypt.hash(plainPassword, saltRounds);
}

/**
 * Compare plain text password with hashed password
 * @param {String} plainPassword - Plain text password from login form
 * @param {String} hashedPassword - Hashed password from database
 * @returns {Promise<Boolean>} True if passwords match, false otherwise
 */
async function comparePassword(plainPassword, hashedPassword) {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

module.exports = {
  hashPassword,
  comparePassword,
};
