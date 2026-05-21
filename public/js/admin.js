// Admin Dashboard Logic

let topTeachersChart = null;
let trendChart = null;
let mapInstance = null;
let mapMarker = null;
let mapCircle = null;
let cachedTeachers = [];
let lastFetchedAttendanceLogs = [];

let viewMapInstance = null;
let viewMapMarker = null;
let viewMapCircle = null;
let viewTeacherMarker = null;

// On Page Load
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify admin session
  const admin = await Auth.checkSession('admin');
  if (admin) {
    document.getElementById('adminName').innerText = admin.name;
    document.getElementById('adminInitial').innerText = admin.name.charAt(0).toUpperCase();
    
    // 2. Load dashboard data
    loadDashboard();
  }
});

// Switch Sidebar Tabs
function switchTab(tabId, element) {
  // Remove active state from all links
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
  // Add active state to selected sidebar link
  if (element) element.classList.add('active');

  // Update Page Title in header
  const titleMap = {
    'dashboard': 'Admin Dashboard',
    'teachers': 'Manage Faculty / Teachers',
    'settings': 'Center Geofencing Settings',
    'attendance': 'Detailed Attendance Register',
    'security': 'Spoof & Security Logs'
  };
  document.getElementById('pageTitle').innerText = titleMap[tabId] || 'Admin Dashboard';

  // Toggle Tab visibility
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById(`${tabId}Tab`).classList.add('active');

  // Load target tab data
  if (tabId === 'dashboard') {
    loadDashboard();
  } else if (tabId === 'teachers') {
    fetchTeachers();
  } else if (tabId === 'attendance') {
    fetchAttendanceLogs();
  } else if (tabId === 'security') {
    fetchSecurityLogs();
  }
}

// Toggle Sidebar on Mobile viewports
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('active');
}

// ----------------------------------------------------
// 1. DASHBOARD COMPONENT
// ----------------------------------------------------
async function loadDashboard() {
  Auth.setLoading(true);
  try {
    const response = await fetch('/api/admin/dashboard');
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      // Set metrics
      document.getElementById('statPresentToday').innerText = data.stats.presentToday;
      document.getElementById('statSessionsToday').innerText = data.stats.sessionsToday;
      document.getElementById('statEarningsToday').innerText = `$${Number(data.stats.earningsToday).toFixed(2)}`;
      document.getElementById('statEarningsMonth').innerText = `$${Number(data.stats.earningsMonth).toFixed(2)}`;
      document.getElementById('statEarningsYear').innerText = `$${Number(data.stats.earningsYear).toFixed(2)}`;

      // Render Charts
      renderTopTeachersChart(data.charts.topTeachers);
      renderTrendChart(data.charts.trend);

      // Render Live Presence List
      renderLivePresenceList(data.livePresence);
    } else {
      Auth.showToast(data.message || 'Error loading dashboard.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Load dashboard error:', error);
  }
}

function renderLivePresenceList(presenceList) {
  const container = document.getElementById('livePresenceList');
  container.innerHTML = '';

  if (presenceList && presenceList.length > 0) {
    presenceList.forEach(teacher => {
      const row = document.createElement('div');
      row.style = 'display:flex; justify-content:space-between; align-items:center; padding:12px 10px; border-bottom:1px solid var(--glass-border); font-size:0.9rem;';

      const typeBadge = teacher.check_in_type === 'qr_code'
        ? '<span class="badge badge-info" style="font-size:0.75rem; padding:2px 8px;">QR Code Fallback</span>'
        : '<span class="badge badge-success" style="font-size:0.75rem; padding:2px 8px;">GPS Confirmed</span>';

      row.innerHTML = `
        <div>
          <strong style="color:var(--text-primary); font-size:0.95rem;">${teacher.name}</strong> 
          <span style="font-size:0.8rem; color:var(--text-muted); margin-left:6px;">(${teacher.phone || 'no phone'})</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          ${typeBadge}
          <span style="color:var(--text-secondary); font-size:0.85rem;">Checked In at <code>${teacher.check_in_time}</code></span>
        </div>
      `;
      container.appendChild(row);
    });
  } else {
    container.innerHTML = `
      <p style="color:var(--text-muted); font-size:0.9rem; text-align:center; padding:25px 0;">
        No teachers checked in currently.
      </p>
    `;
  }
}

function renderTopTeachersChart(teachersData) {
  const ctx = document.getElementById('topTeachersChart').getContext('2d');
  
  if (topTeachersChart) {
    topTeachersChart.destroy();
  }

  const labels = teachersData.map(t => t.name);
  const sessions = teachersData.map(t => t.total_sessions);

  topTeachersChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No lectures logged'],
      datasets: [{
        label: 'Sessions Completed',
        data: sessions.length > 0 ? sessions : [0],
        backgroundColor: 'rgba(99, 102, 241, 0.4)',
        borderColor: '#6366f1',
        borderWidth: 1.5,
        borderRadius: 6,
        hoverBackgroundColor: 'rgba(99, 102, 241, 0.7)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', stepSize: 1 }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8' }
        }
      }
    }
  });
}

