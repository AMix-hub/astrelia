// Load saved theme or default to moon
const saved = localStorage.getItem('astrelia-theme') || 'moon';
applyTheme(saved, false);

function applyTheme(theme, animate) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('astrelia-theme', theme);

  const isSun   = theme === 'sun';
  const newIcon = isSun ? '🌙' : '☀️';
  const newLabel = isSun ? 'Moon' : 'Sun';

  // Update all toggle instances (desktop + mobile menu)
  ['', '-mobile'].forEach(suffix => {
    const icon  = document.getElementById(`toggle-icon${suffix}`);
    const label = document.getElementById(`toggle-label${suffix}`);
    if (icon)  icon.textContent  = newIcon;
    if (label) label.textContent = newLabel;
  });
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'moon';
  applyTheme(current === 'moon' ? 'sun' : 'moon', true);
  // Reinit stars with new theme colors
  if (typeof initStars === 'function') initStars();
}
