// Excluded session-sync/transfer tool definitions split out from catalog-web-agent.ts
// Staged for deletion in Step 2 of the Chrome Web Store scope cleanup.

type WebToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

export function excludedAgentWebToolDefinitions(): WebToolDef[] {
  return [
    {
      name: "web_session_transfer",
      description:
        "THE multi-browser data-sync capability: copies a domain's logged-in session (cookies + optional localStorage) FROM one connected browser TO another — e.g. sync the LinkedIn login from Edge to Chrome without ever touching credentials. Requires 2+ paired browsers; identify them via web_status.browsers (use install ids when names collide).",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Session domain to transfer, e.g. 'linkedin.com'." },
          from: { type: "string", description: "Source browser name or install id. Default: first connected." },
          to: { type: "string", description: "Target browser name or install id. Default: next connected." },
          localStorage: { type: "boolean", default: true, description: "Also transfer localStorage (opens a temporary tab on the origin in both browsers)." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000, description: "Per-step timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_session_export",
      description:
        "Exports this browser's session for one domain (cookies via the browser-level cookie jar + optional localStorage) as a transferable payload — the building block web_session_transfer uses, exposed for manual control (backups, session inspection without values leaving the browser).",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Domain to export, e.g. 'github.com'." },
          localStorage: { type: "boolean", default: true, description: "Include localStorage (opens a temporary tab on the origin if none is open)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_session_import",
      description:
        "Imports a session payload (from web_session_export) into this browser: sets the cookies and restores localStorage onto the origin.",
      inputSchema: {
        type: "object",
        required: ["session"],
        properties: {
          session: { type: "object", description: "Payload from web_session_export (domain, cookies[], localStorage)." },
          domain: { type: "string", description: "Optional domain override." },
        },
        additionalProperties: false,
      },
    },
  ];
}
