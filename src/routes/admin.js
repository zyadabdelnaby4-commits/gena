const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { requireRole, JWT_SECRET } = require('../middleware/auth');

// Protect all routes with admin-only middleware
router.use(requireRole('admin'));

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// GET /api/admin/dashboard - stats & charts & live presence
router.get('/dashboard', async (req, res) => {
  try {
    const todayStr = getTodayDateString();
    const currentMonthPattern = `${todayStr.slice(0, 7)}-%`;
    const currentYearPattern = `${todayStr.slice(0, 4)}-%`;

    // 1. Teachers present today (checked in today)
    const presentTodayResult = await db.get(`
      SELECT COUNT(DISTINCT teacher_id) AS count 
      FROM attendance 
      WHERE date = ?
    `, [todayStr]);

    // 2. Total sessions completed today
    const sessionsTodayResult = await db.get(`
      SELECT SUM(sessions_count) AS total 
      FROM attendance 
      WHERE date = ?
    `, [todayStr]);

    // 3. Earnings for teachers (Today / Month / Year)
    const earningsTodayResult = await db.get(`
      SELECT SUM(earnings) AS total FROM attendance WHERE date = ?
    `, [todayStr]);

    const earningsMonthResult = await db.get(`
      SELECT SUM(earnings) AS total FROM attendance WHERE date LIKE ?
    `, [currentMonthPattern]);

    const earningsYearResult = await db.get(`
      SELECT SUM(earnings) AS total FROM attendance WHERE date LIKE ?
    `, [currentYearPattern]);

    // 4. Chart data: Most active teachers this month (by sessions completed)
    const topTeachers = await db.all(`
      SELECT u.name, SUM(a.sessions_count) AS total_sessions, COUNT(a.id) AS days_present
      FROM attendance a
      JOIN users u ON a.teacher_id = u.id
      WHERE a.date LIKE ?
      GROUP BY a.teacher_id
      ORDER BY total_sessions DESC
      LIMIT 6
    `, [currentMonthPattern]);

    // 5. Chart data: Last 7 days center check-ins trend
    const last7DaysTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const checkinCount = await db.get(`
        SELECT COUNT(id) AS count FROM attendance WHERE date = ?
      `, [dateStr]);

      last7DaysTrend.push({
        date: dateStr.slice(5),
        count: checkinCount?.count || 0
      });
    }

    // 6. Live Presence: Teachers currently clocked in (checkout is null)
    const livePresence = await db.all(`
      SELECT u.id AS teacher_id, u.name, a.check_in_time, a.check_in_type, u.phone
      FROM attendance a
      JOIN users u ON a.teacher_id = u.id
      WHERE a.date = ? AND a.status = 'present'
    `, [todayStr]);

    res.json({
      success: true,
      stats: {
        presentToday: presentTodayResult?.count || 0,
        sessionsToday: sessionsTodayResult?.total || 0,
        earningsToday: earningsTodayResult?.total || 0,
        earningsMonth: earningsMonthResult?.total || 0,
        earningsYear: earningsYearResult?.total || 0
      },
      charts: {
        topTeachers,
        trend: last7DaysTrend
      },
      livePresence
    });
  } catch (error) {
    console.error('Admin dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving dashboard statistics.' });
  }
});