function renderTrendChart(trendData) {
  const ctx = document.getElementById('attendanceTrendChart').getContext('2d');
  
  if (trendChart) {
    trendChart.destroy();
  }

  const labels = trendData.map(t => t.date);
  const counts = trendData.map(t => t.count);

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Check-ins',
        data: counts,
        backgroundColor: 'rgba(6, 182, 212, 0.1)',
        borderColor: '#06b6d4',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointBackgroundColor: '#06b6d4'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', stepSize: 1 }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8' }
        }
      }
    }
  });
}

// ----------------------------------------------------
// 2. TEACHERS CRUD COMPONENT
// ----------------------------------------------------
async function fetchTeachers() {
  try {
    const response = await fetch('/api/admin/teachers');
    const data = await response.json();
    if (data.success) {
      cachedTeachers = data.teachers;
      
      // Populate teacher filter dropdown in attendance tab
      const filterSelect = document.getElementById('filterTeacher');
      if (filterSelect) {
        filterSelect.innerHTML = '<option value="">All Teachers</option>';
        data.teachers.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.innerText = t.name;
          filterSelect.appendChild(opt);
        });
      }

      const tbody = document.getElementById('teachersTableBody');
      tbody.innerHTML = '';
      
      data.teachers.forEach(teacher => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${teacher.name}</strong></td>
          <td><code>${teacher.username}</code></td>
          <td>${teacher.phone || '-'}</td>
          <td>$${Number(teacher.rate_per_session).toFixed(2)}</td>
          <td><span class="badge badge-info">${teacher.payment_type === 'session' ? 'Per Session' : 'Monthly'}</span></td>
          <td style="color: var(--color-danger); font-weight:600;">$${Number(teacher.unpaid_earnings).toFixed(2)}</td>
          <td style="color: var(--color-success); font-weight:600;">$${Number(teacher.paid_earnings).toFixed(2)}</td>
          <td>${teacher.total_sessions || 0}</td>
          <td>
            <div class="action-buttons">
              <button class="action-btn edit" onclick="openTeacherModal(${teacher.id})" title="Edit Teacher">✏️</button>
              <button class="action-btn edit" style="background:#8b5cf6;" onclick="openAdjustmentsModal(${teacher.id}, '${teacher.name.replace(/'/g, "\\'")}')" title="Financial Ledger (Advances & Bonuses)">💵 Ledger</button>
              <button class="action-btn delete" onclick="deleteTeacher(${teacher.id})" title="Delete Teacher">🗑️</button>
              ${teacher.unpaid_earnings > 0 ? 
                `<button class="action-btn pay" onclick="settleTeacherPayments(${teacher.id})" title="Settle Unpaid Payouts">💰 Settle</button>` : 
                `<button class="action-btn pay" style="opacity:0.3; cursor:default;" disabled title="All Settled">✅</button>`
              }
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (error) {
    console.error('Fetch teachers error:', error);
  }
}

function openTeacherModal(id = null) {
  const modal = document.getElementById('teacherModal');
  const form = document.getElementById('teacherForm');
  form.reset();

  if (id) {
    document.getElementById('modalTitle').innerText = 'Edit Teacher Profile';
    document.getElementById('teacherId').value = id;
    document.getElementById('tPasswordGroup').style.display = 'none';
    document.getElementById('tPassword').required = false;
    document.getElementById('tEditPasswordGroup').style.display = 'block';

    // Fetch and populate teacher details
    fetch('/api/admin/teachers')
      .then(res => res.json())
      .then(data => {
        const teacher = data.teachers.find(t => t.id === id);
        if (teacher) {
          document.getElementById('tName').value = teacher.name;
          document.getElementById('tUsername').value = teacher.username;
          document.getElementById('tUsername').disabled = true; // Username is immutable
          document.getElementById('tPhone').value = teacher.phone;
          document.getElementById('tRate').value = teacher.rate_per_session;
          document.getElementById('tPayment').value = teacher.payment_type;
        }
      });
  } else {
    document.getElementById('modalTitle').innerText = 'Add New Teacher';
    document.getElementById('teacherId').value = '';
    document.getElementById('tUsername').disabled = false;
    document.getElementById('tPasswordGroup').style.display = 'block';
    document.getElementById('tPassword').required = true;
    document.getElementById('tEditPasswordGroup').style.display = 'none';
  }

  modal.classList.add('active');
}

function closeTeacherModal() {
  document.getElementById('teacherModal').classList.remove('active');
}

async function handleTeacherSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('teacherId').value;
  const url = id ? `/api/admin/teachers/${id}` : '/api/admin/teachers';
  const method = id ? 'PUT' : 'POST';

  const bodyData = {
    name: document.getElementById('tName').value,
    phone: document.getElementById('tPhone').value,
    rate_per_session: Number(document.getElementById('tRate').value),
    payment_type: document.getElementById('tPayment').value
  };

  if (id) {
    bodyData.password = document.getElementById('tEditPassword').value;
  } else {
    bodyData.username = document.getElementById('tUsername').value;
    bodyData.password = document.getElementById('tPassword').value;
  }

  Auth.setLoading(true);
  try {
    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      closeTeacherModal();
      fetchTeachers();
    } else {
      Auth.showToast(data.message || 'Error occurred.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Teacher submit error:', error);
  }
}

