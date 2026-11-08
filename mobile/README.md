# Flo for Android (companion app)

The phone half of Flo. It pairs with your Flo account by scanning a QR code on your Mac. While you're **Away** from the Mac, it gets push notifications for things like "Claude finished in api · 3 files changed", today's to-dos, reminders, scheduled skill results and meeting summaries.

- Stack: Expo SDK 58 (React Native 0.88, TypeScript), Android only. A web build exists only for visual review.
- Push: native **FCM** device token (`getDevicePushTokenAsync`). The Flo server sends through FCM HTTP v1 directly; Expo's push service is not used.
- API contract: [`../docs/mobile-api.md`](../docs/mobile-api.md). The client is in `src/api/client.ts`.
- Package id: `com.flo.companion`

```
App.tsx                     routing, transitions, toast, deep links (flo-pair://)
src/api/client.ts           HTTP client (pair/claim, presence, device, inbox, unpair)
src/api/mock.ts             ?mock mode (web preview with demo data)
src/lib/pairing.ts          flo-pair:// parsing, code + server URL validation
src/lib/inbox.ts            inbox normalise / merge / dedupe
src/lib/kinds.ts            kind → group, colour, Android channel
src/notifications/push.ts   channels, POST_NOTIFICATIONS, FCM token, listeners
src/state/FloContext.tsx    app state, polling, token refresh, in-app banners
src/screens/*               Welcome, Scan, Enter code, Home, Settings
__tests__/*                 jest (jest-expo preset)
```

## Develop

```bash
cd mobile
npm install
npm test             # jest unit tests
npm run typecheck    # tsc --noEmit
npm run web          # visual preview → open http://localhost:8081/?mock
```

Mock URLs for the web preview: `?mock&screen=welcome|scan|code|home|settings`. Add `&empty` for an empty inbox or `&banner` to see a sample in-app banner.

## 1. Firebase setup (one time; needed for push)

The app will not build without `google-services.json`. It is git-ignored, so each developer supplies their own copy.

1. Go to <https://console.firebase.google.com>, click **Create a project** (any name, e.g. `flo`). Google Analytics is optional; you can turn it off.
2. In the project, click **Add app → Android**.
   - **Android package name:** `com.flo.companion` (must match exactly)
   - Nickname: `Flo` (optional). Leave SHA-1 empty; FCM doesn't need it.
3. Click **Download google-services.json** and save it as `mobile/google-services.json`. Skip the "Add Firebase SDK" steps, because Expo handles them.
4. Make sure the **Firebase Cloud Messaging API (V1)** is enabled: Project settings → **Cloud Messaging** tab. It should say *Enabled*. If it doesn't, follow the link to enable it in Google Cloud Console.

### Service-account key for the server

The Flo server (`website/`) uses this key to sign FCM HTTP v1 requests.

1. Firebase console → ⚙ **Project settings → Service accounts**.
2. Click **Generate new private key → Generate key**. A JSON file downloads.
3. Store it **outside the repo**, e.g. `~/.config/flo/fcm-service-account.json`, and `chmod 600` it.
4. Point the server at it, e.g. in `website/.env.local`:
   ```
   FCM_SERVICE_ACCOUNT_FILE=/Users/you/.config/flo/fcm-service-account.json
   ```
   You can instead put the whole JSON in `FCM_SERVICE_ACCOUNT` (useful on hosts like Vercel).
5. Restart the server. If neither variable is set, `POST /api/push` still stores to the inbox but returns `pushed: 0, reason: "push not configured"`.

Never commit either file. `mobile/.gitignore` ignores `google-services.json` and `*service-account*.json`.

## 2. Get an installable APK

### Path A: EAS cloud build (recommended; no Java or Android SDK needed)

