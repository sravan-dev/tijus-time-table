import 'package:flutter/material.dart';
import 'api.dart';
import 'login_screen.dart';
import 'schedule_tab.dart';
import 'leave_tab.dart';
import 'sessions_tab.dart';
import 'widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await api.restore();   // a saved token keeps the tutor signed in
  runApp(const TijusApp());
}

class TijusApp extends StatefulWidget {
  const TijusApp({super.key});
  @override
  State<TijusApp> createState() => _TijusAppState();
}

class _TijusAppState extends State<TijusApp> {
  void _refresh() => setState(() {});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tijus Timetable',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: brand),
        useMaterial3: true,
      ),
      home: api.isLoggedIn ? HomeScreen(onLogout: _refresh) : LoginScreen(onLoggedIn: _refresh),
    );
  }
}

class HomeScreen extends StatefulWidget {
  final VoidCallback onLogout;
  const HomeScreen({super.key, required this.onLogout});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  static const _titles = ['My Schedule', 'My Leaves', 'My Sessions'];

  Future<void> _logout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok != true) return;
    await api.logout();
    widget.onLogout();
  }

  @override
  Widget build(BuildContext context) {
    final name = api.user?['name'] ?? api.user?['username'] ?? '';
    return Scaffold(
      appBar: AppBar(
        backgroundColor: brand,
        foregroundColor: Colors.white,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_titles[_tab], style: const TextStyle(fontSize: 17)),
          Text('$name', style: const TextStyle(fontSize: 12, color: Colors.white70)),
        ]),
        actions: [
          IconButton(icon: const Icon(Icons.logout), tooltip: 'Sign out', onPressed: _logout),
        ],
      ),
      // IndexedStack keeps each tab's state (and its loaded list) across switches
      body: IndexedStack(
        index: _tab,
        children: const [ScheduleTab(), LeaveTab(), SessionsTab()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.calendar_month), label: 'Schedule'),
          NavigationDestination(icon: Icon(Icons.event_busy), label: 'Leaves'),
          NavigationDestination(icon: Icon(Icons.playlist_add), label: 'Sessions'),
        ],
      ),
    );
  }
}