async function deleteTeacher(id) {
  if (!confirm('Are you sure you want to delete this teacher? This will permanently wipe their attendance history.')) return;

  Auth.setLoading(true);
  try {
    const response = await fetch(`/api/admin/teachers/${id}`, { method: 'DELETE' });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      fetchTeachers();
    } else {
      Auth.showToast(data.message || 'Error deleting teacher.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Delete teacher error:', error);
  }
}

async function settleTeacherPayments(id) {
  if (!confirm('Are you sure you want to mark all pending sessions and financial adjustments for this teacher as settled/paid?')) return;

  Auth.setLoading(true);
  try {
    const response = await fetch(`/api/admin/teachers/${id}/pay-all`, { method: 'POST' });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      fetchTeachers();
    } else {
      Auth.showToast(data.message || 'Error settling payouts.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Settle payouts error:', error);
  }
}

// ----------------------------------------------------
// 3. FINANCIAL ADJUSTMENTS LEDGER MODAL
// ----------------------------------------------------
async function openAdjustmentsModal(teacherId, name) {
  const modal = document.getElementById('adjustmentsModal');
  document.getElementById('adjustmentsTitle').innerText = `Adjustments Ledger: ${name}`;
  document.getElementById('adjTeacherId').value = teacherId;
  document.getElementById('adjustmentForm').reset();
  
  const teacher = cachedTeachers.find(t => t.id === teacherId);
  if (teacher) {
    document.getElementById('ledgerStatToday').innerText = `$${Number(teacher.earnings_today).toFixed(2)}`;
    document.getElementById('ledgerStatMonth').innerText = `$${Number(teacher.earnings_month).toFixed(2)}`;
    document.getElementById('ledgerStatYear').innerText = `$${Number(teacher.earnings_year).toFixed(2)}`;
  } else {
    document.getElementById('ledgerStatToday').innerText = '$0.00';
    document.getElementById('ledgerStatMonth').innerText = '$0.00';
    document.getElementById('ledgerStatYear').innerText = '$0.00';
  }
  
  modal.classList.add('active');
  await fetchAdjustmentsList(teacherId);
}

function closeAdjustmentsModal() {
  document.getElementById('adjustmentsModal').classList.remove('active');
}

async function fetchAdjustmentsList(teacherId) {
  try {
    const res = await fetch(`/api/admin/teachers/${teacherId}/adjustments`);
    const data = await res.json();
    
    if (data.success) {
      const listContainer = document.getElementById('adjustmentsList');
      listContainer.innerHTML = '';
      
      if (data.adjustments.length === 0) {
        listContainer.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No ledger adjustments logged.</td></tr>';
        return;
      }
      
      data.adjustments.forEach(adj => {
        const tr = document.createElement('tr');
        
        let typeBadge = adj.type === 'bonus' 
          ? '<span class="badge badge-success">Bonus</span>' 
          : '<span class="badge badge-danger">Advance</span>';
          
        let amountText = adj.type === 'bonus' 
          ? `<span style="color:var(--color-success); font-weight:600;">+$${Math.abs(adj.amount).toFixed(2)}</span>`
          : `<span style="color:var(--color-danger); font-weight:600;">-$${Math.abs(adj.amount).toFixed(2)}</span>`;
          
        let statusBadge = adj.payment_status === 'paid'
          ? `<span class="badge badge-success" title="Paid on ${adj.payment_date.slice(0, 10)}">Settled</span>`
          : '<span class="badge badge-danger">Unpaid</span>';
          
        tr.innerHTML = `
          <td><code>${adj.date}</code></td>
          <td>${typeBadge}</td>
          <td>${amountText}</td>
          <td>${statusBadge}</td>
        `;
        listContainer.appendChild(tr);
      });
    }
  } catch (error) {
    console.error('Fetch adjustments error:', error);
  }
}

async function handleAdjustmentSubmit(e) {
  e.preventDefault();
  const teacherId = document.getElementById('adjTeacherId').value;
  
  const bodyData = {
    type: document.getElementById('adjType').value,
    amount: Number(document.getElementById('adjAmount').value),
    description: document.getElementById('adjDesc').value
  };
  
  Auth.setLoading(true);
  try {
    const response = await fetch(`/api/admin/teachers/${teacherId}/adjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    const data = await response.json();
    Auth.setLoading(false);
    
    if (data.success) {
      Auth.showToast(data.message, 'success');
      document.getElementById('adjustmentForm').reset();
      await fetchAdjustmentsList(teacherId);
      // Reload main teachers list to show updated balance
      fetchTeachers();
    } else {
      Auth.showToast(data.message || 'Error saving adjustment.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Adjustment submit error:', error);
  }
}

// ----------------------------------------------------
// 4. ATTENDANCE QR GENERATOR MODAL
// ----------------------------------------------------
async function openQrModal() {
  const modal = document.getElementById('qrModal');
  const img = document.getElementById('qrCodeImg');
  const tokenLabel = document.getElementById('qrTokenVal');
  
  img.src = '';
  img.alt = 'Generating QR...';
  tokenLabel.innerText = 'Calculating daily token...';
  modal.classList.add('active');

  try {
    const response = await fetch('/api/admin/qr-token');
    const data = await response.json();
    
    if (data.success) {
      // Set image source using secure QR server API
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${data.token}`;
      tokenLabel.innerHTML = `Token: <code style="color:#6366f1;">${data.token}</code><br>Date: ${data.date}`;
    } else {
      img.alt = 'Error generating QR token.';
      Auth.showToast('Could not fetch daily QR token.', 'error');
    }
  } catch (error) {
    img.alt = 'Network error generating QR.';
    console.error(error);
  }
}

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('active');
}

