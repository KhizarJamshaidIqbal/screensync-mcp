import 'dart:convert';

/// A parsed desktop pairing payload.
class PairingInfo {
  final String url;
  final String token;
  const PairingInfo({required this.url, required this.token});
}

/// Parses the pairing payload printed by the desktop hub at startup.
///
/// Accepted forms (all produced by the hub / its QR):
///  - `screensync://pair?url=http%3A%2F%2F192.168.1.2%3A3000&token=abc`
///  - `{"url":"http://192.168.1.2:3000","token":"abc"}`
///  - `http://192.168.1.2:3000#abc`  (url + fragment token)
///  - `http://192.168.1.2:3000`      (url only, keeps current token)
class PairingService {
  PairingService._();

  static PairingInfo? parse(String raw) {
    final input = raw.trim();
    if (input.isEmpty) return null;

    // JSON form
    if (input.startsWith('{')) {
      try {
        final decoded = jsonDecode(input);
        if (decoded is Map<String, dynamic>) {
          final url = _normalizeUrl(decoded['url']?.toString() ?? '');
          if (url == null) return null;
          final token = decoded['token']?.toString() ?? '';
          return PairingInfo(
              url: url, token: token.isEmpty ? 'screensync-local-dev' : token);
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    // screensync://pair?url=…&token=…
    if (input.startsWith('screensync://')) {
      final uri = Uri.tryParse(input);
      if (uri == null) return null;
      final url = _normalizeUrl(uri.queryParameters['url'] ?? '');
      if (url == null) return null;
      final token = uri.queryParameters['token'] ?? '';
      return PairingInfo(
          url: url, token: token.isEmpty ? 'screensync-local-dev' : token);
    }

    // Plain http URL, optional #token fragment
    if (input.startsWith('http://') || input.startsWith('https://')) {
      final uri = Uri.tryParse(input);
      if (uri == null || uri.host.isEmpty) return null;
      final base = _normalizeUrl('${uri.scheme}://${uri.host}'
          '${uri.hasPort ? ':${uri.port}' : ''}');
      if (base == null) return null;
      final token = uri.fragment;
      return PairingInfo(
          url: base, token: token.isEmpty ? 'screensync-local-dev' : token);
    }

    return null;
  }

  static String? _normalizeUrl(String url) {
    final trimmed = url.trim();
    if (trimmed.isEmpty) return null;
    final uri = Uri.tryParse(trimmed);
    if (uri == null || uri.host.isEmpty || !uri.scheme.startsWith('http')) {
      return null;
    }
    // Strip trailing slash so endpoint concatenation stays clean.
    final s = trimmed.endsWith('/')
        ? trimmed.substring(0, trimmed.length - 1)
        : trimmed;
    return s;
  }
}
