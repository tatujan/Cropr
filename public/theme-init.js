// Apply the saved color theme before the first paint, so dark mode does not
// flash white. No saved value = follow the OS setting ("System").
try {
  const theme = localStorage.getItem('cropr-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage can be blocked (private mode). The OS setting then applies.
}
