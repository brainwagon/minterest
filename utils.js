/**
 * Escapes HTML special characters in a string to prevent XSS injection.
 * @param {string} str - The raw user-supplied string to escape.
 * @returns {string} The escaped string, safe for insertion into HTML.
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