// ----------------------------------------------------
// 5. GEOFENCE MAP COMPONENT (Leaflet)
// ----------------------------------------------------
async function initSettingsMap() {
  try {
    const response = await fetch('/api/admin/settings');
    const data = await response.json();
    
    if (data.success) {
      const lat = data.settings.center_lat;
      const lon = data.settings.center_lon;
      const radius = data.settings.center_radius;

      document.getElementById('centerLat').value = lat;
      document.getElementById('centerLon').value = lon;
      document.getElementById('centerRadius').value = radius;

      // Leaflet map initialization
      setTimeout(() => {
        if (!mapInstance) {
          mapInstance = L.map('map').setView([lat, lon], 16);
          
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
          }).addTo(mapInstance);

          // Add draggable marker
          mapMarker = L.marker([lat, lon], { draggable: true }).addTo(mapInstance);
          mapCircle = L.circle([lat, lon], {
            radius: radius,
            color: '#6366f1',
            fillColor: '#6366f1',
            fillOpacity: 0.15
          }).addTo(mapInstance);

          // Marker drag listeners
          mapMarker.on('dragend', () => {
            const pos = mapMarker.getLatLng();
            document.getElementById('centerLat').value = pos.lat.toFixed(6);
            document.getElementById('centerLon').value = pos.lng.toFixed(6);
            mapCircle.setLatLng(pos);
          });

          // Map click listeners to reposition marker
          mapInstance.on('click', (e) => {
            const pos = e.latlng;
            mapMarker.setLatLng(pos);
            mapCircle.setLatLng(pos);
            document.getElementById('centerLat').value = pos.lat.toFixed(6);
            document.getElementById('centerLon').value = pos.lng.toFixed(6);
          });
          
          // Radius input change trigger
          document.getElementById('centerRadius').addEventListener('input', (e) => {
            const rad = Number(e.target.value);
            if (rad > 0 && mapCircle) {
              mapCircle.setRadius(rad);
            }
          });

        } else {
          // Re-center if map already exists
          const latlng = new L.LatLng(lat, lon);
          mapInstance.setView(latlng, 16);
          mapMarker.setLatLng(latlng);
          mapCircle.setLatLng(latlng);
          mapCircle.setRadius(radius);
          mapInstance.invalidateSize();
        }
      }, 200);
    }
  } catch (error) {
    console.error('Settings map init error:', error);
  }
}

async function saveGeofenceSettings(e) {
  e.preventDefault();
  
  const bodyData = {
    center_lat: Number(document.getElementById('centerLat').value),
    center_lon: Number(document.getElementById('centerLon').value),
    center_radius: Number(document.getElementById('centerRadius').value)
  };

  Auth.setLoading(true);
  try {
    const response = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      // Update map circle representation
      mapCircle.setRadius(bodyData.center_radius);
    } else {
      Auth.showToast(data.message || 'Error updating settings.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Save geofence settings error:', error);
  }
}

