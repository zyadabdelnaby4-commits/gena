const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireRole, JWT_SECRET } = require('../middleware/auth');

// Protect all routes with teacher-only middleware
router.use(requireRole('teacher'));

// Haversine formula to calculate distance in meters
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// GET /api/teacher/dashboard - get current stats, geofence center, and active check-in
router.get('/dashboard', async (req, res) => {
  try {
    const teacherId = req.user.id;
    const todayStr = getTodayDateString();

    // 1. Get teacher profile
    const profile = await db.getUserById(teacherId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Teacher profile not found.' });
    }

    // 2. Fetch center geofence
    const settings = await db.getSettings();
    const center = {
      lat: settings.center_lat,
      lon: settings.center_lon,
      radius: settings.center_radius
    };

    // 3 & 4. Fetch aggregated stats
    const stats = await db.getTeacherStats(teacherId, todayStr);

    // 5. Active attendance check-in
    const activeCheckin = await db.getActiveAttendance(teacherId);

    res.json({
      success: true,
      profile,
      center,
      stats: {
        ...stats,
        lastReceivedPayment: profile.last_received_payment || 'N/A'
      },
      activeCheckin
    });
  } catch (error) {
    console.error('Teacher dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving dashboard statistics.' });
  }
});

// POST /api/teacher/check-in - GPS Geofenced check-in
router.post('/check-in', async (req, res) => {
  const { lat, lon, accuracy } = req.body;
  const teacherId = req.user.id;

  if (lat === undefined || lon === undefined) {
    return res.status(400).json({ success: false, message: 'GPS coordinates are required to check in.' });
  }

  try {
    const activeCheckin = await db.getActiveAttendance(teacherId);
    if (activeCheckin) {
      return res.status(400).json({ success: false, message: 'You are already checked in. Please check out first.' });
    }

    const settings = await db.getSettings();
    const centerLat = settings.center_lat;
    const centerLon = settings.center_lon;
    const radiusLimit = settings.center_radius;

    const distance = calculateDistance(lat, lon, centerLat, centerLon);

    if (distance > radiusLimit) {
      // Log fake GPS attempt
      await db.createFakeGpsLog({
        teacher_id: teacherId,
        timestamp: new Date().toISOString(),
        action_type: 'check-in',
        user_lat: lat,
        user_lon: lon,
        center_lat: centerLat,
        center_lon: centerLon,
        reason: `Outside center geofence bounds. Distance: ${distance.toFixed(1)}m`
      });

      return res.status(403).json({
        success: false,
        message: `Check-in denied. You are ${distance.toFixed(1)} meters away from the center.`
      });
    }

    if (accuracy && Number(accuracy) > 200) {
      await db.createFakeGpsLog({
        teacher_id: teacherId,
        timestamp: new Date().toISOString(),
        action_type: 'check-in-warning',
        user_lat: lat,
        user_lon: lon,
        center_lat: centerLat,
        center_lon: centerLon,
        reason: `Weak GPS accuracy: ${accuracy}m.`
      });
    }

    const todayStr = getTodayDateString();
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

    await db.createAttendance({
      teacher_id: teacherId,
      date: todayStr,
      check_in_time: timeStr,
      check_in_lat: lat,
      check_in_lon: lon,
      status: 'present',
      is_fake_gps: 0,
      check_in_type: 'gps'
    });

    res.json({ success: true, message: 'Checked in successfully.' });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: 'Server error during check-in.' });
  }
});

// POST /api/teacher/check-in/qr - QR Code fallback check-in (bypasses geofence)
router.post('/check-in/qr', async (req, res) => {
  const { qr_token } = req.body;
  const teacherId = req.user.id;

  if (!qr_token) {
    return res.status(400).json({ success: false, message: 'QR Code token is required.' });
  }

  try {
    // 1. Verify not already checked in
    const activeCheckin = await db.getActiveAttendance(teacherId);
    if (activeCheckin) {
      return res.status(400).json({ success: false, message: 'You are already checked in.' });
    }

    // 2. Validate token (Match calculated daily token)
    const settings = await db.getSettings();
    const todayStr = getTodayDateString();

    const expectedToken = crypto.createHash('md5')
      .update(`${settings.center_lat}_${settings.center_lon}_${todayStr}_${JWT_SECRET}`)
      .digest('hex');

    if (qr_token !== expectedToken) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired QR code. Please scan the current code displayed on the admin panel.'
      });
    }

    // 3. Register check-in, setting coordinates to center coordinates as fallback
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    const cLat = settings.center_lat;
    const cLon = settings.center_lon;

    await db.createAttendance({
      teacher_id: teacherId,
      date: todayStr,
      check_in_time: timeStr,
      check_in_lat: cLat,
      check_in_lon: cLon,
      status: 'present',
      is_fake_gps: 0,
      check_in_type: 'qr_code'
    });

    res.json({
      success: true,
      message: 'Checked in successfully using QR Code.'
    });
  } catch (error) {
    console.error('QR check-in error:', error);
    res.status(500).json({ success: false, message: 'Server error during QR check-in.' });
  }
});

