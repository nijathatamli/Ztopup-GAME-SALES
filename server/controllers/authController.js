const { validationResult } = require('express-validator');
const User = require('../models/User');
const { generateToken } = require('../utils/jwt');
const { hashPassword, comparePassword } = require('../utils/bcrypt');

/**
 * Auth Controllers
 * Handle registration, login, logout, and profile retrieval
 * All password operations use bcrypt - never plain text
 */

/**
 * Register new user
 * POST /api/auth/register
 */
async function register(req, res) {
  try {
    // Validate request data
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { username, email, password } = req.body;

    // Check if email already exists
    const emailExists = await User.emailExists(email);
    if (emailExists) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
      });
    }

    // Check if username already exists
    const usernameExists = await User.usernameExists(username);
    if (usernameExists) {
      return res.status(409).json({
        success: false,
        message: 'Username already taken',
      });
    }

    // Hash password before storing - critical security
    const passwordHash = await hashPassword(password);

    // Create user in database
    const newUser = await User.create({
      username,
      email,
      passwordHash,
    });

    // Generate JWT token for immediate login
    const token = generateToken({
      userId: newUser.id,
      username: newUser.username,
      email: newUser.email,
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          createdAt: newUser.created_at,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
    });
  }
}

/**
 * Login user
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    // Validate request data
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { identifier, password } = req.body;

    // Find user by email or username
    const user = await User.findByEmailOrUsername(identifier);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Compare password using bcrypt
    const isPasswordValid = await comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Update last login timestamp
    await User.updateLastLogin(user.id);

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          createdAt: user.created_at,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
    });
  }
}

/**
 * Get current authenticated user
 * GET /api/auth/me
 * Protected route - requires valid JWT token
 */
async function getMe(req, res) {
  try {
    // User is already attached to req by authenticate middleware
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching user data',
    });
  }
}

/**
 * Logout user
 * POST /api/auth/logout
 * Since JWT is stateless, logout is handled client-side by removing token
 * This endpoint can be used for server-side logging or token blacklisting in future
 */
async function logout(req, res) {
  try {
    // In a stateless JWT system, logout is primarily client-side
    // This endpoint can be extended to add token to blacklist if needed
    res.status(200).json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout',
    });
  }
}

module.exports = {
  register,
  login,
  getMe,
  logout,
};