function useCurrentGPSLocation() {
  if (!navigator.geolocation) {
    Auth.showToast('GPS is not supported by your browser.', 'error');
    return;
  }
  
  Auth.setLoading(true);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      Auth.setLoading(false);
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      
      document.getElementById('centerLat').value = lat.toFixed(6);
      document.getElementById('centerLon').value = lon.toFixed(6);
      
      const latlng = new L.LatLng(lat, lon);
      if (mapInstance) {
        mapInstance.setView(latlng, 16);
        mapMarker.setLatLng(latlng);
        mapCircle.setLatLng(latlng);
      }
      Auth.showToast('Location updated from your GPS successfully.', 'success');
    },
    (error) => {
      Auth.setLoading(false);
      let msg = 'Could not retrieve GPS location.';
      if (error.code === error.PERMISSION_DENIED) {
        msg = 'GPS Permission Denied. Please allow location access.';
      }
      Auth.showToast(msg, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function printCenterPoster() {
  const teacherUrl = window.location.origin + '/teacher/index.html';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(teacherUrl)}`;
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <title>Print Check-In Poster</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');
          body {
            font-family: 'Outfit', 'Segoe UI', sans-serif;
            text-align: center;
            padding: 50px 20px;
            color: #1e293b;
            background: white;
          }
          .card {
            border: 3px solid #6366f1;
            border-radius: 24px;
            padding: 40px;
            max-width: 500px;
            margin: 0 auto;
            box-shadow: 0 10px 25px rgba(0,0,0,0.05);
          }
          h1 {
            color: #4f46e5;
            font-size: 2.2rem;
            margin-bottom: 5px;
            font-weight: 800;
          }
          .subtitle {
            font-size: 1.1rem;
            color: #64748b;
            margin-bottom: 30px;
          }
          .qr-container {
            margin: 30px 0;
            background: white;
            padding: 20px;
            border-radius: 16px;
            display: inline-block;
            box-shadow: 0 4px 15px rgba(0,0,0,0.08);
          }
          .qr-image {
            width: 260px;
            height: 260px;
            display: block;
          }
          .instructions {
            text-align: left;
            margin-top: 30px;
            background: #f8fafc;
            padding: 20px 25px;
            border-radius: 16px;
            border-left: 5px solid #6366f1;
          }
          .instructions h3 {
            margin-top: 0;
            color: #1e293b;
          }
          .instructions ol {
            margin: 0;
            padding-left: 20px;
            color: #475569;
            line-height: 1.6;
          }
          .footer {
            margin-top: 40px;
            font-size: 0.8rem;
            color: #94a3b8;
          }
          @media print {
            body { padding: 20px 0; }
            .card { box-shadow: none; border-color: #000; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Welcome to EASYTALK</h1>
          <div class="subtitle">Teacher GPS Check-in Portal</div>
          
          <div class="qr-container">
            <img class="qr-image" src="${qrUrl}" alt="EASYTALK Portal QR">
          </div>
          
          <div style="margin: 15px 0;">
            <code style="background:#f1f5f9; padding: 6px 12px; border-radius: 8px; font-size: 0.9rem; color:#4f46e5;">${teacherUrl}</code>
          </div>

          <div class="instructions" style="direction: ltr;">
            <h3>📲 How to Check-In / Out:</h3>
            <ol>
              <li>Scan the QR code above with your smartphone camera.</li>
              <li>Log in using your teacher credentials.</li>
              <li>Allow location/GPS access when prompted by the browser.</li>
              <li>Click <strong>Check-In</strong> to record your attendance.</li>
            </ol>
          </div>
          
          <div class="footer">
            Powered by EASYTALK Attendance System
          </div>
        </div>
        
        <div style="margin-top: 30px;">
          <button onclick="window.print()" style="background:#4f46e5; color:white; border:none; padding:12px 24px; border-radius:8px; font-size:1rem; cursor:pointer; font-weight:600; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.3);">🖨️ Print Poster</button>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ----------------------------------------------------
// 6. ATTENDANCE REGISTER COMPONENT
// ----------------------------------------------------
async function fetchAttendanceLogs() {
  try {
    const teacherId = document.getElementById('filterTeacher').value;
    const startDate = document.getElementById('filterStartDate').value;
    const endDate = document.getElementById('filterEndDate').value;
    const paymentStatus = document.getElementById('filterPaymentStatus').value;

    let url = '/api/admin/attendance';
    const params = new URLSearchParams();
    if (teacherId) params.append('teacher_id', teacherId);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (paymentStatus) params.append('payment_status', paymentStatus);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      lastFetchedAttendanceLogs = data.logs;
      const tbody = document.getElementById('attendanceTableBody');
      tbody.innerHTML = '';

      // Geofence settings to pass to map popup
      const cLat = Number(document.getElementById('centerLat').value) || 30.0444;
      const cLon = Number(document.getElementById('centerLon').value) || 31.2357;
      const cRad = Number(document.getElementById('centerRadius').value) || 100;

      data.logs.forEach(log => {
        const tr = document.createElement('tr');
        
        let statusBadge = `<span class="badge badge-success">Present</span>`;
        if (log.status === 'completed') {
          statusBadge = `<span class="badge badge-info">Completed</span>`;
        }

        let spoofBadge = `<span class="badge badge-success">No</span>`;
        if (log.is_fake_gps) {
          spoofBadge = `<span class="badge badge-danger" style="cursor:pointer;" onclick="openLocationMap('${log.teacher_name.replace(/'/g, "\\'")}', ${log.check_in_lat}, ${log.check_in_lon}, ${cLat}, ${cLon}, ${cRad}, '${(log.fake_gps_details || 'Bypassed Geofence').replace(/'/g, "\\'")}')" title="Click to view on Map">⚠️ Flagged</span>`;
        }

        let paymentBadge = `<span class="badge badge-danger">Unpaid</span>`;
        let payActionBtn = '';
        
        if (log.payment_status === 'paid') {
          paymentBadge = `<span class="badge badge-success" title="Paid on ${log.payment_date.slice(0, 10)}">Paid</span>`;
        } else if (log.status === 'completed' && log.earnings > 0) {
          payActionBtn = `<button class="action-btn pay" onclick="markRecordAsPaid(${log.id})" title="Mark this record as paid">💵 Pay</button>`;
        }

        const typeIndicator = log.check_in_type === 'qr_code'
          ? ' <span style="font-size:0.75rem; color:#8b5cf6;" title="Checked in via QR Code fallback">🎫</span>'
          : '';

        const mapActionBtn = `<button class="action-btn edit" style="background:#0284c7;" onclick="openLocationMap('${log.teacher_name.replace(/'/g, "\\'")}', ${log.check_in_lat}, ${log.check_in_lon}, ${cLat}, ${cLon}, ${cRad}, '${log.is_fake_gps ? (log.fake_gps_details || 'Bypassed Geofence').replace(/'/g, "\\'") : ''}')" title="View Check-In Map">🗺️ Map</button>`;

        tr.innerHTML = `
          <td><code>${log.date}</code></td>
          <td><strong>${log.teacher_name}</strong>${typeIndicator}</td>
          <td><code>${log.check_in_time}</code></td>
          <td><code>${log.check_out_time || '-'}</code></td>
          <td>${log.sessions_count || 0}</td>
          <td>$${Number(log.earnings).toFixed(2)}</td>
          <td>${statusBadge}</td>
          <td>${spoofBadge}</td>
          <td>${paymentBadge}</td>
          <td class="no-print">
            <div style="display:flex; gap:6px; align-items:center;">
              ${payActionBtn}
              ${mapActionBtn}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (error) {
    console.error('Fetch attendance logs error:', error);
  }
}

function applyAttendanceFilters() {
  fetchAttendanceLogs();
}

function clearAttendanceFilters() {
  document.getElementById('filterTeacher').value = '';
  document.getElementById('filterStartDate').value = '';
  document.getElementById('filterEndDate').value = '';
  document.getElementById('filterPaymentStatus').value = '';
  fetchAttendanceLogs();
}

async function markRecordAsPaid(id) {
  if (!confirm('Mark this single session record as paid?')) return;

  Auth.setLoading(true);
  try {
    const response = await fetch(`/api/admin/attendance/${id}/pay`, { method: 'POST' });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      fetchAttendanceLogs();
    } else {
      Auth.showToast(data.message || 'Error recording payment.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Pay record error:', error);
  }
}

// ----------------------------------------------------
// 7. SECURITY / SPOOF LOGS COMPONENT
// ----------------------------------------------------
async function fetchSecurityLogs() {
  try {
    const response = await fetch('/api/admin/fake-gps-logs');
    const data = await response.json();

    if (data.success) {
      const tbody = document.getElementById('securityTableBody');
      tbody.innerHTML = '';

      if (data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No spoof logs recorded yet. Geofence is secure.</td></tr>';
        return;
      }

      data.logs.forEach(log => {
        const tr = document.createElement('tr');
        
        let typeBadge = `<span class="badge badge-danger">Out of Range</span>`;
        if (log.action_type === 'check-in-warning') {
          typeBadge = `<span class="badge badge-warning">Accuracy Alert</span>`;
        } else if (log.action_type === 'anti-cheat-flag') {
          typeBadge = `<span class="badge badge-danger" style="background:rgba(244,63,94,0.3)">Anti-Cheat Flag</span>`;
        }

        const mapBtn = `<button class="action-btn edit" style="background:#0284c7;" onclick="openLocationMap('${log.teacher_name.replace(/'/g, "\\'")}', ${log.user_lat}, ${log.user_lon}, ${log.center_lat}, ${log.center_lon}, 100, '${log.reason.replace(/'/g, "\\'")}')" title="View Check-In Map">🗺️ Map</button>`;

        tr.innerHTML = `
          <td><code>${new Date(log.timestamp).toLocaleString()}</code></td>
          <td><strong>${log.teacher_name}</strong></td>
          <td>${typeBadge}</td>
          <td><code>${log.user_lat ? log.user_lat.toFixed(6) : '-'}, ${log.user_lon ? log.user_lon.toFixed(6) : '-'}</code></td>
          <td><code>${log.center_lat ? log.center_lat.toFixed(6) : '-'}, ${log.center_lon ? log.center_lon.toFixed(6) : '-'}</code></td>
          <td><span style="color:var(--color-danger);">${log.reason}</span></td>
          <td>${mapBtn}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (error) {
    console.error('Fetch security logs error:', error);
  }
}

// ----------------------------------------------------
// 8. SYSTEM MAINTENANCE MODE
// ----------------------------------------------------
let isMaintenanceMode = false;

async function toggleMaintenanceMode() {
  const response = await fetch('/api/admin/maintenance', { method: 'POST' });
  const data = await response.json();

  if (data.success) {
    isMaintenanceMode = data.enabled;
    const banner = document.getElementById('maintenanceBanner');

    if (isMaintenanceMode) {
      banner.style.display = 'block';
      Auth.showToast('System is now in maintenance mode', 'warning');
    } else {
      banner.style.display = 'none';
      Auth.showToast('Maintenance mode disabled', 'success');
    }
  }
}

// Add banner at the top of the body
const maintenanceBanner = `
  <div id="maintenanceBanner" style="display: none; background: #d97706; color: white; padding: 10px; text-align: center; position: fixed; top: 0; left: 0; right: 0; z-index: 9999;">
    ⚠️ System Maintenance Mode - Teacher check-ins are temporarily disabled
  </div>
