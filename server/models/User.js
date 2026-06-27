const { Pool } = require('pg');
const crypto = require('crypto');
const config = require('../config');

// PostgreSQL connection pool
const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  ssl: config.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

/**
 * User Model - Database operations for users
 * Uses PostgreSQL with parameterized queries to prevent SQL injection
 */
class User {
  /**
   * Initialize users table
   * Creates table if it doesn't exist with proper constraints
   */
  static async init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(80) UNIQUE NOT NULL,
        email VARCHAR(190) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  }

  /**
   * Find user by email or username
   * Used during login to check if user exists
   */
  static async findByEmailOrUsername(identifier) {
    const { rows } = await pool.query(
      'SELECT id, username, email, password_hash, created_at, updated_at FROM users WHERE email = $1 OR username = $1 LIMIT 1',
      [identifier]
    );
    return rows[0] || null;
  }

  /**
   * Find user by ID
   * Used to fetch authenticated user details
   */
  static async findById(id) {
    const { rows } = await pool.query(
      'SELECT id, username, email, created_at, updated_at FROM users WHERE id = $1 LIMIT 1',
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Check if email already exists
   * Used during registration validation
   */
  static async emailExists(email) {
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    return rows.length > 0;
  }

  /**
   * Check if username already exists
   * Used during registration validation
   */
  static async usernameExists(username) {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    return rows.length > 0;
  }

  /**
   * Create new user
   * Stores hashed password - never plain text
   */
  static async create({ username, email, passwordHash, name, firstName, lastName }) {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      'INSERT INTO users (id, username, name, first_name, last_name, email, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email, created_at',
      [id, username, name, firstName, lastName, email, passwordHash]
    );
    return rows[0];
  }

  /**
   * Update user's last login timestamp
   * Optional: can be used to track user activity
   */
  static async updateLastLogin(id) {
    await pool.query('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  }

  /**
   * Get db pool instance for direct queries if needed
   */
  static getPool() {
    return pool;
  }
}

module.exports = User;
