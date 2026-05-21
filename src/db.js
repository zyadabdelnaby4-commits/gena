const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH 
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper function to run query
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

// Helper function to get single row
const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Helper function to get multiple rows
const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize database schema and seed default data
const initDB = async () => {
  try {
    // 1. Settings Table
    await run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Seed default settings if empty
    const centerLat = await get("SELECT value FROM settings WHERE key = 'center_lat'");
    if (!centerLat) {
      await run("INSERT INTO settings (key, value) VALUES ('center_lat', '30.0444')"); // Default: Cairo center coords
      await run("INSERT INTO settings (key, value) VALUES ('center_lon', '31.2357')");
      await run("INSERT INTO settings (key, value) VALUES ('center_radius', '100')"); // Default: 100 meters
    }

    // 2. Users Table (Admin & Teachers)
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'teacher')),
        name TEXT NOT NULL,
        phone TEXT,
        rate_per_session REAL DEFAULT 0,
        payment_type TEXT CHECK(payment_type IN ('session', 'monthly')) DEFAULT 'session',
        last_received_payment TEXT
      )
    `);

    // Seed default admin if empty
    const adminUser = await get("SELECT id FROM users WHERE username = 'admin'");
    if (!adminUser) {
      const hashedAdminPassword = await bcrypt.hash('admin123', 10);
      await run(`
        INSERT INTO users (username, password, role, name, phone, rate_per_session, payment_type)
        VALUES ('admin', ?, 'admin', 'System Administrator', '01000000000', 0, 'monthly')
      `, [hashedAdminPassword]);
    }

    // Seed test teacher if empty
    const testTeacher = await get("SELECT id FROM users WHERE username = 'teacher1'");
    if (!testTeacher) {
      const hashedTeacherPassword = await bcrypt.hash('teacher123', 10);
      await run(`
        INSERT INTO users (username, password, role, name, phone, rate_per_session, payment_type)
        VALUES ('teacher1', ?, 'teacher', 'John Doe', '01234567890', 150.00, 'session')
      `, [hashedTeacherPassword]);
    }

    // 3. Attendance Table
    await run(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        check_in_time TEXT NOT NULL,
        check_out_time TEXT,
        check_in_lat REAL NOT NULL,
        check_in_lon REAL NOT NULL,
        check_out_lat REAL,
        check_out_lon REAL,
        sessions_count INTEGER DEFAULT 0,
        earnings REAL DEFAULT 0,
        status TEXT CHECK(status IN ('present', 'completed')) DEFAULT 'present',
        is_fake_gps INTEGER DEFAULT 0,
        fake_gps_details TEXT,
        payment_status TEXT CHECK(payment_status IN ('unpaid', 'paid')) DEFAULT 'unpaid',
        payment_date TEXT,
        check_in_type TEXT DEFAULT 'gps',
        FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 4. Adjustments Table (Advances & Bonuses)
    await run(`
      CREATE TABLE IF NOT EXISTS adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT CHECK(type IN ('bonus', 'advance')) NOT NULL,
        description TEXT,
        payment_status TEXT CHECK(payment_status IN ('unpaid', 'paid')) DEFAULT 'unpaid',
        payment_date TEXT,
        FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 6. Fake GPS Logs Table
    await run(`
      CREATE TABLE IF NOT EXISTS fake_gps_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        action_type TEXT NOT NULL,
        user_lat REAL,
        user_lon REAL,
        center_lat REAL,
        center_lon REAL,
        reason TEXT NOT NULL,
        FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log("Database initialized successfully!");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
};

module.exports = {
  db,
  run,
  get,
  all,
  initDB
};
