import 'package:flutter/material.dart';
import 'api.dart';
import 'widgets.dart';

/// Apply for leave and track where each request stands. A request lands
/// 'pending' and only blocks allocations once an admin approves it.
class LeaveTab extends StatefulWidget {
  const LeaveTab({super.key});
  @override
  State<LeaveTab> createState() => _LeaveTabState();
}

class _LeaveTabState extends State<LeaveTab> {
  late Future<List<Map<String, dynamic>>> _future = api.leave();

  Future<void> _reload() async => setState(() => _future = api.leave());

  Future<void> _apply() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ApplyLeaveSheet(),
    );
    if (result == true && mounted) {
      showOk(context, 'Leave requested — awaiting approval');
      await _reload();
    }
  }

  Future<void> _remove(Map<String, dynamic> l) async {
    final pending = l['status'] == 'pending';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(pending ? 'Withdraw request?' : 'Remove leave?'),
        content: Text(fmtDate(l['leave_date'] as String?)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Confirm')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await api.removeLeave(l['id'] as int);
      if (mounted) showOk(context, pending ? 'Request withdrawn' : 'Leave removed');
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
        emptyText: 'No leave yet.\nTap + to apply.',
        itemBuilder: (l) {
          final status = l['status'] as String? ?? 'pending';
          final note = l['decision_note'] as String?;
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Row(children: [
                Text(fmtDate(l['leave_date'] as String?),
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                StatusBadge(status),
              ]),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text((l['reason'] as String?)?.isNotEmpty == true ? l['reason'] as String : 'No reason given'),
                if (status == 'rejected' && note != null && note.isNotEmpty)
                  Text(note, style: const TextStyle(color: errRed, fontSize: 12)),
              ]),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline, color: errRed),
                tooltip: status == 'pending' ? 'Withdraw' : 'Remove',
                onPressed: () => _remove(l),
              ),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _apply,
        icon: const Icon(Icons.add),
        label: const Text('Apply'),
      ),
    );
  }
}

class _ApplyLeaveSheet extends StatefulWidget {
  const _ApplyLeaveSheet();
  @override
  State<_ApplyLeaveSheet> createState() => _ApplyLeaveSheetState();
}

class _ApplyLeaveSheetState extends State<_ApplyLeaveSheet> {
  DateTime? _date;
  final _reason = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
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
    if (_date == null) return showError(context, 'Pick a date');
    setState(() => _busy = true);
    try {
      await api.applyLeave(isoOf(_date!), _reason.text.trim().isEmpty ? null : _reason.text.trim());
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showError(context, e);
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('Apply for leave',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: _pickDate,
          icon: const Icon(Icons.calendar_today),
          label: Text(_date == null ? 'Pick a date' : fmtDate(isoOf(_date!))),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _reason,
          decoration: const InputDecoration(
            labelText: 'Reason (optional)',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        const Text('An admin approves your request before it takes effect.',
            style: TextStyle(color: Colors.grey, fontSize: 12)),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          height: 46,
          child: FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Sending…' : 'Request leave'),
          ),
        ),
      ]),
    );
  }
}
