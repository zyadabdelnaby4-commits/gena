const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT JSON environment variable:", e);
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase initialized from FIREBASE_SERVICE_ACCOUNT environment variable.");
} else {
  const localKeyPath = path.resolve(__dirname, '../serviceAccountKey.json');
  if (fs.existsSync(localKeyPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(require(localKeyPath))
    });
    console.log("Firebase initialized from local serviceAccountKey.json.");
  } else {
    // Support firebase local emulator or default credentials if available
    if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
      admin.initializeApp({ projectId: "demo-project" });
      console.log("Firebase initialized with emulator mode.");
    } else {
      console.warn("WARNING: No Firebase credentials found. App will fail on DB queries.");
    }
  }
}

const db = admin.apps.length > 0 ? admin.firestore() : null;

// Helper to map document to regular JS object with id field
const mapDoc = (doc) => {
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
};

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------
const getSetting = async (key) => {
  if (!db) return null;
  const doc = await db.collection('settings').doc(key).get();
  return doc.exists ? { key, value: doc.data().value } : null;
};

const updateSetting = async (key, value) => {
  if (!db) return;
  await db.collection('settings').doc(key).set({ value: String(value) });
};

const getSettings = async () => {
  if (!db) return { center_lat: 30.0444, center_lon: 31.2357, center_radius: 100 };
  const latDoc = await db.collection('settings').doc('center_lat').get();
  const lonDoc = await db.collection('settings').doc('center_lon').get();
  const radDoc = await db.collection('settings').doc('center_radius').get();
  return {
    center_lat: latDoc.exists ? Number(latDoc.data().value) : 30.0444,
    center_lon: lonDoc.exists ? Number(lonDoc.data().value) : 31.2357,
    center_radius: radDoc.exists ? Number(radDoc.data().value) : 100
  };
};

// ----------------------------------------------------
// USERS (ADMIN & TEACHERS)
// ----------------------------------------------------
const getUserById = async (id) => {
  if (!db) return null;
  const doc = await db.collection('users').doc(id).get();
  return mapDoc(doc);
};

const getUserByUsername = async (username) => {
  if (!db) return null;
  const snapshot = await db.collection('users').where('username', '==', username).limit(1).get();
  if (snapshot.empty) return null;
  return mapDoc(snapshot.docs[0]);
};

const createUser = async (data) => {
  if (!db) return { id: null };
  const ref = await db.collection('users').add({
    username: data.username,
    password: data.password,
    role: data.role,
    name: data.name,
    phone: data.phone || '',
    rate_per_session: Number(data.rate_per_session) || 0,
    payment_type: data.payment_type || 'session',
    last_received_payment: data.last_received_payment || null
  });
  return { id: ref.id };
};

const updateUser = async (id, data) => {
  if (!db) return;
  const updates = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.rate_per_session !== undefined) updates.rate_per_session = Number(data.rate_per_session);
  if (data.payment_type !== undefined) updates.payment_type = data.payment_type;
  if (data.password !== undefined) updates.password = data.password;
  if (data.last_received_payment !== undefined) updates.last_received_payment = data.last_received_payment;
  
  await db.collection('users').doc(id).update(updates);
};

const deleteUser = async (id) => {
  if (!db) return;
  await db.collection('users').doc(id).delete();
  
  // Cascade delete attendance, adjustments, fake_gps_logs
  const batch = db.batch();
  
  const attSnapshot = await db.collection('attendance').where('teacher_id', '==', id).get();
  attSnapshot.docs.forEach(doc => batch.delete(doc.ref));
  
  const adjSnapshot = await db.collection('adjustments').where('teacher_id', '==', id).get();
  adjSnapshot.docs.forEach(doc => batch.delete(doc.ref));
  
  const gpsSnapshot = await db.collection('fake_gps_logs').where('teacher_id', '==', id).get();
  gpsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
  
  await batch.commit();
};

const getAllTeachers = async () => {
  if (!db) return [];
  const snapshot = await db.collection('users')
    .where('role', '==', 'teacher')
    .get();
  const teachers = [];
  snapshot.forEach(doc => teachers.push(mapDoc(doc)));
  teachers.sort((a, b) => a.name.localeCompare(b.name));
  return teachers;
};

