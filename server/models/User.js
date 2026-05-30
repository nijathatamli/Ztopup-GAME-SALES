const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('../config');

// SQLite database connection
const dbPath = path.join(__dirname, '../../data/zelix_auth.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('SQLite connection error:', err);
  else console.log('Connected to SQLite database');
});

/**
 * User Model - Database operations for users
 * Uses SQLite with parameterized queries to prevent SQL injection
 */
class User {
  /**
   * Initialize users table
   * Creates table if it doesn't exist with proper constraints
   */
  static async init() {
    return new Promise((resolve, reject) => {
      const query = `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      `;
      db.run(query, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Find user by email or username
   * Used during login to check if user exists
   */
  static async findByEmailOrUsername(identifier) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT id, username, email, password_hash, created_at, updated_at
        FROM users
        WHERE email = ? OR username = ?
        LIMIT 1
      `;
      db.get(query, [identifier, identifier], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Find user by ID
   * Used to fetch authenticated user details
   */
  static async findById(id) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT id, username, email, created_at, updated_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `;
      db.get(query, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Check if email already exists
   * Used during registration validation
   */
  static async emailExists(email) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT id FROM users WHERE email = ? LIMIT 1';
      db.get(query, [email], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });
  }

  /**
   * Check if username already exists
   * Used during registration validation
   */
  static async usernameExists(username) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT id FROM users WHERE username = ? LIMIT 1';
      db.get(query, [username], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });
  }

  /**
   * Create new user
   * Stores hashed password - never plain text
   */
  static async create({ username, email, passwordHash }) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO users (username, email, password_hash)
        VALUES (?, ?, ?)
        RETURNING id, username, email, created_at
      `;
      db.run(query, [username, email, passwordHash], function(err) {
        if (err) reject(err);
        else {
          // Fetch the inserted row
          db.get('SELECT id, username, email, created_at FROM users WHERE id = ?', [this.lastID], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        }
      });
    });
  }

  /**
   * Update user's last login timestamp
   * Optional: can be used to track user activity
   */
  static async updateLastLogin(id) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE users
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      db.run(query, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get db instance for direct queries if needed
   */
  static getDb() {
    return db;
  }
}

module.exports = User;
