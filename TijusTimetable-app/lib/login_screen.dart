import 'package:flutter/material.dart';
import 'api.dart';
import 'widgets.dart';

class LoginScreen extends StatefulWidget {
  final VoidCallback onLoggedIn;
  const LoginScreen({super.key, required this.onLoggedIn});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final _server = TextEditingController(text: api.baseUrl);
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _hidePassword = true;
  String? _error;

  @override
  void dispose() {
    _server.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (_server.text.trim().isEmpty) return setState(() => _error = 'Enter the server address');
    if (_username.text.trim().isEmpty) return setState(() => _error = 'Enter your username');
    if (_password.text.isEmpty) return setState(() => _error = 'Enter your password');

    setState(() => _busy = true);
    try {
      await api.login(_server.text, _username.text.trim(), _password.text);
      widget.onLoggedIn();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      // a bad host, wrong port, or offline device all land here
      setState(() => _error = 'Could not reach the server. Check the address and your connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.calendar_month, size: 64, color: brand),
              const SizedBox(height: 8),
              const Text('Tijus Timetable',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: brand)),
              const Text('Tutor sign in', style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 24),
              TextField(
                controller: _server,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Server address',
                  hintText: kDefaultServerUrl,
                  helperText: 'Leave as-is unless the office tells you otherwise',
                  prefixIcon: Icon(Icons.dns),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _username,
                autocorrect: false,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Username',
                  prefixIcon: Icon(Icons.person),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _password,
                obscureText: _hidePassword,
                onSubmitted: (_) => _busy ? null : _submit(),
                decoration: InputDecoration(
                  labelText: 'Password',
                  prefixIcon: const Icon(Icons.lock),
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(_hidePassword ? Icons.visibility : Icons.visibility_off),
                    onPressed: () => setState(() => _hidePassword = !_hidePassword),
                  ),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: errRed.withValues(alpha: 0.08),
                    border: Border.all(color: errRed),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(_error!, style: const TextStyle(color: errRed)),
                ),
              ],
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(
                          width: 20, height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Sign in'),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