// ----------------------------------------------------
// ATTENDANCE
// ----------------------------------------------------
const createAttendance = async (data) => {
  if (!db) return { id: null };
  const ref = await db.collection('attendance').add({
    teacher_id: data.teacher_id,
    date: data.date,
    check_in_time: data.check_in_time,
    check_out_time: data.check_out_time || null,
    check_in_lat: Number(data.check_in_lat),
    check_in_lon: Number(data.check_in_lon),
    check_out_lat: data.check_out_lat !== undefined && data.check_out_lat !== null ? Number(data.check_out_lat) : null,
    check_out_lon: data.check_out_lon !== undefined && data.check_out_lon !== null ? Number(data.check_out_lon) : null,
    sessions_count: Number(data.sessions_count) || 0,
    earnings: Number(data.earnings) || 0,
    status: data.status || 'present',
    is_fake_gps: Number(data.is_fake_gps) || 0,
    fake_gps_details: data.fake_gps_details || null,
    payment_status: data.payment_status || 'unpaid',
    payment_date: data.payment_date || null,
    check_in_type: data.check_in_type || 'gps'
  });
  return { id: ref.id };
};

const updateAttendance = async (id, data) => {
  if (!db) return;
  const updates = {};
  if (data.check_out_time !== undefined) updates.check_out_time = data.check_out_time;
  if (data.check_out_lat !== undefined) updates.check_out_lat = data.check_out_lat !== null ? Number(data.check_out_lat) : null;
  if (data.check_out_lon !== undefined) updates.check_out_lon = data.check_out_lon !== null ? Number(data.check_out_lon) : null;
  if (data.sessions_count !== undefined) updates.sessions_count = Number(data.sessions_count);
  if (data.earnings !== undefined) updates.earnings = Number(data.earnings);
  if (data.status !== undefined) updates.status = data.status;
  if (data.is_fake_gps !== undefined) updates.is_fake_gps = Number(data.is_fake_gps);
  if (data.fake_gps_details !== undefined) updates.fake_gps_details = data.fake_gps_details;
  if (data.payment_status !== undefined) updates.payment_status = data.payment_status;
  if (data.payment_date !== undefined) updates.payment_date = data.payment_date;
  
  await db.collection('attendance').doc(id).update(updates);
};

const getActiveAttendance = async (teacherId) => {
  if (!db) return null;
  const snapshot = await db.collection('attendance')
    .where('teacher_id', '==', teacherId)
    .where('status', '==', 'present')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return mapDoc(snapshot.docs[0]);
};

const getAttendanceById = async (id) => {
  if (!db) return null;
  const doc = await db.collection('attendance').doc(id).get();
  return mapDoc(doc);
};

const getAttendanceLogs = async (filters = {}) => {
  if (!db) return [];
  let query = db.collection('attendance');
  
  if (filters.teacher_id) {
    query = query.where('teacher_id', '==', filters.teacher_id);
  }
  if (filters.payment_status) {
    query = query.where('payment_status', '==', filters.payment_status);
  }
  if (filters.date) {
    query = query.where('date', '==', filters.date);
  }
  
  const snapshot = await query.get();
  let logs = [];
  snapshot.forEach(doc => logs.push(mapDoc(doc)));
  
  // Date filtering in-memory for start/end dates
  if (filters.start_date) {
    logs = logs.filter(l => l.date >= filters.start_date);
  }
  if (filters.end_date) {
    logs = logs.filter(l => l.date <= filters.end_date);
  }
  
  // Fetch users to join teacher details
  const usersSnapshot = await db.collection('users').get();
  const usersMap = {};
  usersSnapshot.forEach(doc => {
    usersMap[doc.id] = doc.data();
  });
  
  logs = logs.map(log => ({
    ...log,
    teacher_name: usersMap[log.teacher_id]?.name || 'Unknown',
    teacher_phone: usersMap[log.teacher_id]?.phone || '',
    rate_per_session: usersMap[log.teacher_id]?.rate_per_session || 0
  }));
  
  // Sort by date DESC, check_in_time DESC
  logs.sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return (b.check_in_time || '').localeCompare(a.check_in_time || '');
  });
  
  return logs;
};

const payAttendance = async (id, payDate) => {
  if (!db) return;
  await db.collection('attendance').doc(id).update({
    payment_status: 'paid',
    payment_date: payDate
  });
};

const payAllTeacherAttendance = async (teacherId, payDate) => {
  if (!db) return { changes: 0 };
  const snapshot = await db.collection('attendance')
    .where('teacher_id', '==', teacherId)
    .where('payment_status', '==', 'unpaid')
    .get();
  
  if (snapshot.empty) return { changes: 0 };
  
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      payment_status: 'paid',
      payment_date: payDate
    });
  });
  await batch.commit();
  return { changes: snapshot.size };
};

