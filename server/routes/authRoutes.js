const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { register, login, getMe, logout } = require('../controllers/authController');

const router = express.Router();

/**
 * Validation rules for registration
 * Ensures data integrity and prevents malformed requests
 */
const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('firstName')
    .trim()
    .isLength({ min: 2 })
    .withMessage('First name must be at least 2 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Last name must be at least 2 characters'),
];

/**
 * Validation rules for login
 * Accepts either email or username as identifier
 */
const loginValidation = [
  body('identifier')
    .trim()
    .notEmpty()
    .withMessage('Email or username is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

/**
 * POST /api/auth/register
 * Register a new user account
 * Public route - no authentication required
 */
router.post('/register', registerValidation, register);

/**
 * POST /api/auth/login
 * Login with email/username and password
 * Public route - no authentication required
 */
router.post('/login', loginValidation, login);

/**
 * GET /api/auth/me
 * Get current authenticated user
 * Protected route - requires valid JWT token
 */
router.get('/me', authenticate, getMe);

/**
 * POST /api/auth/logout
 * Logout current user
 * Protected route - requires valid JWT token
 */
router.post('/logout', authenticate, logout);

module.exports = router;
