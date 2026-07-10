import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// The production server. Pre-filled on the login screen so a tutor normally
/// just types their username and password, but it stays editable for testing
/// against a local server. Override at build time with:
///   flutter build apk --release --dart-define=TT_DEFAULT_URL=http://10.0.2.2:4000
const kDefaultServerUrl = String.fromEnvironment(
  'TT_DEFAULT_URL',
  defaultValue: 'https://timetable.tijusacademy.com',
);

/// Raised for any non-2xx response, carrying the server's `error` message so the
/// UI can show what actually went wrong rather than a generic failure.
class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => message;
}

/// Talks to the Tijus timetable server. The base URL is entered on the login
/// screen and remembered, so one APK works against local and production servers.
class Api {
  static const _kToken = 'tt_token';
  static const _kBaseUrl = 'tt_base_url';
  static const _kUser = 'tt_user';

  String? _token;
  String _baseUrl = kDefaultServerUrl;
  Map<String, dynamic>? user;

  String get baseUrl => _baseUrl;
  bool get isLoggedIn => _token != null;

  /// Trims a user-typed URL into an API root: strips trailing slashes and a
  /// trailing `/api` so both "host:4000" and "host:4000/api" work.
  static String normalizeUrl(String raw) {
    var u = raw.trim();
    if (u.isEmpty) return u;
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'http://$u';
    u = u.replaceAll(RegExp(r'/+$'), '');
    u = u.replaceAll(RegExp(r'/api$'), '');
    return u;
  }

  Future<void> restore() async {
    final p = await SharedPreferences.getInstance();
    _token = p.getString(_kToken);
    // fall back to production until the tutor has signed in somewhere else
    _baseUrl = p.getString(_kBaseUrl) ?? kDefaultServerUrl;
    final raw = p.getString(_kUser);
    if (raw != null) user = jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> _persist() async {
    final p = await SharedPreferences.getInstance();
    if (_token == null) {
      await p.remove(_kToken);
      await p.remove(_kUser);
    } else {
      await p.setString(_kToken, _token!);
      await p.setString(_kUser, jsonEncode(user));
    }
    await p.setString(_kBaseUrl, _baseUrl);
  }

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$_baseUrl/api$path').replace(queryParameters: query);

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  /// Decodes a response, converting an error status into an [ApiException].
  dynamic _decode(http.Response r) {
    dynamic body;
    try {
      body = r.body.isEmpty ? null : jsonDecode(r.body);
    } catch (_) {
      throw ApiException(r.statusCode, 'Server returned an unexpected response');
    }
    if (r.statusCode >= 200 && r.statusCode < 300) return body;
    final msg = (body is Map && body['error'] is String)
        ? body['error'] as String
        : 'Request failed (${r.statusCode})';
    throw ApiException(r.statusCode, msg);
  }

  Future<dynamic> _get(String path, [Map<String, String>? q]) async =>
      _decode(await http.get(_uri(path, q), headers: _headers));

  Future<dynamic> _post(String path, [Object? body]) async => _decode(
      await http.post(_uri(path), headers: _headers, body: jsonEncode(body ?? {})));

  Future<dynamic> _delete(String path) async =>
      _decode(await http.delete(_uri(path), headers: _headers));

  // ---- auth ---------------------------------------------------------------

  Future<void> login(String serverUrl, String username, String password) async {
    _baseUrl = normalizeUrl(serverUrl);
    final data = await _post('/auth/login', {'username': username, 'password': password});
    _token = data['token'] as String;
    user = Map<String, dynamic>.from(data['user'] as Map);

    // Only tutor accounts have a faculty record; nothing under /api/my works
    // without one, so refuse the login here rather than failing on every screen.
    if (user!['faculty_id'] == null) {
      _token = null;
      user = null;
      throw ApiException(403, 'This app is for tutors. Your account is not linked to a faculty record.');
    }
    await _persist();
  }

  Future<void> logout() async {
    _token = null;
    user = null;
    await _persist();
  }

  // ---- tutor self-service (all scoped server-side to this tutor) -----------

  Future<List<Map<String, dynamic>>> schedule() async => _list(await _get('/my/schedule'));

  Future<List<Map<String, dynamic>>> leave() async => _list(await _get('/my/leave'));

  Future<void> applyLeave(String date, String? reason) async =>
      _post('/my/leave', {'leave_date': date, 'reason': reason});

  Future<void> removeLeave(int id) async => _delete('/my/leave/$id');

  Future<List<Map<String, dynamic>>> sessions() async => _list(await _get('/my/sessions'));

  Future<void> requestSession(Map<String, dynamic> body) async => _post('/my/sessions', body);

  Future<void> withdrawSession(int id) async => _delete('/my/sessions/$id');

  // ---- reference data for the request form --------------------------------

  Future<List<Map<String, dynamic>>> programs() async => _list(await _get('/programs'));
  Future<List<Map<String, dynamic>>> activities() async => _list(await _get('/activities'));
  Future<List<Map<String, dynamic>>> classrooms() async => _list(await _get('/classrooms'));

  Future<List<Map<String, dynamic>>> slots(int programId) async =>
      _list(await _get('/slots', {'program_id': '$programId'}));

  Future<List<Map<String, dynamic>>> batches(int programId) async =>
      _list(await _get('/batches', {'program_id': '$programId'}));

  List<Map<String, dynamic>> _list(dynamic v) =>
      (v as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
}

final api = Api();