// ----------------------------------------------------
// ADJUSTMENTS (BONUSES & ADVANCES)
// ----------------------------------------------------
const createAdjustment = async (data) => {
  if (!db) return { id: null };
  const ref = await db.collection('adjustments').add({
    teacher_id: data.teacher_id,
    date: data.date,
    amount: Number(data.amount),
    type: data.type,
    description: data.description || '',
    payment_status: data.payment_status || 'unpaid',
    payment_date: data.payment_date || null
  });
  return { id: ref.id };
};

const getAdjustmentsByTeacher = async (teacherId) => {
  if (!db) return [];
  const snapshot = await db.collection('adjustments')
    .where('teacher_id', '==', teacherId)
    .get();
  const adjustments = [];
  snapshot.forEach(doc => adjustments.push(mapDoc(doc)));
  // Sort by date DESC, id DESC
  adjustments.sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return b.id.localeCompare(a.id);
  });
  return adjustments;
};

const payAllTeacherAdjustments = async (teacherId, payDate) => {
  if (!db) return { changes: 0 };
  const snapshot = await db.collection('adjustments')
    .where('teacher_id', '==', teacherId)
    .where('payment_status', '==', 'unpaid')
    .get();
  
  if (snapshot.empty) return { changes: 0 };
  
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      payment_status: 'paid',
      payment_date: payDate
    });
  });
  await batch.commit();
  return { changes: snapshot.size };
};

// ----------------------------------------------------
// FAKE GPS LOGS
// ----------------------------------------------------
const createFakeGpsLog = async (data) => {
  if (!db) return { id: null };
  const ref = await db.collection('fake_gps_logs').add({
    teacher_id: data.teacher_id,
    timestamp: data.timestamp || new Date().toISOString(),
    action_type: data.action_type,
    user_lat: data.user_lat !== null && data.user_lat !== undefined ? Number(data.user_lat) : null,
    user_lon: data.user_lon !== null && data.user_lon !== undefined ? Number(data.user_lon) : null,
    center_lat: data.center_lat !== null && data.center_lat !== undefined ? Number(data.center_lat) : null,
    center_lon: data.center_lon !== null && data.center_lon !== undefined ? Number(data.center_lon) : null,
    reason: data.reason || ''
  });
  return { id: ref.id };
};

const getFakeGpsLogs = async () => {
  if (!db) return [];
  const snapshot = await db.collection('fake_gps_logs').get();
  let logs = [];
  snapshot.forEach(doc => logs.push(mapDoc(doc)));
  
  // Fetch users to join teacher details
  const usersSnapshot = await db.collection('users').get();
  const usersMap = {};
  usersSnapshot.forEach(doc => {
    usersMap[doc.id] = doc.data();
  });
  
  logs = logs.map(log => ({
    ...log,
    teacher_name: usersMap[log.teacher_id]?.name || 'Unknown',
    teacher_phone: usersMap[log.teacher_id]?.phone || ''
  }));
  
  // Sort by timestamp DESC
  logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return logs;
};

// ----------------------------------------------------
// HIGH-LEVEL AGGREGATED STATS HELPERS
// ----------------------------------------------------
const getTeacherStats = async (teacherId, todayStr) => {
  if (!db) return {
    todayEarnings: 0, todaySessions: 0,
    monthlyEarnings: 0, monthlySessions: 0,
    yearlyEarnings: 0, yearlySessions: 0
  };
  
  const attSnapshot = await db.collection('attendance').where('teacher_id', '==', teacherId).get();
  const adjSnapshot = await db.collection('adjustments').where('teacher_id', '==', teacherId).get();
  
  const todayMonth = todayStr.slice(0, 7);
  const todayYear = todayStr.slice(0, 4);
  
  let todayEarnings = 0;
  let todaySessions = 0;
  let monthlyEarnings = 0;
  let monthlySessions = 0;
  let yearlyEarnings = 0;
  let yearlySessions = 0;
  
  attSnapshot.forEach(doc => {
    const data = doc.data();
    const isToday = data.date === todayStr;
    const isThisMonth = data.date.startsWith(todayMonth);
    const isThisYear = data.date.startsWith(todayYear);
    
    if (isToday) {
      todayEarnings += Number(data.earnings) || 0;
      todaySessions += Number(data.sessions_count) || 0;
    }
    if (isThisMonth) {
      monthlyEarnings += Number(data.earnings) || 0;
      monthlySessions += Number(data.sessions_count) || 0;
    }
    if (isThisYear) {
      yearlyEarnings += Number(data.earnings) || 0;
      yearlySessions += Number(data.sessions_count) || 0;
    }
  });
  
  adjSnapshot.forEach(doc => {
    const data = doc.data();
    const isToday = data.date === todayStr;
    const isThisMonth = data.date.startsWith(todayMonth);
    const isThisYear = data.date.startsWith(todayYear);
    
    if (isToday) {
      todayEarnings += Number(data.amount) || 0;
    }
    if (isThisMonth) {
      monthlyEarnings += Number(data.amount) || 0;
    }
    if (isThisYear) {
      yearlyEarnings += Number(data.amount) || 0;
    }
  });
  
  return {
    todayEarnings,
    todaySessions,
    monthlyEarnings,
    monthlySessions,
    yearlyEarnings,
    yearlySessions
  };
};

