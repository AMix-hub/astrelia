// Load saved theme or default to moon
const saved = localStorage.getItem('astrelia-theme') || 'moon';
applyTheme(saved, false);

function applyTheme(theme, animate) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('astrelia-theme', theme);

  const btn   = document.getElementById('theme-toggle');
  const icon  = document.getElementById('toggle-icon');
  const label = document.getElementById('toggle-label');
  if (!btn) return;

  if (theme === 'sun') {
    icon.textContent  = '🌙';
    label.textContent = 'Moon';
  } else {
    icon.textContent  = '☀️';
    label.textContent = 'Sun';
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'moon';
  applyTheme(current === 'moon' ? 'sun' : 'moon', true);
  // Reinit stars with new theme colors
  if (typeof initStars === 'function') initStars();
}
