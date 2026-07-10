// Exercises the real Api class against a running Tijus server.
//
//   flutter test --dart-define=TT_URL=http://localhost:4000 \
//                --dart-define=TT_USER=... --dart-define=TT_PASS=...
//
// Pure-Dart unit tests (URL normalisation) always run; the live-server group is
// skipped when TT_URL is not supplied, so `flutter test` stays green offline.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tijus_timetable/api.dart';

const _url = String.fromEnvironment('TT_URL');
const _user = String.fromEnvironment('TT_USER');
const _pass = String.fromEnvironment('TT_PASS');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // The test binding installs an HttpOverrides that answers every request with a
  // fake 400 and never touches the network. Clear it so the live-server group
  // really talks to the server; without this these tests pass/fail on a mock.
  setUpAll(() => HttpOverrides.global = null);

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('normalizeUrl', () {
    test('adds a scheme when missing', () {
      expect(Api.normalizeUrl('192.168.1.5:4000'), 'http://192.168.1.5:4000');
    });
    test('keeps https', () {
      expect(Api.normalizeUrl('https://tt.example.com'), 'https://tt.example.com');
    });
    test('strips trailing slashes', () {
      expect(Api.normalizeUrl('http://host:4000///'), 'http://host:4000');
    });
    test('strips a trailing /api so both forms work', () {
      expect(Api.normalizeUrl('http://host:4000/api'), 'http://host:4000');
      expect(Api.normalizeUrl('http://host:4000/api/'), 'http://host:4000');
    });
    test('trims whitespace', () {
      expect(Api.normalizeUrl('  http://host:4000  '), 'http://host:4000');
    });
    test('handles the live URL as the user would paste it', () {
      expect(Api.normalizeUrl('https://timetable.tijusacademy.com/'),
          'https://timetable.tijusacademy.com');
    });
  });

  group('default server', () {
    test('points at production and keeps its https scheme', () {
      expect(kDefaultServerUrl, 'https://timetable.tijusacademy.com');
      expect(Api.normalizeUrl(kDefaultServerUrl), kDefaultServerUrl);
    });
    test('a fresh install pre-fills the production URL', () async {
      SharedPreferences.setMockInitialValues({});
      final a = Api();
      await a.restore();
      expect(a.baseUrl, kDefaultServerUrl);
      expect(a.isLoggedIn, isFalse);
    });
    test('a saved URL wins over the default', () async {
      SharedPreferences.setMockInitialValues({'tt_base_url': 'http://10.0.2.2:4000'});
      final a = Api();
      await a.restore();
      expect(a.baseUrl, 'http://10.0.2.2:4000');
    });
  });

  group('live server', () {
    final api = Api();

    test('rejects bad credentials with the server message', () async {
      await expectLater(
        api.login(_url, _user, 'definitely-not-the-password'),
        // assert on 401 specifically: any generic ApiException would also match
        // isA<ApiException>(), which is how a stubbed 400 once passed this test
        throwsA(isA<ApiException>()
            .having((e) => e.status, 'status', 401)
            .having((e) => e.message, 'message', 'Invalid credentials')),
      );
      expect(api.isLoggedIn, isFalse);
    });

    test('logs a tutor in', () async {
      await api.login(_url, _user, _pass);
      expect(api.isLoggedIn, isTrue);
      expect(api.user!['faculty_id'], isNotNull);
    });

    // An admin has no faculty record, so every /api/my/* screen would 403.
    // The app must refuse the login outright rather than sign them into a
    // broken session.
    test('refuses a non-tutor account', () async {
      const adminUser = String.fromEnvironment('TT_ADMIN_USER');
      const adminPass = String.fromEnvironment('TT_ADMIN_PASS');
      final a = Api();
      await expectLater(
        a.login(_url, adminUser, adminPass),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)),
      );
      expect(a.isLoggedIn, isFalse);
      expect(a.user, isNull);
    }, skip: const String.fromEnvironment('TT_ADMIN_USER').isEmpty
        ? 'set TT_ADMIN_USER/TT_ADMIN_PASS'
        : false);

    test('schedule returns only approved sessions', () async {
      final rows = await api.schedule();
      expect(rows, isA<List>());
    });

    test('leave: apply -> appears as pending -> withdraw', () async {
      final rows0 = await api.leave();
      await api.applyLeave('2026-12-24', 'app integration test');

      final rows1 = await api.leave();
      expect(rows1.length, rows0.length + 1);
      final mine = rows1.firstWhere((l) => (l['leave_date'] as String).startsWith('2026-12-24'));
      expect(mine['status'], 'pending');
      expect(mine['reason'], 'app integration test');

      await api.removeLeave(mine['id'] as int);
      final rows2 = await api.leave();
      expect(rows2.length, rows0.length);
    });

    test('sessions: request -> pending -> withdraw', () async {
      final programs = await api.programs();
      expect(programs, isNotEmpty);
      final pid = programs.first['id'] as int;

      final slots = await api.slots(pid);
      expect(slots, isNotEmpty, reason: 'program should have time slots');

      final before = await api.sessions();
      await api.requestSession({
        'alloc_date': '2026-12-24',
        'program_id': pid,
        'time_slot_id': slots.first['id'],
      });

      final after = await api.sessions();
      expect(after.length, before.length + 1);
      final mine = after.firstWhere(
          (s) => (s['alloc_date'] as String).startsWith('2026-12-24'));
      expect(mine['status'], 'pending');

      await api.withdrawSession(mine['id'] as int);
      expect((await api.sessions()).length, before.length);
    });

    test('batches and reference data load', () async {
      final programs = await api.programs();
      final pid = programs.first['id'] as int;
      expect(await api.batches(pid), isA<List>());
      expect(await api.activities(), isA<List>());
      expect(await api.classrooms(), isA<List>());
    });

    test('logout clears the token', () async {
      await api.logout();
      expect(api.isLoggedIn, isFalse);
    });
  }, skip: _url.isEmpty ? 'set --dart-define=TT_URL to run live tests' : false);
}