const getAdminDashboardStats = async (todayStr) => {
  if (!db) return {
    stats: { presentToday: 0, sessionsToday: 0, earningsToday: 0, earningsMonth: 0, earningsYear: 0 },
    charts: { topTeachers: [], trend: [] },
    livePresence: []
  };

  const todayMonth = todayStr.slice(0, 7);
  const todayYear = todayStr.slice(0, 4);

  const snapshot = await db.collection('attendance').get();
  const attLogs = [];
  snapshot.forEach(doc => attLogs.push(mapDoc(doc)));

  const usersSnapshot = await db.collection('users').get();
  const usersMap = {};
  usersSnapshot.forEach(doc => {
    usersMap[doc.id] = doc.data();
  });

  const uniqueTeachersToday = new Set();
  let sessionsToday = 0;
  let earningsToday = 0;
  let earningsMonth = 0;
  let earningsYear = 0;
  
  const topTeachersMap = {};
  const livePresence = [];

  attLogs.forEach(log => {
    const isToday = log.date === todayStr;
    const isThisMonth = log.date.startsWith(todayMonth);
    const isThisYear = log.date.startsWith(todayYear);

    if (isToday) {
      uniqueTeachersToday.add(log.teacher_id);
      sessionsToday += Number(log.sessions_count) || 0;
      earningsToday += Number(log.earnings) || 0;
      
      if (log.status === 'present') {
        livePresence.push({
          teacher_id: log.teacher_id,
          name: usersMap[log.teacher_id]?.name || 'Unknown',
          phone: usersMap[log.teacher_id]?.phone || '',
          check_in_time: log.check_in_time,
          check_in_type: log.check_in_type || 'gps'
        });
      }
    }

    if (isThisMonth) {
      earningsMonth += Number(log.earnings) || 0;
      
      if (usersMap[log.teacher_id]?.role === 'teacher') {
        if (!topTeachersMap[log.teacher_id]) {
          topTeachersMap[log.teacher_id] = {
            name: usersMap[log.teacher_id]?.name || 'Unknown',
            total_sessions: 0,
            days_present: 0
          };
        }
        topTeachersMap[log.teacher_id].total_sessions += Number(log.sessions_count) || 0;
        topTeachersMap[log.teacher_id].days_present += 1;
      }
    }

    if (isThisYear) {
      earningsYear += Number(log.earnings) || 0;
    }
  });

  const topTeachers = Object.values(topTeachersMap)
    .sort((a, b) => b.total_sessions - a.total_sessions)
    .slice(0, 6);

  const last7DaysTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = attLogs.filter(l => l.date === dateStr).length;
    last7DaysTrend.push({
      date: dateStr.slice(5),
      count: count
    });
  }

  return {
    stats: {
      presentToday: uniqueTeachersToday.size,
      sessionsToday,
      earningsToday,
      earningsMonth,
      earningsYear
    },
    charts: {
      topTeachers,
      trend: last7DaysTrend
    },
    livePresence
  };
};