`;
document.body.insertAdjacentHTML('afterbegin', maintenanceBanner);

// ----------------------------------------------------
// 9. PREMIUM ENHANCEMENTS: REPORTING, INVOICING & MAPS
// ----------------------------------------------------

function exportAttendanceToCSV() {
  if (!lastFetchedAttendanceLogs || lastFetchedAttendanceLogs.length === 0) {
    Auth.showToast('No logs available to export.', 'warning');
    return;
  }

  // Define CSV headers
  const headers = ['Date', 'Teacher Name', 'Check-In', 'Check-Out', 'Sessions', 'Earnings ($)', 'Status', 'Spoofed GPS', 'Payment Status'];
  
  // Map data to rows
  const rows = lastFetchedAttendanceLogs.map(log => [
    log.date,
    `"${log.teacher_name.replace(/"/g, '""')}"`,
    log.check_in_time,
    log.check_out_time || '-',
    log.sessions_count || 0,
    Number(log.earnings).toFixed(2),
    log.status === 'completed' ? 'Completed' : 'Present',
    log.is_fake_gps ? '⚠️ Flagged' : 'No',
    log.payment_status === 'paid' ? 'Paid' : 'Unpaid'
  ]);

  // Combine headers and rows with UTF-8 BOM to prevent Excel encoding issues
  const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  
  // Trigger client-side file download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `EASYTALK_Attendance_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  Auth.showToast('Attendance report exported successfully.', 'success');
}

