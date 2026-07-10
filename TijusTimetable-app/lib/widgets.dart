import 'package:flutter/material.dart';

const brand = Color(0xFF303070);
const brandTint = Color(0xFFECECF7);
const warn = Color(0xFFD97706);
const okGreen = Color(0xFF4FB950);
const errRed = Color(0xFFB42318);

const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/// "2026-07-10" -> "10 Jul 2026". Dates arrive from the API as ISO strings.
String fmtDate(String? iso) {
  if (iso == null || iso.length < 10) return '—';
  final p = iso.substring(0, 10).split('-');
  final m = int.tryParse(p[1]) ?? 1;
  return '${int.parse(p[2])} ${months[m - 1]} ${p[0]}';
}

/// The API's ISO form, which is what POST bodies expect.
String isoOf(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// pending / approved / rejected pill, matching the web app's colours.
class StatusBadge extends StatelessWidget {
  final String status;
  const StatusBadge(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final bg = status == 'approved'
        ? okGreen
        : status == 'rejected'
            ? errRed
            : warn;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Text(status,
          style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }
}

void showError(BuildContext context, Object e) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('$e'), backgroundColor: errRed),
  );
}

void showOk(BuildContext context, String msg) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(msg), backgroundColor: okGreen),
  );
}

/// Consistent empty / loading / error handling for the three list tabs.
class AsyncList<T> extends StatelessWidget {
  final Future<List<T>> future;
  final String emptyText;
  final Widget Function(T item) itemBuilder;
  final Future<void> Function() onRefresh;

  const AsyncList({
    super.key,
    required this.future,
    required this.emptyText,
    required this.itemBuilder,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<T>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return _Message(
            icon: Icons.cloud_off,
            text: '${snap.error}',
            onRetry: onRefresh,
          );
        }
        final items = snap.data ?? [];
        if (items.isEmpty) {
          return RefreshIndicator(
            onRefresh: onRefresh,
            // a scrollable is required for pull-to-refresh to work when empty
            child: ListView(children: [
              const SizedBox(height: 120),
              _Message(icon: Icons.inbox, text: emptyText),
            ]),
          );
        }
        return RefreshIndicator(
          onRefresh: onRefresh,
          child: ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: items.length,
            itemBuilder: (_, i) => itemBuilder(items[i]),
          ),
        );
      },
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String text;
  final Future<void> Function()? onRetry;
  const _Message({required this.icon, required this.text, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 44, color: Colors.grey),
          const SizedBox(height: 10),
          Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ]),
      ),
    );
  }
}
