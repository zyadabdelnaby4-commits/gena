const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const db = require('./src/db');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON and URL parsing, Cookies, and logging
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize SQLite database
db.initDB().then(() => {
  console.log("SQLite DB integration completed.");
}).catch(err => {
  console.error("Critical database initialization failure:", err);
});

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/teacher', require('./src/routes/teacher'));

// Static files server
app.use(express.static(path.join(__dirname, 'public')));

// Root route redirects to login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'An internal server error occurred.' });
});

// Start Express application
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Teacher Attendance Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