async function printTeacherInvoice() {
  const teacherId = document.getElementById('adjTeacherId').value;
  const teacher = cachedTeachers.find(t => t.id == teacherId);
  if (!teacher) return;

  try {
    Auth.setLoading(true);
    const [adjRes, attRes] = await Promise.all([
      fetch(`/api/admin/teachers/${teacherId}/adjustments`).then(r => r.json()),
      fetch(`/api/admin/attendance?teacher_id=${teacherId}`).then(r => r.json())
    ]);
    Auth.setLoading(false);

    if (!adjRes.success || !attRes.success) {
      Auth.showToast('Could not load transaction data for printing.', 'error');
      return;
    }

    const adjustments = adjRes.adjustments;
    const attendanceLogs = attRes.logs;

    const printWindow = window.open('', '_blank');
    
    let ledgerRowsHtml = '';
    let totalUnpaid = 0;
    let totalPaid = 0;
    
    // Process attendance logs
    attendanceLogs.forEach(log => {
      const isPaid = log.payment_status === 'paid';
      const amt = Number(log.earnings);
      if (isPaid) totalPaid += amt;
      else totalUnpaid += amt;
      
      ledgerRowsHtml += `
        <tr>
          <td>${log.date}</td>
          <td>Lecture Check-in (${log.sessions_count || 0} sessions)</td>
          <td style="color:${isPaid ? '#059669' : '#d97706'}">${isPaid ? 'Settled' : 'Unpaid'}</td>
          <td>+$${amt.toFixed(2)}</td>
        </tr>
      `;
    });

    // Process adjustments
    adjustments.forEach(adj => {
      const isPaid = adj.payment_status === 'paid';
      const isBonus = adj.type === 'bonus';
      const amt = Number(adj.amount) * (isBonus ? 1 : -1);
      
      if (isPaid) totalPaid += amt;
      else totalUnpaid += amt;
      
      ledgerRowsHtml += `
        <tr>
          <td>${adj.date}</td>
          <td>${isBonus ? 'Bonus: ' : 'Cash Advance: '}${adj.description || (isBonus ? 'Performance credit' : 'Deduction')}</td>
          <td style="color:${isPaid ? '#059669' : '#d97706'}">${isPaid ? 'Settled' : 'Unpaid'}</td>
          <td style="color:${amt < 0 ? '#dc2626' : '#059669'}">${amt >= 0 ? '+' : ''}$${amt.toFixed(2)}</td>
        </tr>
      `;
    });

    const netOutstanding = totalUnpaid;
    const totalSettled = totalPaid;

    printWindow.document.write(`
      <html>
        <head>
          <title>Financial Invoice - ${teacher.name}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap');
            body {
              font-family: 'Outfit', 'Segoe UI', sans-serif;
              color: #1e293b;
              background: white;
              padding: 40px;
              direction: ltr;
            }
            .invoice-box {
              max-width: 800px;
              margin: auto;
              border: 1px solid #e2e8f0;
              padding: 30px;
              border-radius: 12px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.02);
            }
            .header-table {
              width: 100%;
              margin-bottom: 30px;
              border-collapse: collapse;
            }
            .header-table td {
              vertical-align: top;
            }
            .title {
              font-size: 2rem;
              font-weight: 800;
              color: #4f46e5;
            }
            .meta-info {
              text-align: right;
            }
            .meta-info p {
              margin: 4px 0;
              font-size: 0.9rem;
              color: #475569;
            }
            .details-section {
              margin-bottom: 30px;
              background: #f8fafc;
              padding: 20px;
              border-radius: 8px;
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
            }
            .details-section p {
              margin: 4px 0;
              font-size: 0.95rem;
            }
            .ledger-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }
            .ledger-table th {
              background: #f1f5f9;
              border-bottom: 2px solid #e2e8f0;
              padding: 12px;
              text-align: left;
              font-weight: 600;
              font-size: 0.9rem;
            }
            .ledger-table td {
              border-bottom: 1px solid #e2e8f0;
              padding: 12px;
              font-size: 0.9rem;
            }
            .summary-table {
              width: 100%;
              margin-top: 30px;
              border-collapse: collapse;
            }
            .summary-table td {
              padding: 8px 12px;
              font-size: 1rem;
            }
            .summary-title {
              text-align: right;
              font-weight: 600;
            }
            .summary-val {
              text-align: right;
              width: 150px;
              font-weight: 600;
            }
            .outstanding-row {
              background: #fef2f2;
              color: #991b1b;
            }
            .outstanding-row td {
              font-weight: 700 !important;
              font-size: 1.1rem !important;
            }
            .footer {
              margin-top: 50px;
              text-align: center;
              font-size: 0.8rem;
              color: #94a3b8;
              border-top: 1px solid #e2e8f0;
              padding-top: 20px;
            }
            .btn-print {
              background: #4f46e5;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 1rem;
              cursor: pointer;
              font-weight: 600;
              display: block;
              margin: 20px auto 0 auto;
            }
            @media print {
              body { padding: 0; }
              .invoice-box { border: none; box-shadow: none; padding: 0; }
              .btn-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="invoice-box">
            <table class="header-table">
              <tr>
                <td>
                  <div class="title">EASYTALK</div>
                  <p style="color:#64748b; margin: 4px 0;">Teacher Payout Ledger Statement</p>
                </td>
                <td class="meta-info">
                  <p><strong>Statement Date:</strong> ${new Date().toLocaleDateString()}</p>
                  <p><strong>System ID:</strong> #T-${teacherId}</p>
                </td>
              </tr>
            </table>

            <div class="details-section">
              <div>
                <h4 style="margin: 0 0 10px 0; color: #4f46e5;">Faculty Details:</h4>
                <p><strong>Name:</strong> ${teacher.name}</p>
                <p><strong>Phone:</strong> ${teacher.phone || '-'}</p>
                <p><strong>Payout Rate:</strong> $${Number(teacher.rate_per_session).toFixed(2)} / Session</p>
              </div>
              <div style="border-left: 1px solid #e2e8f0; padding-left: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #4f46e5;">Account Type:</h4>
                <p><strong>Billing Type:</strong> ${teacher.payment_type === 'session' ? 'Per Session Payout' : 'Monthly Salary'}</p>
                <p><strong>Last Paid Date:</strong> ${teacher.last_received_payment || 'N/A'}</p>
              </div>
            </div>

            <h3 style="border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-top: 4px;">Transactions & Log Details</h3>
            <table class="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Transaction Description</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${ledgerRowsHtml || '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No transaction history found for this billing cycle.</td></tr>'}
              </tbody>
            </table>

            <table class="summary-table">
              <tr>
                <td colspan="2"></td>
                <td class="summary-title">Total Settled (Paid):</td>
                <td class="summary-val" style="color:#059669;">$${totalSettled.toFixed(2)}</td>
              </tr>
              <tr class="outstanding-row">
                <td colspan="2"></td>
                <td class="summary-title" style="text-align: right;">Total Outstanding Unpaid:</td>
                <td class="summary-val" style="text-align: right;">$${netOutstanding.toFixed(2)}</td>
              </tr>
            </table>

            <div class="footer">
              Thank you for being a part of EASYTALK Faculty team.<br>
              Generated automatically by EASYTALK Management System.
            </div>
          </div>
          
          <button class="btn-print" onclick="window.print()">🖨️ Print Statement / Invoice</button>
        </body>
      </html>
    `);
    printWindow.document.close();
  } catch (error) {
    console.error('Print invoice error:', error);
    Auth.showToast('Failed to load printable invoice.', 'error');
  }
}

