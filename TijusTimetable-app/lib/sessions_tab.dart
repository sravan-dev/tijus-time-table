import 'package:flutter/material.dart';
import 'api.dart';
import 'widgets.dart';

/// Sessions this tutor has proposed. Each lands 'pending'; an admin approves it
/// before it joins the live timetable. A pending request can be withdrawn.
class SessionsTab extends StatefulWidget {
  const SessionsTab({super.key});
  @override
  State<SessionsTab> createState() => _SessionsTabState();
}

class _SessionsTabState extends State<SessionsTab> {
  late Future<List<Map<String, dynamic>>> _future = api.sessions();

  Future<void> _reload() async => setState(() => _future = api.sessions());

  Future<void> _request() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _RequestSessionSheet(),
    );
    if (result == true && mounted) {
      showOk(context, 'Session requested — awaiting approval');
      await _reload();
    }
  }

  Future<void> _withdraw(Map<String, dynamic> s) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Withdraw request?'),
        content: Text('${fmtDate(s['alloc_date'] as String?)} · ${s['slot_label']}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Withdraw')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await api.withdrawSession(s['id'] as int);
      if (mounted) showOk(context, 'Request withdrawn');
      await _reload();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AsyncList<Map<String, dynamic>>(
        future: _future,
        onRefresh: _reload,
        emptyText: 'No session requests yet.\nTap + to request one.',
        itemBuilder: (s) {
          final status = s['status'] as String? ?? 'pending';
          final note = s['decision_note'] as String?;
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Row(children: [
                Expanded(
                  child: Text('${fmtDate(s['alloc_date'] as String?)} · ${s['slot_label']}',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
                StatusBadge(status),
              ]),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text([
                  '${s['program_code']}',
                  if (s['batch_name'] != null) 'Batch ${s['batch_name']}',
                  if (s['activity_name'] != null || s['activity_code'] != null)
                    '${s['activity_name'] ?? s['activity_code']}',
                  if (s['room_code'] != null) 'Room ${s['room_code']}',
                ].join('  ·  ')),
                if (status == 'rejected' && note != null && note.isNotEmpty)
                  Text(note, style: const TextStyle(color: errRed, fontSize: 12)),
              ]),
              // only a request still awaiting a decision can be taken back
              trailing: status == 'pending'
                  ? IconButton(
                      icon: const Icon(Icons.delete_outline, color: errRed),
                      tooltip: 'Withdraw',
                      onPressed: () => _withdraw(s),
                    )
                  : null,
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _request,
        icon: const Icon(Icons.add),
        label: const Text('Request'),
      ),
    );
  }
}

class _RequestSessionSheet extends StatefulWidget {
  const _RequestSessionSheet();
  @override
  State<_RequestSessionSheet> createState() => _RequestSessionSheetState();
}

class _RequestSessionSheetState extends State<_RequestSessionSheet> {
  DateTime? _date;
  int? _programId, _slotId, _batchId, _activityId, _roomId;
  List<Map<String, dynamic>> _programs = [], _slots = [], _batches = [], _activities = [], _rooms = [];
  bool _busy = false, _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _loadReference();
  }

  Future<void> _loadReference() async {
    try {
      final r = await Future.wait([api.programs(), api.activities(), api.classrooms()]);
      setState(() {
        _programs = r[0];
        _activities = r[1];
        _rooms = r[2];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loadError = '$e'; _loading = false; });
    }
  }

  /// Slots and batches belong to a program, so reload them when it changes and
  /// clear any selection that no longer applies.
  Future<void> _onProgram(int? id) async {
    setState(() {
      _programId = id;
      _slotId = null;
      _batchId = null;
      _slots = [];
      _batches = [];
    });
    if (id == null) return;
    try {
      final r = await Future.wait([api.slots(id), api.batches(id)]);
      if (mounted) setState(() { _slots = r[0]; _batches = r[1]; });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _submit() async {
    if (_date == null || _programId == null || _slotId == null) {
      return showError(context, 'Date, program and time slot are required');
    }
    setState(() => _busy = true);
    try {
      await api.requestSession({
        'alloc_date': isoOf(_date!),
        'program_id': _programId,
        'time_slot_id': _slotId,
        'batch_id': _batchId,
        'activity_id': _activityId,
        'classroom_id': _roomId,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showError(context, e);
      setState(() => _busy = false);
    }
  }

  DropdownButtonFormField<int> _dropdown({
    required String label,
    required int? value,
    required List<Map<String, dynamic>> items,
    required String Function(Map<String, dynamic>) text,
    required void Function(int?) onChanged,
    bool enabled = true,
  }) {
    return DropdownButtonFormField<int>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      items: items
          .map((e) => DropdownMenuItem(value: e['id'] as int, child: Text(text(e))))
          .toList(),
      onChanged: enabled ? onChanged : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
    }
    if (_loadError != null) {
      return SizedBox(
        height: 200,
        child: Center(child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(_loadError!, textAlign: TextAlign.center),
        )),
      );
    }
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Request a session',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.calendar_today),
            label: Text(_date == null ? 'Pick a date *' : fmtDate(isoOf(_date!))),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: 'Program *',
            value: _programId,
            items: _programs,
            text: (p) => '${p['code']}',
            onChanged: _onProgram,
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: _programId == null ? 'Time slot * (pick a program first)' : 'Time slot *',
            value: _slotId,
            items: _slots,
            text: (s) => '${s['label']}',
            onChanged: (v) => setState(() => _slotId = v),
            enabled: _slots.isNotEmpty,
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: 'Batch (optional)',
            value: _batchId,
            items: _batches,
            text: (b) => '${b['name']}',
            onChanged: (v) => setState(() => _batchId = v),
            enabled: _batches.isNotEmpty,
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: 'Activity (optional)',
            value: _activityId,
            items: _activities,
            text: (a) => '${a['name'] ?? a['code']}',
            onChanged: (v) => setState(() => _activityId = v),
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: 'Room (optional)',
            value: _roomId,
            items: _rooms,
            text: (r) => '${r['code']}',
            onChanged: (v) => setState(() => _roomId = v),
          ),
          const SizedBox(height: 8),
          const Text('You are listed as the tutor. An admin approves it before it '
              'joins the timetable.',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 46,
            child: FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Sending…' : 'Request session'),
            ),
          ),
        ]),
      ),
    );
  }
}
