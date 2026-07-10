import 'package:flutter/material.dart';
import 'api.dart';
import 'widgets.dart';

/// The tutor's approved sessions, grouped by day. Read-only: changing a session
/// is the allocation team's job.
class ScheduleTab extends StatefulWidget {
  const ScheduleTab({super.key});
  @override
  State<ScheduleTab> createState() => _ScheduleTabState();
}

class _ScheduleTabState extends State<ScheduleTab> {
  late Future<List<Map<String, dynamic>>> _future = api.schedule();

  Future<void> _reload() async => setState(() => _future = api.schedule());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.cloud_off, size: 44, color: Colors.grey),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text('${snap.error}', textAlign: TextAlign.center),
              ),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _reload, child: const Text('Retry')),
            ]),
          );
        }

        // group by date, preserving the server's chronological order
        final byDate = <String, List<Map<String, dynamic>>>{};
        for (final s in snap.data ?? <Map<String, dynamic>>[]) {
          final d = (s['alloc_date'] as String).substring(0, 10);
          byDate.putIfAbsent(d, () => []).add(s);
        }

        if (byDate.isEmpty) {
          return RefreshIndicator(
            onRefresh: _reload,
            child: ListView(children: const [
              SizedBox(height: 140),
              Center(child: Icon(Icons.event_available, size: 44, color: Colors.grey)),
              SizedBox(height: 10),
              Center(child: Text('You have no scheduled sessions.',
                  style: TextStyle(color: Colors.grey))),
            ]),
          );
        }

        final dates = byDate.keys.toList();
        return RefreshIndicator(
          onRefresh: _reload,
          child: ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: dates.length,
            itemBuilder: (_, i) {
              final date = dates[i];
              final sessions = byDate[date]!;
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    color: brandTint,
                    child: Text(fmtDate(date),
                        style: const TextStyle(fontWeight: FontWeight.bold, color: brand)),
                  ),
                  ...sessions.map((s) => ListTile(
                        dense: true,
                        leading: const Icon(Icons.schedule, color: brand),
                        title: Text('${s['slot_label']}  ·  ${s['program_code']}',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text([
                          if (s['batch_name'] != null) 'Batch ${s['batch_name']}',
                          if (s['activity_name'] != null || s['activity_code'] != null)
                            '${s['activity_name'] ?? s['activity_code']}',
                          if (s['room_code'] != null) 'Room ${s['room_code']}',
                        ].join('  ·  ')),
                      )),
                ]),
              );
            },
          ),
        );
      },
    );
  }
}