function openLocationMap(teacherName, userLat, userLon, centerLat, centerLon, centerRadius, reason = '') {
  if (!userLat || !userLon) {
    Auth.showToast('Coordinates not registered for this event.', 'warning');
    return;
  }

  const modal = document.getElementById('locationModal');
  document.getElementById('locationModalTitle').innerText = `Location Check: ${teacherName}`;
  
  let detailsText = `
    <strong>Center Location:</strong> <code>${centerLat.toFixed(6)}, ${centerLon.toFixed(6)}</code> (Geofence Limit: ${centerRadius}m)<br>
    <strong>Teacher Location:</strong> <code>${userLat.toFixed(6)}, ${userLon.toFixed(6)}</code><br>
  `;
  if (reason) {
    detailsText += `<strong style="color:var(--color-danger);">Cheat Flag Warning:</strong> ${reason}`;
  }
  document.getElementById('locationModalDetails').innerHTML = detailsText;
  
  modal.classList.add('active');

  setTimeout(() => {
    if (!viewMapInstance) {
      viewMapInstance = L.map('viewMap').setView([centerLat, centerLon], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(viewMapInstance);
    } else {
      viewMapInstance.setView([centerLat, centerLon], 16);
    }

    // Clear previous markers
    if (viewMapMarker) viewMapInstance.removeLayer(viewMapMarker);
    if (viewMapCircle) viewMapInstance.removeLayer(viewMapCircle);
    if (viewTeacherMarker) viewMapInstance.removeLayer(viewTeacherMarker);

    // Draw limits
    viewMapCircle = L.circle([centerLat, centerLon], {
      radius: centerRadius,
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.15
    }).addTo(viewMapInstance);

    viewMapMarker = L.marker([centerLat, centerLon]).addTo(viewMapInstance).bindPopup('EASYTALK');

    const iconColor = reason ? '#ef4444' : '#3b82f6';
    const teacherIcon = L.divIcon({
      className: 'custom-view-icon',
      html: `<div style="background-color:${iconColor}; width:16px; height:16px; border:2px solid white; border-radius:50%; box-shadow:0 0 10px ${iconColor};"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    viewTeacherMarker = L.marker([userLat, userLon], { icon: teacherIcon }).addTo(viewMapInstance)
      .bindPopup(`${teacherName}'s Check-in Location`)
      .openPopup();

    const bounds = L.latLngBounds([
      [centerLat, centerLon],
      [userLat, userLon]
    ]);
    viewMapInstance.fitBounds(bounds, { padding: [50, 50] });
    viewMapInstance.invalidateSize();
  }, 250);
}

function closeLocationModal() {
  document.getElementById('locationModal').classList.remove('active');
}