const getTeachersListWithStats = async (todayStr) => {
  if (!db) return [];

  const todayMonth = todayStr.slice(0, 7);
  const todayYear = todayStr.slice(0, 4);

  const teachers = await getAllTeachers();
  const attSnapshot = await db.collection('attendance').get();
  const adjSnapshot = await db.collection('adjustments').get();

  const attLogs = [];
  attSnapshot.forEach(doc => attLogs.push(mapDoc(doc)));

  const adjustments = [];
  adjSnapshot.forEach(doc => adjustments.push(mapDoc(doc)));

  return teachers.map(t => {
    let total_attendance_days = 0;
    let total_sessions = 0;
    let unpaid_attendance = 0;
    let unpaid_adjustments = 0;
    let paid_attendance = 0;
    let paid_adjustments = 0;
    let earnings_today = 0;
    let earnings_month = 0;
    let earnings_year = 0;

    attLogs.forEach(log => {
      if (log.teacher_id === t.id) {
        total_attendance_days += 1;
        total_sessions += Number(log.sessions_count) || 0;
        
        const earnings = Number(log.earnings) || 0;
        if (log.payment_status === 'unpaid') {
          unpaid_attendance += earnings;
        } else if (log.payment_status === 'paid') {
          paid_attendance += earnings;
        }

        if (log.date === todayStr) {
          earnings_today += earnings;
        }
        if (log.date.startsWith(todayMonth)) {
          earnings_month += earnings;
        }
        if (log.date.startsWith(todayYear)) {
          earnings_year += earnings;
        }
      }
    });

    adjustments.forEach(adj => {
      if (adj.teacher_id === t.id) {
        const amount = Number(adj.amount) || 0;
        if (adj.payment_status === 'unpaid') {
          unpaid_adjustments += amount;
        } else if (adj.payment_status === 'paid') {
          paid_adjustments += amount;
        }

        if (adj.date === todayStr) {
          earnings_today += amount;
        }
        if (adj.date.startsWith(todayMonth)) {
          earnings_month += amount;
        }
        if (adj.date.startsWith(todayYear)) {
          earnings_year += amount;
        }
      }
    });

    const unpaidNet = unpaid_attendance + unpaid_adjustments;
    const paidNet = paid_attendance + paid_adjustments;

    return {
      id: t.id,
      username: t.username,
      name: t.name,
      phone: t.phone,
      rate_per_session: t.rate_per_session,
      payment_type: t.payment_type,
      last_received_payment: t.last_received_payment,
      total_attendance_days,
      total_sessions,
      unpaid_earnings: unpaidNet >= 0 ? unpaidNet : 0,
      raw_unpaid_earnings: unpaidNet,
      paid_earnings: paidNet,
      earnings_today,
      earnings_month,
      earnings_year
    };
  });
};

// ----------------------------------------------------
// DATABASE SEEDING / INITIALIZATION
// ----------------------------------------------------
const initDB = async () => {
  if (!db) return;
  try {
    const centerLat = await getSetting('center_lat');
    if (!centerLat) {
      await updateSetting('center_lat', '30.0444');
      await updateSetting('center_lon', '31.2357');
      await updateSetting('center_radius', '100');
      console.log("Seeded default settings in Firestore.");
    }

    const adminUser = await getUserByUsername('admin');
    if (!adminUser) {
      const hashedAdminPassword = await bcrypt.hash('admin123', 10);
      await createUser({
        username: 'admin',
        password: hashedAdminPassword,
        role: 'admin',
        name: 'System Administrator',
        phone: '01000000000',
        rate_per_session: 0,
        payment_type: 'monthly'
      });
      console.log("Seeded default admin in Firestore.");
    }

    const testTeacher = await getUserByUsername('teacher1');
    if (!testTeacher) {
      const hashedTeacherPassword = await bcrypt.hash('teacher123', 10);
      await createUser({
        username: 'teacher1',
        password: hashedTeacherPassword,
        role: 'teacher',
        name: 'John Doe',
        phone: '01234567890',
        rate_per_session: 150.00,
        payment_type: 'session'
      });
      console.log("Seeded default test teacher in Firestore.");
    }

    console.log("Database initialized successfully!");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
};

module.exports = {
  db,
  getSetting,
  updateSetting,
  getSettings,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  getAllTeachers,
  createAttendance,
  updateAttendance,
  getActiveAttendance,
  getAttendanceById,
  getAttendanceLogs,
  payAttendance,
  payAllTeacherAttendance,
  createAdjustment,
  getAdjustmentsByTeacher,
  payAllTeacherAdjustments,
  createFakeGpsLog,
  getFakeGpsLogs,
  getTeacherStats,
  getAdminDashboardStats,
  getTeachersListWithStats,
  initDB
};