// POST /api/teacher/check-out - GPS Geofenced check-out & session logs
router.post('/check-out', async (req, res) => {
  const { lat, lon, accuracy, sessions_count } = req.body;
  const teacherId = req.user.id;

  if (lat === undefined || lon === undefined || sessions_count === undefined) {
    return res.status(400).json({ success: false, message: 'GPS coordinates and completed sessions count are required.' });
  }

  const sessionsNum = parseInt(sessions_count, 10);
  if (isNaN(sessionsNum) || sessionsNum < 0) {
    return res.status(400).json({ success: false, message: 'Completed sessions count must be a non-negative number.' });
  }

  try {
    const activeRecord = await db.getActiveAttendance(teacherId);
    if (!activeRecord) {
      return res.status(400).json({ success: false, message: 'You have not checked in yet.' });
    }

    const settings = await db.getSettings();
    const centerLat = settings.center_lat;
    const centerLon = settings.center_lon;
    const radiusLimit = settings.center_radius;

    // We check checkout distance
    const checkoutDistance = calculateDistance(lat, lon, centerLat, centerLon);

    if (checkoutDistance > radiusLimit) {
      await db.createFakeGpsLog({
        teacher_id: teacherId,
        timestamp: new Date().toISOString(),
        action_type: 'check-out-denied',
        user_lat: lat,
        user_lon: lon,
        center_lat: centerLat,
        center_lon: centerLon,
        reason: `Check-out denied. Distance: ${checkoutDistance.toFixed(1)}m from center.`
      });

      return res.status(403).json({
        success: false,
        message: `Check-out denied. You must check out while at the school/center.`
      });
    }

    // Anti-cheat checks (velocity & session times)
    let isFakeGps = 0;
    let fakeGpsDetails = [];

    const now = new Date();
    const checkinParts = activeRecord.check_in_time.split(':');
    const checkinDate = new Date(activeRecord.date);
    checkinDate.setHours(parseInt(checkinParts[0], 10));
    checkinDate.setMinutes(parseInt(checkinParts[1], 10));
    checkinDate.setSeconds(parseInt(checkinParts[2], 10));

    const elapsedMs = now.getTime() - checkinDate.getTime();
    const elapsedMinutes = elapsedMs / (1000 * 60);

    // Rule A: Fast session submit check
    if (sessionsNum > 0 && elapsedMinutes < 5) {
      isFakeGps = 1;
      fakeGpsDetails.push(`Claimed ${sessionsNum} session(s) in only ${elapsedMinutes.toFixed(1)} minutes.`);
    }

    // Rule B: Impossible travel speed check
    const travelDistance = calculateDistance(
      activeRecord.check_in_lat,
      activeRecord.check_in_lon,
      lat,
      lon
    );
    const elapsedSeconds = elapsedMs / 1000;
    if (elapsedSeconds > 10 && travelDistance > 100) {
      const speedMPS = travelDistance / elapsedSeconds;
      const speedKMPH = speedMPS * 3.6;
      if (speedKMPH > 120) {
        isFakeGps = 1;
        fakeGpsDetails.push(`Impossible transit speed: ${speedKMPH.toFixed(1)} km/h.`);
      }
    }

    // Get rates
    const teacherProfile = await db.getUserById(teacherId);
    let calculatedEarnings = sessionsNum * (teacherProfile.rate_per_session || 0);

    if (isFakeGps) {
      const reasonsJoined = fakeGpsDetails.join(' | ');
      await db.createFakeGpsLog({
        teacher_id: teacherId,
        timestamp: new Date().toISOString(),
        action_type: 'anti-cheat-flag',
        user_lat: lat,
        user_lon: lon,
        center_lat: centerLat,
        center_lon: centerLon,
        reason: reasonsJoined
      });
    }

    // Update attendance record
    const checkoutTimeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    await db.updateAttendance(activeRecord.id, {
      check_out_time: checkoutTimeStr,
      check_out_lat: lat,
      check_out_lon: lon,
      sessions_count: sessionsNum,
      earnings: calculatedEarnings,
      status: 'completed',
      is_fake_gps: isFakeGps,
      fake_gps_details: isFakeGps ? fakeGpsDetails.join(' | ') : null
    });

    res.json({
      success: true,
      message: 'Checked out successfully.',
      sessionsRecorded: sessionsNum,
      earnings: calculatedEarnings,
      flagged: isFakeGps
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: 'Server error during check-out.' });
  }
});

// GET /api/teacher/ledger - Get teacher's own financial adjustments and payments history
router.get('/ledger', async (req, res) => {
  const teacherId = req.user.id;
  try {
    const adjustments = await db.getAdjustmentsByTeacher(teacherId);
    res.json({ success: true, adjustments });
  } catch (error) {
    console.error('Fetch teacher ledger error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving ledger.' });
  }
});

module.exports = router;