// GET /api/admin/teachers - list all teachers with stats & adjustment calculations
router.get('/teachers', async (req, res) => {
  try {
    const todayStr = getTodayDateString();
    const currentMonthPattern = `${todayStr.slice(0, 7)}-%`;
    const currentYearPattern = `${todayStr.slice(0, 4)}-%`;

    const teachers = await db.all(`
      SELECT 
        u.id, u.username, u.name, u.phone, u.rate_per_session, u.payment_type, u.last_received_payment,
        (SELECT COUNT(a.id) FROM attendance a WHERE a.teacher_id = u.id) AS total_attendance_days,
        (SELECT SUM(a.sessions_count) FROM attendance a WHERE a.teacher_id = u.id) AS total_sessions,
        (SELECT COALESCE(SUM(a.earnings), 0) FROM attendance a WHERE a.teacher_id = u.id AND a.payment_status = 'unpaid') AS unpaid_attendance,
        (SELECT COALESCE(SUM(adj.amount), 0) FROM adjustments adj WHERE adj.teacher_id = u.id AND adj.payment_status = 'unpaid') AS unpaid_adjustments,
        (SELECT COALESCE(SUM(a.earnings), 0) FROM attendance a WHERE a.teacher_id = u.id AND a.payment_status = 'paid') AS paid_attendance,
        (SELECT COALESCE(SUM(adj.amount), 0) FROM adjustments adj WHERE adj.teacher_id = u.id AND adj.payment_status = 'paid') AS paid_adjustments,
        
        ((SELECT COALESCE(SUM(a.earnings), 0) FROM attendance a WHERE a.teacher_id = u.id AND a.date = ?) + 
         (SELECT COALESCE(SUM(adj.amount), 0) FROM adjustments adj WHERE adj.teacher_id = u.id AND adj.date = ?)) AS earnings_today,
         
        ((SELECT COALESCE(SUM(a.earnings), 0) FROM attendance a WHERE a.teacher_id = u.id AND a.date LIKE ?) + 
         (SELECT COALESCE(SUM(adj.amount), 0) FROM adjustments adj WHERE adj.teacher_id = u.id AND adj.date LIKE ?)) AS earnings_month,
         
        ((SELECT COALESCE(SUM(a.earnings), 0) FROM attendance a WHERE a.teacher_id = u.id AND a.date LIKE ?) + 
         (SELECT COALESCE(SUM(adj.amount), 0) FROM adjustments adj WHERE adj.teacher_id = u.id AND adj.date LIKE ?)) AS earnings_year
      FROM users u
      WHERE u.role = 'teacher'
      ORDER BY u.name ASC
    `, [todayStr, todayStr, currentMonthPattern, currentMonthPattern, currentYearPattern, currentYearPattern]);

    // Map calculations to net totals
    const processedTeachers = teachers.map(t => {
      const unpaidNet = Number(t.unpaid_attendance) + Number(t.unpaid_adjustments);
      const paidNet = Number(t.paid_attendance) + Number(t.paid_adjustments);
      return {
        id: t.id,
        username: t.username,
        name: t.name,
        phone: t.phone,
        rate_per_session: t.rate_per_session,
        payment_type: t.payment_type,
        last_received_payment: t.last_received_payment,
        total_attendance_days: t.total_attendance_days,
        total_sessions: t.total_sessions || 0,
        unpaid_earnings: unpaidNet >= 0 ? unpaidNet : 0, // Clamp negative balances to 0 for display, or show actual
        raw_unpaid_earnings: unpaidNet,
        paid_earnings: paidNet,
        earnings_today: t.earnings_today || 0,
        earnings_month: t.earnings_month || 0,
        earnings_year: t.earnings_year || 0
      };
    });

    res.json({ success: true, teachers: processedTeachers });
  } catch (error) {
    console.error('List teachers error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving teachers.' });
  }
});

// POST /api/admin/teachers - Add new teacher
router.post('/teachers', async (req, res) => {
  const { username, password, name, phone, rate_per_session, payment_type } = req.body;

  if (!username || !password || !name || rate_per_session === undefined || !payment_type) {
    return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
  }

  try {
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(`
      INSERT INTO users (username, password, role, name, phone, rate_per_session, payment_type)
      VALUES (?, ?, 'teacher', ?, ?, ?, ?)
    `, [username, hashedPassword, name, phone || '', Number(rate_per_session), payment_type]);

    res.json({ success: true, message: 'Teacher added successfully.', teacherId: result.id });
  } catch (error) {
    console.error('Add teacher error:', error);
    res.status(500).json({ success: false, message: 'Server error adding teacher.' });
  }
});

// PUT /api/admin/teachers/:id - Edit teacher
router.put('/teachers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, rate_per_session, payment_type, password } = req.body;

  if (!name || rate_per_session === undefined || !payment_type) {
    return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
  }

  try {
    const teacher = await db.get('SELECT id FROM users WHERE id = ? AND role = "teacher"', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(`
        UPDATE users 
        SET name = ?, phone = ?, rate_per_session = ?, payment_type = ?, password = ?
        WHERE id = ?
      `, [name, phone || '', Number(rate_per_session), payment_type, hashedPassword, id]);
    } else {
      await db.run(`
        UPDATE users 
        SET name = ?, phone = ?, rate_per_session = ?, payment_type = ?
        WHERE id = ?
      `, [name, phone || '', Number(rate_per_session), payment_type, id]);
    }

    res.json({ success: true, message: 'Teacher profile updated successfully.' });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ success: false, message: 'Server error updating teacher.' });
  }
});

// DELETE /api/admin/teachers/:id - Delete teacher
router.delete('/teachers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const teacher = await db.get('SELECT id FROM users WHERE id = ? AND role = "teacher"', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true, message: 'Teacher deleted successfully.' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting teacher.' });
  }
});

// ----------------------------------------------------
// FINANCIAL ADJUSTMENTS: CRUD
// ----------------------------------------------------

