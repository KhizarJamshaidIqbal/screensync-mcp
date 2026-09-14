// Single source of truth for HTML escaping in the extension UI.
//
// The dashboard interpolates tool names, page titles, origins and audit entries into
// innerHTML. All of that text can contain markup, so anything that carries it has to go
// through here first. Defined once so a caller cannot accidentally pick up a weaker copy.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
