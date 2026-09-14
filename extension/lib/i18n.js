// ScreenSync i18n — Centralized UI String Catalog & Localization Helper (Rev 4 Item D9 / A12)

const STRINGS = {
  en: {
    // Header & Navigation
    'app.title': 'ScreenSync MCP',
    'app.subtitle': 'Autonomous AI-Browser Engine',
    'nav.live': 'Live View',
    'nav.activity': 'Activity',
    'nav.tools': 'Tools & Catalog',
    'nav.web': 'Web Access',
    'nav.settings': 'Settings',
    'btn.reload': 'Reload',
    'btn.pair': 'Pair QR',
    'btn.setup': 'Setup',

    // Status & Live
    'status.live': 'SSE Live',
    'status.connected': 'Connected',
    'status.disconnected': 'Disconnected',
    'live.screen': 'Live Screen',
    'live.hint': 'Click to interact with phone or active tab',

    // Web Access & Consent
    'web.access_title': 'Web Access for AI Agents',
    'web.access_desc': 'Enables MCP tools to read and interact with open browser tabs.',
    'approvals.title': 'Pending Approvals (Approval Gate)',
    'approvals.none': 'No pending approvals. Actions will appear here when high-risk operations are requested.',
    'grants.title': 'Per-Origin Permissions & Grants',
    'grants.none': 'No origin grants recorded yet.',
    'btn.approve': 'Approve',
    'btn.dismiss': 'Dismiss',
    'btn.revoke': 'Revoke',
    'btn.export_audit': 'Export Audit Log (JSON)',

    // Takeover & Command Console
    'takeover.banner': 'Agent Paused — Your Turn',
    'takeover.desc': 'Please complete authentication, 2FA, or CAPTCHA verification in the browser.',
    'btn.resume': 'Resume Automation',
    'console.title': 'Command Console',
    'console.placeholder': 'Enter an autonomous browser goal (e.g. "Extract top 10 articles on AI")...',
    'btn.run_goal': 'Execute Goal',
    'jobs.running': 'Running Job',
    'jobs.cancel': 'Cancel Job',

    // Diagnostics
    'diag.title': 'Extension & Hub Diagnostics',
    'diag.hub_status': 'Hub Connection',
    'diag.sse_clients': 'Active SSE Clients',
    'diag.last_event': 'Last Event',
    'diag.granted_origins': 'Granted Origins',
    'diag.token_source': 'Token Source',
  },
  es: {
    'app.title': 'ScreenSync MCP',
    'app.subtitle': 'Motor Autónomo IA-Navegador',
    'btn.reload': 'Recargar',
    'takeover.banner': 'Agente en Pausa — Su Turno',
  },
};

let currentLocale = 'en';

export function setLocale(loc) {
  if (STRINGS[loc]) currentLocale = loc;
}

export function t(key, fallback = '') {
  const dict = STRINGS[currentLocale] || STRINGS.en;
  return dict[key] || fallback || key;
}

export function getAllStrings(loc = null) {
  return STRINGS[loc || currentLocale] || STRINGS.en;
}