// GET /api/admin/teachers/:id/adjustments - Get advances & bonuses ledger
router.get('/teachers/:id/adjustments', async (req, res) => {
  const { id } = req.params;
  try {
    const adjustments = await db.all(`
      SELECT * FROM adjustments 
      WHERE teacher_id = ?
      ORDER BY date DESC, id DESC
    `, [id]);
    res.json({ success: true, adjustments });
  } catch (error) {
    console.error('Fetch adjustments error:', error);
    res.status(500).json({ success: false, message: 'Error retrieving adjustments.' });
  }
});

// POST /api/admin/teachers/:id/adjustments - Log advance or bonus
router.post('/teachers/:id/adjustments', async (req, res) => {
  const { id } = req.params;
  const { type, amount, description } = req.body;

  if (!type || amount === undefined) {
    return res.status(400).json({ success: false, message: 'Adjustment type and amount are required.' });
  }

  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'Amount must be a positive number.' });
  }

  // Real value is positive for bonus, negative for advance
  const adjustmentValue = type === 'bonus' ? amt : -amt;
  const dateStr = getTodayDateString();

  try {
    await db.run(`
      INSERT INTO adjustments (teacher_id, date, amount, type, description, payment_status)
      VALUES (?, ?, ?, ?, ?, 'unpaid')
    `, [id, dateStr, adjustmentValue, type, description || '']);

    res.json({ success: true, message: `Successfully added ${type} of $${amt.toFixed(2)}.` });
  } catch (error) {
    console.error('Add adjustment error:', error);
    res.status(500).json({ success: false, message: 'Error logging financial adjustment.' });
  }
});

