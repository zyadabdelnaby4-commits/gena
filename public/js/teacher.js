// Teacher Mobile Web Portal Logic

let teacherMap = null;
let teacherMarker = null;
let centerCircle = null;

let currentLat = null;
let currentLon = null;
let currentAccuracy = null;

let centerLat = null;
let centerLon = null;
let centerRadius = null;

let isWatcherActive = false;

// HTML5 QR Scanner states
let qrScannerInstance = null;
let isQrScanning = false;

// Haversine formula to compute distance in meters (Client-side helper)
function calculateClientDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// On Page Load
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify teacher session
  const teacher = await Auth.checkSession('teacher');
  if (teacher) {
    await loadTeacherDashboard();
  }
});

// Load Dashboard Data & Geofence Coordinates
async function loadTeacherDashboard() {
  Auth.setLoading(true);
  try {
    const response = await fetch('/api/teacher/dashboard');
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      // Update profile info
      document.getElementById('tProfileName').innerText = data.profile.name;
      document.getElementById('tProfilePhone').innerText = data.profile.phone || 'N/A';
      document.getElementById('tProfileRate').innerText = `$${Number(data.profile.rate_per_session).toFixed(2)}`;
      document.getElementById('tProfilePayment').innerText = data.profile.payment_type + ' payout';
      document.getElementById('tProfileLastPayment').innerText = data.profile.last_received_payment || 'No payments received';

      // Update earnings summary
      document.getElementById('earningsToday').innerText = `$${Number(data.stats.todayEarnings).toFixed(2)}`;
      document.getElementById('sessionsToday').innerText = `${data.stats.todaySessions} session(s) logged`;
      document.getElementById('earningsMonth').innerText = `$${Number(data.stats.monthlyEarnings).toFixed(2)}`;
      document.getElementById('sessionsMonth').innerText = `${data.stats.monthlySessions} session(s) logged`;
      document.getElementById('earningsYear').innerText = `$${Number(data.stats.yearlyEarnings).toFixed(2)}`;
      document.getElementById('sessionsYear').innerText = `${data.stats.yearlySessions} session(s) logged`;

      // Cache center coordinates
      centerLat = data.center.lat;
      centerLon = data.center.lon;
      centerRadius = data.center.radius;

      // Initialize map & geolocation tracking
      initTeacherMap();
      startLocationTracking();
      loadTeacherLedger();

      // Configure Active Attendance UI status
      const banner = document.getElementById('activeStatusBanner');
      const checkinPanel = document.getElementById('checkinPanel');
      const checkoutPanel = document.getElementById('checkoutPanel');

      if (data.activeCheckin) {
        banner.className = 'status-banner checked-in';
        banner.innerText = `🟢 Checked In (Started at ${data.activeCheckin.check_in_time})`;
        checkinPanel.style.display = 'none';
        checkoutPanel.style.display = 'block';
        stopQrScanner(); // Just in case scanner was left active
      } else {
        banner.className = 'status-banner checked-out';
        banner.innerText = '🔴 Checked Out / Absent';
        checkinPanel.style.display = 'block';
        checkoutPanel.style.display = 'none';
      }
    } else {
      Auth.showToast(data.message || 'Error fetching dashboard stats.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    console.error('Teacher dashboard loading error:', error);
  }
}

// Instantiate Leaflet Map
function initTeacherMap() {
  if (teacherMap) return; // Prevent double creation

  teacherMap = L.map('teacherMap', { zoomControl: false }).setView([centerLat, centerLon], 17);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(teacherMap);

  // Add green geofence circle indicator
  centerCircle = L.circle([centerLat, centerLon], {
    radius: centerRadius,
    color: '#10b981',
    fillColor: '#10b981',
    fillOpacity: 0.12
  }).addTo(teacherMap);

  // Add marker for school/center location
  L.marker([centerLat, centerLon]).addTo(teacherMap)
    .bindPopup('EASYTALK')
    .openPopup();
}

// Watch Location in real-time
function startLocationTracking() {
  if (isWatcherActive) return;

  if (!navigator.geolocation) {
    updateGpsStatus('error', 'GPS not supported by your browser.');
    return;
  }

  const options = {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0
  };

  navigator.geolocation.watchPosition(handleLocationSuccess, handleLocationError, options);
  isWatcherActive = true;
}

// Success callback for Geolocation API
function handleLocationSuccess(position) {
  currentLat = position.coords.latitude;
  currentLon = position.coords.longitude;
  currentAccuracy = position.coords.accuracy;

  // Render current accuracy range
  document.getElementById('gpsAccuracy').innerText = `±${Math.round(currentAccuracy)}m`;

  if (!centerLat || !centerLon) return;

  const distance = calculateClientDistance(currentLat, currentLon, centerLat, centerLon);

  // Update map marker representing the teacher's current position
  const latlng = [currentLat, currentLon];
  if (!teacherMarker) {
    // Create custom blue pulsing dot or icon
    const blueDotIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div style="background-color:#3b82f6; width:14px; height:14px; border:2px solid white; border-radius:50%; box-shadow:0 0 8px #3b82f6;"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    teacherMarker = L.marker(latlng, { icon: blueDotIcon }).addTo(teacherMap);
  } else {
    teacherMarker.setLatLng(latlng);
  }

  // Adjust zoom bounds to fit both teacher and center
  const bounds = L.latLngBounds([
    [centerLat, centerLon],
    [currentLat, currentLon]
  ]);
  teacherMap.fitBounds(bounds, { padding: [40, 40] });

  // Evaluate range and toggle Check-In button
  const checkinBtn = document.getElementById('checkinBtn');
  const progressContainer = document.getElementById('distanceProgressContainer');
  const distanceTextVal = document.getElementById('distanceTextVal');
  const progressBar = document.getElementById('distanceProgressBar');

  if (progressContainer && distanceTextVal && progressBar) {
    progressContainer.style.display = 'block';
    distanceTextVal.innerText = `${distance.toFixed(0)}m (Geofence Limit: ${centerRadius}m)`;
    
    // Calculate a percentage where 100% means inside the center (0m away) and decreases as you move further away.
    // Scale it so that at 3 times centerRadius or more, the bar shows 0%.
    const maxScale = Math.max(centerRadius * 3, 300);
    let percent = 100 - (distance / maxScale) * 100;
    percent = Math.max(0, Math.min(100, percent));
    progressBar.style.width = `${percent}%`;
  }

  if (distance <= centerRadius) {
    updateGpsStatus('success', `Inside Range (${distance.toFixed(0)}m away)`);
    if (checkinBtn) checkinBtn.disabled = false;
    if (progressBar) progressBar.style.backgroundColor = 'var(--color-success)';
  } else {
    updateGpsStatus('warning', `Outside Range (${distance.toFixed(0)}m away)`);
    if (checkinBtn) checkinBtn.disabled = true;
    if (progressBar) progressBar.style.backgroundColor = 'var(--color-warning)';
  }
}

// Error callback for Geolocation API
function handleLocationError(error) {
  console.warn('Geolocation error:', error);
  let msg = 'Position unavailable.';
  if (error.code === error.PERMISSION_DENIED) {
    msg = 'Access Denied: Please enable GPS.';
  } else if (error.code === error.TIMEOUT) {
    msg = 'GPS signal timeout.';
  }
  updateGpsStatus('error', msg);
  
  const checkinBtn = document.getElementById('checkinBtn');
  if (checkinBtn) checkinBtn.disabled = true;
}

// Update Geolocation UI status dot and text description
function updateGpsStatus(state, message) {
  const dot = document.getElementById('gpsStatusDot');
  const txt = document.getElementById('gpsStatusText');

  dot.className = 'gps-dot';
  if (state === 'success') {
    dot.classList.add('active');
    txt.style.color = '#10b981';
  } else if (state === 'warning') {
    dot.classList.add('active');
    dot.style.backgroundColor = 'var(--color-warning)';
    dot.style.boxShadow = '0 0 8px var(--color-warning)';
    txt.style.color = 'var(--color-warning)';
  } else {
    dot.style.backgroundColor = 'var(--color-danger)';
    dot.style.boxShadow = '0 0 8px var(--color-danger)';
    txt.style.color = 'var(--color-danger)';
  }
  txt.innerText = message;
}

// Submit Check-In to API (GPS Method)
async function performCheckin() {
  if (currentLat === null || currentLon === null) {
    Auth.showToast('Waiting for GPS coordinates...', 'warning');
    return;
  }

  Auth.setLoading(true);
  try {
    const response = await fetch('/api/teacher/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: currentLat,
        lon: currentLon,
        accuracy: currentAccuracy
      })
    });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      loadTeacherDashboard();
    } else {
      Auth.showToast(data.message || 'Check-in failed.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    Auth.showToast('Network error during check-in.', 'error');
    console.error(error);
  }
}

