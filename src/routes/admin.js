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
    const statsData = await db.getAdminDashboardStats(todayStr);
    res.json({
      success: true,
      ...statsData
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
    const processedTeachers = await db.getTeachersListWithStats(todayStr);
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
    const existing = await db.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.createUser({
      username,
      password: hashedPassword,
      role: 'teacher',
      name,
      phone: phone || '',
      rate_per_session: Number(rate_per_session),
      payment_type
    });

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
    const teacher = await db.getUserById(id);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    const updates = {
      name,
      phone: phone || '',
      rate_per_session: Number(rate_per_session),
      payment_type
    };

    if (password && password.trim() !== '') {
      updates.password = await bcrypt.hash(password, 10);
    }

    await db.updateUser(id, updates);
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
    const teacher = await db.getUserById(id);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }
    await db.deleteUser(id);
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
    const adjustments = await db.getAdjustmentsByTeacher(id);
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
    await db.createAdjustment({
      teacher_id: id,
      date: dateStr,
      amount: adjustmentValue,
      type,
      description: description || '',
      payment_status: 'unpaid'
    });

    res.json({ success: true, message: `Successfully added ${type} of $${amt.toFixed(2)}.` });
  } catch (error) {
    console.error('Add adjustment error:', error);
    res.status(500).json({ success: false, message: 'Error logging financial adjustment.' });
  }
});

// GET /api/admin/settings - geofence location
router.get('/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json({
      success: true,
      settings
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
    await db.updateSetting('center_lat', String(center_lat));
    await db.updateSetting('center_lon', String(center_lon));
    await db.updateSetting('center_radius', String(center_radius));

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
    const filters = {};
    if (teacher_id) filters.teacher_id = teacher_id;
    if (payment_status) filters.payment_status = payment_status;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;

    const logs = await db.getAttendanceLogs(filters);
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
    const record = await db.getAttendanceById(id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    }

    await db.payAttendance(id, payDate);

    // Also update last_received_payment date in user table for this teacher
    await db.updateUser(record.teacher_id, {
      last_received_payment: payDate.slice(0, 10)
    });

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
    const teacher = await db.getUserById(id);
    if (!teacher || teacher.role !== 'teacher') {
      return res.status(404).json({ success: false, message: 'Teacher not found.' });
    }

    // Retrieve unpaid logs and adjustments to sum totals for response
    const logs = await db.getAttendanceLogs({ teacher_id: id, payment_status: 'unpaid' });
    const adjustments = await db.getAdjustmentsByTeacher(id);
    const unpaidAdjustments = adjustments.filter(a => a.payment_status === 'unpaid');

    const attendanceTotal = logs.reduce((acc, log) => acc + (Number(log.earnings) || 0), 0);
    const adjustmentsTotal = unpaidAdjustments.reduce((acc, adj) => acc + (Number(adj.amount) || 0), 0);
    const finalAmount = attendanceTotal + adjustmentsTotal;

    // Settle attendance & adjustments
    const attRes = await db.payAllTeacherAttendance(id, payDate);
    const adjRes = await db.payAllTeacherAdjustments(id, payDate);
    const totalChanges = attRes.changes + adjRes.changes;

    if (totalChanges > 0) {
      await db.updateUser(id, {
        last_received_payment: payDate.slice(0, 10)
      });
    }

    res.json({ 
      success: true, 
      message: `Cleared payouts for ${attRes.changes} sessions and ${adjRes.changes} adjustments. Total: $${finalAmount.toFixed(2)}`,
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
    const settings = await db.getSettings();
    const todayStr = getTodayDateString();
    
    // Hash based on coordinates, date, and secret
    const token = crypto.createHash('md5')
      .update(`${settings.center_lat}_${settings.center_lon}_${todayStr}_${JWT_SECRET}`)
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
    const logs = await db.getFakeGpsLogs();
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Get fake GPS logs error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching verification logs.' });
  }
});

// GET /api/admin/reports/csv - Export CSV report
router.get('/reports/csv', async (req, res) => {
  try {
    const logs = await db.getAttendanceLogs();

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
