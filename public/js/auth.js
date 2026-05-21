// Shared Authentication and Utility Helpers
const Auth = {
  // Dynamic Toast Notifications
  showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '💡';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';
    
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    
    // Auto remove toast
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  },

  // Global Spinner Loader Control
  setLoading(isLoading) {
    let overlay = document.querySelector('.loader-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'loader-overlay';
      overlay.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(overlay);
    }
    if (isLoading) {
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  },

  // Perform AJAX Login
  async login(username, password) {
    this.setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      this.setLoading(false);

      if (data.success) {
        this.showToast('Login successful! Redirecting...', 'success');
        localStorage.setItem('user', JSON.stringify(data.user));
        
        setTimeout(() => {
          if (data.user.role === 'admin') {
            window.location.href = '/admin/index.html';
          } else {
            window.location.href = '/teacher/index.html';
          }
        }, 1200);
      } else {
        this.showToast(data.message || 'Login failed. Please try again.', 'error');
      }
    } catch (err) {
      this.setLoading(false);
      this.showToast('A network error occurred. Please try again.', 'error');
      console.error('AJAX Login error:', err);
    }
  },

  // Perform Log Out
  async logout() {
    this.setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem('user');
      this.setLoading(false);
      window.location.href = '/login.html';
    } catch (err) {
      this.setLoading(false);
      window.location.href = '/login.html';
    }
  },

  // Check user session & roles on page load
  async checkSession(requiredRole = null) {
    try {
      const response = await fetch('/api/auth/me');
      if (!response.ok) throw new Error('Unauthorized session.');

      const data = await response.json();
      if (!data.success) throw new Error('Session is invalid.');

      if (requiredRole && data.user.role !== requiredRole) {
        this.showToast('Access denied: Unauthorized role.', 'error');
        setTimeout(() => {
          window.location.href = '/login.html';
        }, 1500);
        return null;
      }
      return data.user;
    } catch (err) {
      console.warn('Session check rejected, routing back to login:', err.message);
      window.location.href = '/login.html';
      return null;
    }
  }
};

// Theme Management Helpers
(function() {
  const currentTheme = localStorage.getItem('theme') || 'light';
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-theme');
  }
})();

function initTheme() {
  const currentTheme = localStorage.getItem('theme') || 'light';
  updateThemeToggleButton(currentTheme);
}

function toggleTheme() {
  if (document.body.classList.contains('dark-theme')) {
    document.body.classList.remove('dark-theme');
    localStorage.setItem('theme', 'light');
    updateThemeToggleButton('light');
  } else {
    document.body.classList.add('dark-theme');
    localStorage.setItem('theme', 'dark');
    updateThemeToggleButton('dark');
  }
}

function updateThemeToggleButton(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Toggle Light Theme' : 'Toggle Dark Theme';
  }
}

// Automatically initialize theme toggle button when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
});