// ----------------------------------------------------
// CAMERA-BASED QR CODE fallback scanner
// ----------------------------------------------------
function toggleQrScanner() {
  const readerDiv = document.getElementById('qrReader');
  const btn = document.getElementById('qrScanBtn');

  if (isQrScanning) {
    stopQrScanner();
  } else {
    readerDiv.style.display = 'block';
    btn.innerHTML = '<span>❌</span> Cancel QR Scanning';
    btn.style.background = 'var(--color-danger)';

    // Instantiate and start HTML5 QR Code Scanner
    qrScannerInstance = new Html5Qrcode("qrReader");
    qrScannerInstance.start(
      { facingMode: "environment" }, // Rear camera
      {
        fps: 10,
        qrbox: { width: 220, height: 220 }
      },
      onQrScanSuccess,
      onQrScanError
    ).catch(err => {
      console.error("Camera initialize error:", err);
      Auth.showToast("Could not access camera. Please check device permissions.", "error");
      stopQrScanner();
    });
    isQrScanning = true;
  }
}

function stopQrScanner() {
  const readerDiv = document.getElementById('qrReader');
  const btn = document.getElementById('qrScanBtn');

  if (!btn) return; // Prevent errors during dashboard reloads
  
  btn.innerHTML = '<span>📷</span> Scan Center QR Code';
  btn.style.background = '#8b5cf6';
  
  if (qrScannerInstance && isQrScanning) {
    qrScannerInstance.stop().then(() => {
      readerDiv.style.display = 'none';
      isQrScanning = false;
    }).catch(err => {
      console.error("Camera stop error:", err);
      readerDiv.style.display = 'none';
      isQrScanning = false;
    });
  } else {
    readerDiv.style.display = 'none';
    isQrScanning = false;
  }
}