// GET /api/admin/settings - geofence location
router.get('/settings', async (req, res) => {
  try {
    const lat = await db.get("SELECT value FROM settings WHERE key = 'center_lat'");
    const lon = await db.get("SELECT value FROM settings WHERE key = 'center_lon'");
    const radius = await db.get("SELECT value FROM settings WHERE key = 'center_radius'");

    res.json({
      success: true,
      settings: {
        center_lat: Number(lat.value),
        center_lon: Number(lon.value),
        center_radius: Number(radius.value)
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving settings.' });
  }
});

// POST /api/admin/settings - update geofence location
router.post('/settings', async (req, res) => {
  const { center_lat, center_lon, center_radius } = req.body;
  if (center_lat === undefined || center_lon === undefined || center_radius === undefined) {
    return res.status(400).json({ success: false, message: 'All coordinates and radius are required.' });
  }

  try {
    await db.run("UPDATE settings SET value = ? WHERE key = 'center_lat'", [String(center_lat)]);
    await db.run("UPDATE settings SET value = ? WHERE key = 'center_lon'", [String(center_lon)]);
    await db.run("UPDATE settings SET value = ? WHERE key = 'center_radius'", [String(center_radius)]);

    res.json({ success: true, message: 'Center location and radius updated successfully.' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ success: false, message: 'Server error updating settings.' });
  }
});

// GET /api/admin/attendance - list attendance logs with advanced filtering options
router.get('/attendance', async (req, res) => {
  const { teacher_id, start_date, end_date, payment_status } = req.query;
  try {
    let query = `
      SELECT 
        a.*, u.name AS teacher_name, u.phone AS teacher_phone, u.rate_per_session
      FROM attendance a
      JOIN users u ON a.teacher_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (teacher_id) {
      query += ` AND a.teacher_id = ?`;
      params.push(Number(teacher_id));
    }
    if (start_date) {
      query += ` AND a.date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.date <= ?`;
      params.push(end_date);
    }
    if (payment_status) {
      query += ` AND a.payment_status = ?`;
      params.push(payment_status);
    }

    query += ` ORDER BY a.date DESC, a.check_in_time DESC`;

    const logs = await db.all(query, params);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving attendance logs.' });
  }
});

// POST /api/admin/attendance/:id/pay - pay a single attendance record
router.post('/attendance/:id/pay', async (req, res) => {
  const { id } = req.params;
  const payDate = new Date().toISOString();
  try {
    const record = await db.get('SELECT * FROM attendance WHERE id = ?', [id]);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    }

    await db.run(`
      UPDATE attendance 
      SET payment_status = 'paid', payment_date = ?
      WHERE id = ?
    `, [payDate, id]);

    // Also update last_received_payment date in user table for this teacher
    await db.run(`
      UPDATE users 
      SET last_received_payment = ?
      WHERE id = ?
    `, [payDate.slice(0, 10), record.teacher_id]);

    res.json({ success: true, message: 'Payment recorded successfully.' });
  } catch (error) {
    console.error('Pay attendance error:', error);
    res.status(500).json({ success: false, message: 'Server error marking payment.' });
  }
});

// POST /api/admin/teachers/:id/pay-all - settle all outstanding payments for a teacher
router.post('/teachers/:id/pay-all', async (req, res) => {
  const { id } = req.params;
  const payDate = new Date().toISOString();
  try {
    const teacher = await db.get('SELECT name, phone FROM users WHERE id = ? AND role = "teacher"', [id]);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    // Retrieve unpaid attendance totals
    const attendanceUnpaid = await db.get(`
      SELECT COALESCE(SUM(earnings), 0) AS total FROM attendance 
      WHERE teacher_id = ? AND payment_status = 'unpaid'
    `, [id]);

    // Retrieve unpaid adjustments totals
    const adjustmentsUnpaid = await db.get(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM adjustments 
      WHERE teacher_id = ? AND payment_status = 'unpaid'
    `, [id]);

    const attendanceTotal = Number(attendanceUnpaid.total);
    const adjustmentsTotal = Number(adjustmentsUnpaid.total);
    const finalAmount = attendanceTotal + adjustmentsTotal;

    // Settle attendance
    const attendanceRes = await db.run(`
      UPDATE attendance 
      SET payment_status = 'paid', payment_date = ?
      WHERE teacher_id = ? AND payment_status = 'unpaid'
    `, [payDate, id]);

    // Settle adjustments
    const adjustmentsRes = await db.run(`
      UPDATE adjustments 
      SET payment_status = 'paid', payment_date = ?
      WHERE teacher_id = ? AND payment_status = 'unpaid'
    `, [payDate, id]);

    const totalChanges = attendanceRes.changes + adjustmentsRes.changes;

    if (totalChanges > 0) {
      await db.run(`
        UPDATE users 
        SET last_received_payment = ?
        WHERE id = ?
      `, [payDate.slice(0, 10), id]);
    }

    res.json({ 
      success: true, 
      message: `Cleared payouts for ${attendanceRes.changes} sessions and ${adjustmentsRes.changes} adjustments. Total: $${finalAmount.toFixed(2)}`,
      recordsCleared: totalChanges,
      amountPaid: finalAmount
    });
  } catch (error) {
    console.error('Pay all teacher error:', error);
    res.status(500).json({ success: false, message: 'Server error settling payments.' });
  }
});

// GET /api/admin/qr-token - Generate dynamic daily QR token
router.get('/qr-token', async (req, res) => {
  try {
    const lat = await db.get("SELECT value FROM settings WHERE key = 'center_lat'");
    const lon = await db.get("SELECT value FROM settings WHERE key = 'center_lon'");
    const todayStr = getTodayDateString();
    
    // Hash based on coordinates, date, and secret
    const token = crypto.createHash('md5')
      .update(`${lat.value}_${lon.value}_${todayStr}_${JWT_SECRET}`)
      .digest('hex');

    res.json({
      success: true,
      token,
      date: todayStr
    });
  } catch (error) {
    console.error('Error generating QR token:', error);
    res.status(500).json({ success: false, message: 'Server error generating QR token.' });
  }
});



// GET /api/admin/fake-gps-logs - fetch spoof logs
router.get('/fake-gps-logs', async (req, res) => {
  try {
    const logs = await db.all(`
      SELECT f.*, u.name AS teacher_name, u.phone AS teacher_phone
      FROM fake_gps_logs f
      JOIN users u ON f.teacher_id = u.id
      ORDER BY f.timestamp DESC
    `);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Get fake GPS logs error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching verification logs.' });
  }
});

// GET /api/admin/reports/csv - Export CSV report
router.get('/reports/csv', async (req, res) => {
  try {
    const logs = await db.all(`
      SELECT 
        a.date, u.name AS teacher_name, u.phone AS teacher_phone,
        a.check_in_time, a.check_out_time, a.sessions_count, a.earnings,
        a.is_fake_gps, a.payment_status, a.payment_date
      FROM attendance a
      JOIN users u ON a.teacher_id = u.id
      ORDER BY a.date DESC
    `);

    // Build CSV content
    let csv = 'Date,Teacher Name,Phone,Check In,Check Out,Sessions,Earnings,Spoof Flagged,Payment Status,Payment Date\n';
    
    logs.forEach(log => {
      const name = `"${log.teacher_name.replace(/"/g, '""')}"`;
      const date = log.date;
      const phone = log.teacher_phone || '';
      const checkIn = log.check_in_time || '';
      const checkOut = log.check_out_time || '';
      const sessions = log.sessions_count || 0;
      const earnings = log.earnings || 0;
      const spoof = log.is_fake_gps ? 'YES' : 'NO';
      const payStatus = log.payment_status;
      const payDate = log.payment_date ? log.payment_date.slice(0, 16).replace('T', ' ') : '';

      csv += `${date},${name},${phone},${checkIn},${checkOut},${sessions},${earnings},${spoof},${payStatus},${payDate}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=teacher_earnings_report.csv');
    res.status(200).send(csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ success: false, message: 'Server error generating CSV report.' });
  }
});

module.exports = router;
