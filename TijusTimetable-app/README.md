# Tijus Timetable — tutor app (Android)

A small Flutter app that lets a **tutor** sign in and:

- **My Schedule** — view their approved sessions, grouped by day (read-only).
- **My Leaves** — apply for leave, see whether each request is pending / approved /
  rejected (with the admin's reason), and withdraw a pending request.
- **My Sessions** — request a new session for themselves, track its status, and
  withdraw it while it is still pending.

Leave and session requests land **pending** and only take effect once an admin
approves them in the web app under **Approvals**. Nothing here can edit an
existing approved session — changing the live timetable stays with the
allocation team.

The app talks to the existing server; it adds no new endpoints. It uses
`/auth/login` and the tutor-scoped `/api/my/*` routes, which the server already
restricts to the signed-in tutor's own faculty record.

## The APK

Two release builds sit in this folder, one per CPU architecture:

| File | Size | For |
| --- | --- | --- |
| `TijusTimetable.apk` | ~17 MB | **arm64-v8a** — every Android phone since ~2017. Use this one. |
| `TijusTimetable-armeabi-v7a.apk` | ~15 MB | 32-bit ARM only — older/budget devices |

A single universal APK carrying all three architectures is ~50 MB, of which
~48 MB is native libraries a given phone will never load. Splitting per ABI cuts
the download by two thirds. (`x86_64` is built too, but it only matters for
emulators, so it isn't distributed.)

If `TijusTimetable.apk` reports *"App not installed"* on an old handset, that
device is 32-bit — give it the `armeabi-v7a` build.

Install by copying the file to the phone and opening it — Android will ask you to
allow installs from unknown sources, since it isn't distributed via the Play
Store. Or, with the device connected over USB debugging:

```
adb install -r TijusTimetable.apk
```

The splits carry distinct `versionCode`s (1001 for `armeabi-v7a`, 2001 for
`arm64-v8a`), which Flutter offsets by ABI so a 64-bit device never sees the
32-bit build as an upgrade.

### Signing

This APK is signed with Flutter's **debug key**, which is what `flutter build
apk --release` falls back to when no release keystore is configured. That is
fine for sideloading inside the academy, but it cannot be uploaded to the Play
Store, and an APK signed with a different key later will not upgrade over it —
it must be uninstalled first. To ship properly, create a keystore and a
`android/key.properties`, then wire it into `android/app/build.gradle.kts`.

## Server address

The app points at the live server by default:

```
https://timetable.tijusacademy.com
```

The login screen pre-fills it, so a tutor normally just types their username and
password. The field stays editable (and whatever they sign in with is
remembered) so the same APK can be aimed at a local server for testing.

Both `https://host` and `https://host/api` are accepted, a trailing slash is
stripped, and a bare `host:4000` gets `http://` prepended.

To build an APK pointing somewhere else, override the default at build time —
`10.0.2.2` is how the Android emulator reaches the host machine's localhost:

```
flutter build apk --release --dart-define=TT_DEFAULT_URL=http://10.0.2.2:4000
```

Two Android details this depends on, both configured in
`android/app/src/main/AndroidManifest.xml`:

- **`INTERNET` permission.** Flutter only declares this in its debug and profile
  manifests, so a release APK cannot reach the network without it being added to
  the main manifest.
- **Cleartext HTTP** is permitted via `res/xml/network_security_config.xml`.
  The production URL is HTTPS and does not need this; it is kept only so the
  editable server field can still reach a plain-HTTP server on the local network
  (Android blocks cleartext by default since Android 9). If you never point the
  app at a local server, set `cleartextTrafficPermitted="false"` to harden it.

## Launcher icon

The source logo is `learning.png` — a round badge drawn on an **opaque black
square** (it has no alpha channel). Used as-is, every launcher would draw black
corners around the badge, so it is pre-processed before being handed to
`flutter_launcher_icons`:

```
python tool/make_icons.py        # learning.png -> assets/icon/*
dart run flutter_launcher_icons  # assets/icon/* -> android/.../res/
```

`tool/make_icons.py` finds the badge, cuts it out with an anti-aliased circular
mask (inset slightly, or the rim's blend-to-black leaves a grey halo), and
writes:

| File | Used as |
| --- | --- |
| `assets/icon/icon.png` | legacy icon — badge on white, unmasked |
| `assets/icon/icon_foreground.png` | adaptive foreground — badge near full-bleed, transparent |

The adaptive foreground is deliberately **not** scaled into the 72/108 safe zone
here: `flutter_launcher_icons` already wraps it in `<inset android:inset="16%">`.
Doing both would compound (0.67 × 0.68 ≈ 45%) and leave the badge floating in a
fat white margin. Full-bleed in, ~66% out — just inside the safe zone.

The adaptive background is a flat white (`#FFFFFF`, written to
`res/values/colors.xml`), so the navy badge reads on any launcher mask shape.

## Building

The small, per-architecture APKs that ship above:

```
flutter pub get
flutter build apk --release --split-per-abi \
  --obfuscate --split-debug-info=build/symbols \
  --extra-gen-snapshot-options=--strip

cp build/app/outputs/flutter-apk/app-arm64-v8a-release.apk   TijusTimetable.apk
cp build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk TijusTimetable-armeabi-v7a.apk
```

`--obfuscate` needs `--split-debug-info`, which writes the symbol files to
`build/symbols` — keep them if you ever need to de-obfuscate a stack trace.
`--extra-gen-snapshot-options=--strip` drops DWARF debug data from the AOT
library; it silences a build warning but does not measurably shrink the APK,
since the debug sections compress away anyway.

A single universal APK (~50 MB, all architectures) if you'd rather hand out one
file:

```
flutter build apk --release
cp build/app/outputs/flutter-apk/app-release.apk TijusTimetable.apk
```

## Tests

`test/api_test.dart` covers URL normalisation offline, plus a live-server group
that exercises the real `Api` class end to end — login, the non-tutor guard, the
leave apply/withdraw round trip, and the session request/withdraw round trip.

```
flutter test          # unit tests only; the live group is skipped

flutter test \
  --dart-define=TT_URL=http://localhost:4000 \
  --dart-define=TT_USER=<tutor> --dart-define=TT_PASS=<password>
```

Optionally add `--dart-define=TT_ADMIN_USER=… --dart-define=TT_ADMIN_PASS=…` to
also check that a non-tutor account is refused.

> Note: `TestWidgetsFlutterBinding` installs an `HttpOverrides` that answers
> every HTTP request with a fake `400` and never touches the network. The suite
> clears it in `setUpAll`; without that, the live tests silently assert against a
> stub rather than the server.

## Layout

| File | Purpose |
| --- | --- |
| `lib/api.dart` | HTTP client, token/base-URL persistence, `ApiException` |
| `lib/main.dart` | App shell, bottom navigation, sign-out |
| `lib/login_screen.dart` | Server address + credentials |
| `lib/schedule_tab.dart` | Approved sessions, grouped by day |
| `lib/leave_tab.dart` | Leave list + apply sheet |
| `lib/sessions_tab.dart` | Session requests + request sheet |
| `lib/widgets.dart` | Status badge, date helpers, shared list/empty/error states |
