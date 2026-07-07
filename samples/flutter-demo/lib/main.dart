// A Flutter web "island" embedded in a Winche Console tab. It demonstrates the full cross-iframe
// protocol the console's Embed node speaks:
//   inbound  (console -> island): winche:init { user, theme, token }, winche:token { token }
//   outbound (island -> console): winche:ready, winche:resize { height }, winche:refetch, winche:notify
// Interop goes through package:web + dart:js_interop (no dart:html).
import 'dart:js_interop';

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

void main() => runApp(const IslandApp());

/// Post a message to the console (the parent frame), pinned to our own origin (same-origin embed).
void _post(Map<String, Object?> message) {
  final origin = web.window.location.origin;
  web.window.parent?.postMessage(message.jsify(), origin.toJS);
}

class IslandApp extends StatefulWidget {
  const IslandApp({super.key});
  @override
  State<IslandApp> createState() => _IslandAppState();
}

class _IslandAppState extends State<IslandApp> {
  String? _email;
  String _theme = 'light';
  int? _tokenLen; // length of the bearer token if the console handed one over (Keycloak mode)
  bool _tall = false;

  static const double _short = 300;
  static const double _grown = 460;
  double get _height => _tall ? _grown : _short;

  @override
  void initState() {
    super.initState();

    // Inbound: only trust messages from our own (parent) origin.
    web.window.onMessage.listen((web.MessageEvent event) {
      if (event.origin != web.window.location.origin) return;
      final data = event.data.dartify();
      if (data is! Map) return;
      switch (data['type']) {
        case 'winche:init':
          final user = data['user'];
          final token = data['token'];
          setState(() {
            _email = user is Map ? user['email']?.toString() : null;
            _theme = data['theme']?.toString() ?? 'light';
            _tokenLen = token is String ? token.length : null;
          });
        case 'winche:token':
          final token = data['token'];
          setState(() => _tokenLen = token is String ? token.length : null);
      }
    });

    // Outbound: announce readiness (console replies with winche:init) and report our height.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _post({'type': 'winche:ready'});
      _reportHeight();
    });
  }

  void _reportHeight() => _post({'type': 'winche:resize', 'height': _height});

  void _toggleHeight() {
    setState(() => _tall = !_tall);
    _reportHeight();
  }

  void _refetch() => _post({'type': 'winche:refetch'});

  void _notify() => _post({
        'type': 'winche:notify',
        'level': 'success',
        'message': 'Hello from the Flutter island 🎯',
      });

  @override
  Widget build(BuildContext context) {
    final dark = _theme == 'dark';
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, brightness: dark ? Brightness.dark : Brightness.light),
      home: Scaffold(
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(children: [
                const FlutterLogo(size: 22),
                const SizedBox(width: 8),
                Text('Flutter island', style: Theme.of(context).textTheme.titleMedium),
              ]),
              const SizedBox(height: 12),
              // What the console handed us over winche:init.
              _kv('Signed in as', _email ?? 'guest'),
              _kv('Theme', _theme),
              _kv('Bearer token', _tokenLen == null ? 'none (cookie auth)' : 'received ($_tokenLen chars)'),
              const SizedBox(height: 16),
              // Outbound protocol calls.
              Wrap(spacing: 8, runSpacing: 8, children: [
                FilledButton.tonal(onPressed: _refetch, child: const Text('Refresh siblings (refetch)')),
                FilledButton.tonal(onPressed: _notify, child: const Text('Send toast (notify)')),
                FilledButton.tonal(
                  onPressed: _toggleHeight,
                  child: Text(_tall ? 'Shrink (resize)' : 'Grow (resize)'),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          SizedBox(width: 120, child: Text(k, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(v, style: const TextStyle(fontWeight: FontWeight.w500))),
        ]),
      );
}