You need a free Expo account (<https://expo.dev/signup>).

```bash
cd mobile
# google-services.json must exist here (step 1)
npx --yes eas-cli@25.3.0 login
npx --yes eas-cli@25.3.0 init          # first time only: links/creates the EAS project (adds extra.eas.projectId to app.json)
npm run android:apk                    # = eas build -p android --profile preview
```

- The `preview` profile in `eas.json` produces an **APK** (`buildType: "apk"`, internal distribution). EAS creates and stores an Android signing keystore for you the first time. Answer **Yes** when asked.
- `google-services.json` is git-ignored, so EAS won't upload it with the source. Upload it once as a secret file variable. `app.config.js` picks it up from `GOOGLE_SERVICES_JSON`:
  ```bash
  npx --yes eas-cli@25.3.0 env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment preview
  ```
- When the build finishes, EAS prints a URL and a QR code. Open it on the phone, download the `.apk`, and allow "Install unknown apps" for your browser when Android asks.

### Path B: local build (needs JDK 17 + Android SDK)

1. Install **JDK 17** (e.g. Temurin 17) and **Android Studio**. In Android Studio → SDK Manager, install Android SDK Platform 36 and Build-Tools, plus the Command-line Tools.
2. Set up the environment (zsh):
   ```bash
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```
3. Build:
   ```bash
   cd mobile
   npm run android:apk:local   # expo prebuild + ./gradlew assembleRelease
   ```
   The APK appears at `android/app/build/outputs/apk/release/app-release.apk`. By default the release build is signed with the debug keystore, which is fine for sideloading onto your own phone. Install it with `adb install -r android/app/build/outputs/apk/release/app-release.apk`. Or, with the phone plugged in and USB debugging on, run `npm run android` (`expo run:android`).

## 3. Turn on push end to end

1. Finish step 1 on both sides: `google-services.json` in the app build, and `FCM_SERVICE_ACCOUNT_FILE` on the server.
2. Install the APK and open Flo. Tap **Pair with your Mac** and scan the QR from Flo on the Mac (or enter the server and the 6-digit code).
3. Allow notifications when Android 13+ asks. If you missed the prompt, go to **Settings → Notifications → Allow** (or *Open settings*).
4. Set yourself **Away**, either on the Mac or with "I'm away" on the phone. Send a test notification from the desktop and it should arrive on the phone.

### Testing against your Mac's dev server (http://localhost:3000)

The phone can't reach `localhost`. Start the website with your Mac's LAN address so the QR payload contains a reachable host:

```bash
SITE_URL=http://192.168.1.20:3000 npm run dev -- -H 0.0.0.0     # in website/
```

LAN hosts (`192.168.*`, `10.*`, `*.local`, `localhost`) are assumed to be plain `http`. Every other host uses `https`. A payload can force a scheme with `flo-pair://host/123456?scheme=http`. Cleartext HTTP is enabled in the Android build (`expo-build-properties` → `usesCleartextTraffic`) so LAN dev servers work.

## Behaviour notes

- **Channels.** The app creates Android channels `claude` (high), `todos`, `reminders` (high), `skills`, `meetings` and `default`. FCM pushes without a `channel_id` land in `default`. To route each kind to its own channel (so users can silence one in Android settings), the server should send `android.notification.channel_id` = the channel for that kind (see `src/lib/kinds.ts`).
- **Foreground.** While the app is open, the system heads-up is suppressed and an in-app banner is shown instead. Muted kinds show nothing, and the inbox refreshes.
- **Mutes** live on the device. They filter the inbox and silence in-app banners. Lock-screen pushes for a kind can be silenced through its Android channel ("Android notification settings" in Settings).
- **Token refresh.** When FCM rotates the token, the app calls `POST /api/mobile/device { pushToken }`. On each launch the current token is compared with the last one sent.
- **401 from the server** (device removed on the Mac) signs the phone out and returns to the pairing screen.
- **Polling.** Presence and the inbox (`?after=<newest id>`) refresh every 30 s while the app is in the foreground, on resume, and on pull to refresh.
- **Security.** The device token is stored in the Android Keystore through `expo-secure-store`. The camera is used only to scan the QR code. `RECORD_AUDIO` and storage permissions are stripped from the manifest.
