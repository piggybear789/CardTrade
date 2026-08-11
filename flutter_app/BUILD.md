# Platform Configuration & Build Flavors

## Build Commands

### Development
```bash
flutter run --dart-define-from-file=config/dev.env
```

### Staging
```bash
flutter run --dart-define-from-file=config/staging.env
```

### Production
```bash
flutter run --release --dart-define-from-file=config/prod.env
```

### Build for Release
```bash
# Android
flutter build appbundle --release --dart-define-from-file=config/prod.env

# iOS
flutter build ipa --release --dart-define-from-file=config/prod.env
```

## Environment Files

Create `config/dev.env`, `config/staging.env`, `config/prod.env` with:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
STRIPE_PUBLISHABLE_KEY=pk_test_...
DEFAULT_REGION=AU
PRODUCTION=false
```

**Never commit real keys to source control.** Add `config/*.env` to `.gitignore`.

## Deep Linking Setup

### iOS (ios/Runner/Info.plist)
Add under `<dict>`:
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>cardtrade</string>
    </array>
  </dict>
</array>
<key>FlutterDeepLinkingEnabled</key>
<true/>
```

### Android (android/app/src/main/AndroidManifest.xml)
Add inside `<activity>`:
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="cardtrade" />
</intent-filter>
```

### Universal Links (iOS)
Create `ios/Runner/Runner.entitlements`:
```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:cardtrade.app</string>
</array>
```

Host `.well-known/apple-app-site-association` on your web domain.

### App Links (Android)
Add verified `autoVerify` intent filter:
```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="cardtrade.app" />
</intent-filter>
```

Host `.well-known/assetlinks.json` on your web domain.