// Successful scan callback
async function onQrScanSuccess(decodedText, decodedResult) {
  stopQrScanner();
  Auth.showToast("QR Code scanned successfully! Verifying...", "success");
  Auth.setLoading(true);

  try {
    const response = await fetch('/api/teacher/check-in/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_token: decodedText })
    });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      Auth.showToast(data.message, 'success');
      loadTeacherDashboard();
    } else {
      Auth.showToast(data.message || 'QR Check-in failed.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    Auth.showToast("Network error verifying QR token.", "error");
    console.error(error);
  }
}

// Continuous frame scanner errors (ignored to avoid log pollution)
function onQrScanError(err) {
  // Silent frame decode failures (e.g. out of focus)
}

// Submit Check-Out to API
async function performCheckout() {
  if (currentLat === null || currentLon === null) {
    Auth.showToast('Waiting for GPS coordinates...', 'warning');
    return;
  }

  const sessionsInput = document.getElementById('sessionsCount');
  const count = parseInt(sessionsInput.value, 10);

  if (isNaN(count) || count < 0) {
    Auth.showToast('Please enter a valid session count.', 'warning');
    return;
  }

  Auth.setLoading(true);
  try {
    const response = await fetch('/api/teacher/check-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: currentLat,
        lon: currentLon,
        accuracy: currentAccuracy,
        sessions_count: count
      })
    });
    const data = await response.json();
    Auth.setLoading(false);

    if (data.success) {
      if (data.flagged) {
        Auth.showToast('Checked out with warnings. Impossible speed/session metrics recorded.', 'warning');
      } else {
        Auth.showToast(data.message, 'success');
      }
      loadTeacherDashboard();
    } else {
      Auth.showToast(data.message || 'Check-out failed.', 'error');
    }
  } catch (error) {
    Auth.setLoading(false);
    Auth.showToast('Network error during check-out.', 'error');
    console.error(error);
  }
}

async function loadTeacherLedger() {
  try {
    const res = await fetch('/api/teacher/ledger');
    const data = await res.json();
    if (data.success) {
      const tbody = document.getElementById('ledgerTableBody');
      tbody.innerHTML = '';

      if (data.adjustments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px 5px; text-align: center; color: var(--text-muted);">No financial ledger history found.</td></tr>';
        return;
      }

      data.adjustments.forEach(adj => {
        const tr = document.createElement('tr');
        tr.style = 'border-bottom: 1px solid rgba(255,255,255,0.05);';

        const typeBadge = adj.type === 'bonus' 
          ? '<span class="badge badge-success" style="font-size:0.75rem; padding:2px 8px;">Bonus</span>' 
          : '<span class="badge badge-danger" style="font-size:0.75rem; padding:2px 8px;">Advance</span>';

        const amountText = adj.type === 'bonus' 
          ? `<span style="color:var(--color-success); font-weight:600;">+$${Math.abs(adj.amount).toFixed(2)}</span>`
          : `<span style="color:var(--color-danger); font-weight:600;">-$${Math.abs(adj.amount).toFixed(2)}</span>`;

        const statusBadge = adj.payment_status === 'paid'
          ? `<span class="badge badge-success" style="font-size:0.75rem; padding:2px 8px;">Settled</span>`
          : '<span class="badge badge-danger" style="font-size:0.75rem; padding:2px 8px;">Unpaid</span>';

        tr.innerHTML = `
          <td style="padding: 10px 5px;"><code>${adj.date}</code></td>
          <td style="padding: 10px 5px;">${typeBadge}</td>
          <td style="padding: 10px 5px;">${amountText}</td>
          <td style="padding: 10px 5px;">${statusBadge}</td>
          <td style="padding: 10px 5px; color: var(--text-secondary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${adj.description || ''}">${adj.description || '-'}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (error) {
    console.error('Error fetching teacher ledger:', error);
  }
}
