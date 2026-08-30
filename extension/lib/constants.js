export const BRAND = {
  primary: '#7C3AED',
  primaryDeep: '#6541D6',
  gradFrom: '#6D28D9',
  gradTo: '#8B5CF6',
  magenta: '#C13BD9',
  darkBg: '#150E27',
  darkSurface: '#211636',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export const DEFAULT_TOKEN = 'screensync-local-dev';
export const PROBE_URLS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
export const GUIDE_URL = 'https://screensyncmcp.epsoldev.com/setup-guide.json';
export const SITE_URL = 'https://screensyncmcp.epsoldev.com';
export const MDNS_TYPE = '_screensync-hub._tcp';

export const HEALTH_ALARM = 'health-poll';
export const HEALTH_PERIOD_S = 30;
export const SSE_LIVENESS_MS = 60000;
export const EVENT_LOG_CAP = 50;

// Bundled fallback if the live setup guide cannot be fetched.
export const FALLBACK_GUIDE = {
  version: '1.0.0',
  hubInstall: {
    prerequisites: ['Node.js 18+', 'npm'],
    steps: [
      'Get the repo (github.com/KhizarJamshaidIqbal/screensync-mcp) or copy the mcp-server folder from your install.',
      'cd mcp-server && npm install && npm run build',
      'npm start  —  hub listens on port 3000 and prints a pairing QR.',
    ],
    envVars: {
      SCREEN_SYNC_TOKEN: 'Bearer pairing token (default: screensync-local-dev)',
      SCREEN_SYNC_PORT: 'HTTP port (default: 3000)',
      SCREEN_SYNC_HOST: 'Bind address (default: 0.0.0.0)',
    },
  },
  mcpConfig: {
    claudeCode: {
      file: '.mcp.json (project root)',
      template:
        '{\n  "mcpServers": {\n    "screensync": {\n      "command": "node",\n      "args": ["<SCREENSYNC_MCP_DIR>/dist/index.js"],\n      "env": { "SCREEN_SYNC_TOKEN": "<TOKEN>" }\n    }\n  }\n}',
    },
    claudeDesktop: {
      file: 'claude_desktop_config.json',
      template:
        '{\n  "mcpServers": {\n    "screensync": {\n      "command": "node",\n      "args": ["<SCREENSYNC_MCP_DIR>/dist/index.js"],\n      "env": { "SCREEN_SYNC_TOKEN": "<TOKEN>" }\n    }\n  }\n}',
    },
    httpOnly: {
      baseUrl: 'http://<HUB-IP>:3000',
      header: 'Authorization: Bearer <TOKEN>',
    },
  },
  pairingFormats: [
    'screensync://pair?url=http%3A%2F%2F<IP>%3A3000&token=<TOKEN>',
    '{"url":"http://<IP>:3000","token":"<TOKEN>"}',
    'http://<IP>:3000#<TOKEN>',
  ],
  troubleshooting: [
    'Hub not reachable — ensure `npm start` is running and the firewall allows port 3000 on the LAN.',
    '401 Unauthorized — the token must match SCREEN_SYNC_TOKEN on the hub.',
    '429 Too many live connections — max 10 concurrent /api/events clients; close another dashboard.',
  ],
};
