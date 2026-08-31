/// Parsed view of the hub's /api/mcp/catalog response plus the paste-ready
/// "connect kit" builder used by the MCP page's copy button.
class McpCatalog {
  const McpCatalog({
    required this.serverName,
    required this.serverVersion,
    required this.tools,
    required this.prompts,
    required this.resources,
    required this.usage,
    this.stdioNote,
    this.httpBaseUrl,
    this.token,
    this.mdnsType,
  });

  final String serverName;
  final String serverVersion;
  final List<McpToolInfo> tools;
  final List<McpPromptInfo> prompts;
  final List<McpResourceInfo> resources;
  final List<String> usage;
  final String? stdioNote;
  final String? httpBaseUrl;
  final String? token;
  final String? mdnsType;

  factory McpCatalog.fromJson(Map<String, dynamic> json) {
    final server = (json['server'] as Map<String, dynamic>?) ?? const {};
    final connection = (json['connection'] as Map<String, dynamic>?) ?? const {};
    final stdio = (connection['stdio'] as Map<String, dynamic>?) ?? const {};
    final http = (connection['httpHub'] as Map<String, dynamic>?) ?? const {};
    final discovery = (connection['discovery'] as Map<String, dynamic>?) ?? const {};
    return McpCatalog(
      serverName: server['name'] as String? ?? 'screensync-mcp-server',
      serverVersion: server['version'] as String? ?? '',
      tools: ((json['tools'] as List<dynamic>?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(McpToolInfo.fromJson)
          .toList(),
      prompts: ((json['prompts'] as List<dynamic>?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(McpPromptInfo.fromJson)
          .toList(),
      resources: ((json['resources'] as List<dynamic>?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(McpResourceInfo.fromJson)
          .toList(),
      usage: ((json['recommendedUsage'] as List<dynamic>?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      stdioNote: stdio['note'] as String?,
      httpBaseUrl: http['baseUrl'] as String?,
      token: http['bearerToken'] as String?,
      mdnsType: discovery['mdnsType'] as String?,
    );
  }

  /// Paste-ready block: drop it into Claude Code / Claude Desktop / any MCP
  /// client and the agent can configure + connect itself, then discover the
  /// full capability set via get_mcp_catalog.
  String buildConnectKit({required String hubUrl, required String token}) =>
      buildConnectKitText(
        hubUrl: hubUrl,
        token: token,
        stdioNote: stdioNote,
        mdnsType: mdnsType,
        usage: usage,
      );
}

/// Top-level so any screen (MCP tab, dashboard card) can build the kit.
String buildConnectKitText({
  required String hubUrl,
  required String token,
  String? stdioNote,
  String? mdnsType,
  List<String> usage = const [],
}) {
  final stdioConfig = '''{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<HUB_DIR>/screensync-hub.js"],
      "env": { "SCREEN_SYNC_TOKEN": "$token" }
    }
  }
}''';
  final usageBlock = usage.isEmpty
      ? 'Call get_mcp_catalog, then get_device_status and get_latest_screenshot.'
      : usage.map((u) => '  $u').join('\n');
  return '''ScreenSync MCP — Agent Connect Kit
=================================
Hand this to any AI agent (Claude Code, Claude Desktop, or any MCP client)
and it will configure and connect to this ScreenSync hub automatically.

OPTION A — Claude Code: save as .mcp.json in your project root
$stdioConfig

OPTION B — Claude Desktop: merge into claude_desktop_config.json
$stdioConfig
${stdioNote ?? ''}

OPTION C — HTTP-only agents (no stdio needed)
Base URL: $hubUrl
Bearer token: $token
Key endpoints:
  GET  /api/mcp/catalog        full tool/skill/resource catalog
  GET  /api/screens/latest     latest screenshot as base64 image
  GET  /api/device/status      connection + frame freshness
  POST /api/screens/upload     push a capture
  GET  /api/inspections/latest bug regions published by the agent
  GET  /api/patches/latest     git patch for one-tap apply
${mdnsType != null ? 'mDNS discovery type: $mdnsType (same-LAN auto discovery)\n' : ''}
AFTER CONNECTING
$usageBlock
''';
}

class McpToolInfo {
  const McpToolInfo({required this.name, required this.description});
  final String name;
  final String description;

  factory McpToolInfo.fromJson(Map<String, dynamic> json) => McpToolInfo(
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
      );
}

class McpPromptInfo {
  const McpPromptInfo({
    required this.name,
    required this.description,
    this.arguments = const [],
  });
  final String name;
  final String description;
  final List<String> arguments;

  factory McpPromptInfo.fromJson(Map<String, dynamic> json) => McpPromptInfo(
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        arguments: ((json['arguments'] as List<dynamic>?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map((a) => a['name']?.toString() ?? '')
            .where((s) => s.isNotEmpty)
            .toList(),
      );
}

class McpResourceInfo {
  const McpResourceInfo({
    required this.uri,
    required this.name,
    required this.description,
  });
  final String uri;
  final String name;
  final String description;

  factory McpResourceInfo.fromJson(Map<String, dynamic> json) =>
      McpResourceInfo(
        uri: json['uri'] as String? ?? '',
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
      );
}
