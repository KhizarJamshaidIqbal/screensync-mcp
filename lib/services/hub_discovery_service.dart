import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'package:bonsoir/bonsoir.dart';
import 'package:http/http.dart' as http;

/// A hub advertised by the desktop ScreenSync MCP server via mDNS.
class DiscoveredHub {
  final String name;
  final String host;
  final int port;

  const DiscoveredHub(
      {required this.name, required this.host, required this.port});

  String get url => 'http://$host:$port';

  @override
  bool operator ==(Object other) => other is DiscoveredHub && other.url == url;

  @override
  int get hashCode => url.hashCode;
}

class HubDiscoveryService {
  static const serviceType = '_screensync-hub._tcp';

  /// Scans the LAN for `_screensync-hub._tcp` advertisements for [timeout].
  Future<List<DiscoveredHub>> discover({
    Duration timeout = const Duration(seconds: 5),
    void Function(String stage)? onStage,
  }) async {
    final found = <DiscoveredHub>[];
    BonsoirDiscovery? discovery;
    try {
      discovery = BonsoirDiscovery(type: serviceType);
      await discovery.ready;
      final done = Completer<void>();
      Timer(timeout, () {
        if (!done.isCompleted) done.complete();
      });

      final sub = discovery.eventStream!.listen((event) {
        if (event.type == BonsoirDiscoveryEventType.discoveryServiceResolved) {
          final service = event.service!;
          final host = service is ResolvedBonsoirService
              ? service.host?.trim() ?? ''
              : '';
          if (host.isNotEmpty) {
            final hub = DiscoveredHub(
              name: service.name,
              host: host,
              port: service.port,
            );
            if (!found.contains(hub)) {
              found.add(hub);
              onStage?.call('Found ${hub.name} at ${hub.url}');
            }
          }
        }
      });

      await discovery.start();
      onStage?.call('Scanning LAN…');
      await done.future;
      await sub.cancel();
      await discovery.stop();
    } catch (e) {
      onStage?.call('mDNS unavailable ($e). Use manual address.');
    } finally {
      unawaited(discovery?.stop());
    }
    return found;
  }


  /// Fallback for routers that drop device-to-device multicast: read the
  /// phone's own Wi-Fi IPv4, then probe every :3000/health on that /24 in
  /// parallel batches. Identifies the hub by its health payload, so it can
  /// never match a foreign device.
  Future<DiscoveredHub?> scanSubnet({
    int port = 3000,
    Duration perHost = const Duration(milliseconds: 350),
  }) async {
    final prefixes = await _lanIpv4Prefixes();
    debugPrint('SScan prefixes: $prefixes');
    for (final prefix in prefixes) {
      DiscoveredHub? found;
      const batchSize = 32;
      for (var start = 1;
          start <= 254 && found == null;
          start += batchSize) {
        final batch = <Future<void>>[];
        for (var i = start;
            i < start + batchSize && i <= 254 && found == null;
            i++) {
          final host = '$prefix.$i';
          batch.add(_probe(host, port, perHost).then((hub) {
            found ??= hub;
          }));
        }
        await Future.wait(batch);
      }
      if (found != null) return found;
    }
    return null;
  }

  int _probeErrorBudget = 3;

  Future<DiscoveredHub?> _probe(
      String host, int port, Duration timeout) async {
    try {
      final res = await http
          .get(Uri.parse('http://$host:$port/health'))
          .timeout(timeout);
      if (res.statusCode == 200 && res.body.contains('screensync-hub')) {
        return DiscoveredHub(
            name: 'ScreenSync Hub ($host)', host: host, port: port);
      }
    } catch (e) {
      if (_probeErrorBudget-- > 0) {
        debugPrint('SScan probe $host failed: ${e.runtimeType} $e');
      }
    }
    return null;
  }

  /// All private IPv4 /24 prefixes, Wi-Fi interfaces (wlan*) first — an
  /// Android device may expose mobile-data (10.x CGNAT) as its default.
  Future<List<String>> _lanIpv4Prefixes() async {
    final ordered = <String>[], rest = <String>[];
    try {
      final interfaces = await NetworkInterface.list(
          type: InternetAddressType.IPv4, includeLoopback: false);
      for (final iface in interfaces) {
        final isWifi = iface.name.toLowerCase().contains('wlan');
        for (final addr in iface.addresses) {
          final a = addr.address;
          final second = a.startsWith('172.')
              ? int.tryParse(a.split('.')[1])
              : null;
          final isPrivate = a.startsWith('192.168.') ||
              a.startsWith('10.') ||
              (second != null && second >= 16 && second <= 31);
          if (!isPrivate) continue;
          (isWifi ? ordered : rest)
              .add(a.substring(0, a.lastIndexOf('.')));
        }
      }
    } catch (e) {
      debugPrint('SScan interface list failed: $e');
    }
    return [...ordered, ...rest];
  }
}

