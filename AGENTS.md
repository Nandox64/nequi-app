# Nequi Colombia Clone — Project Context

## Project Overview
Nequi-style banking app using Capacitor Android WebView. Plain HTML/CSS/JS in `www/`, Android native wrappers in `android/`, Firebase admin backend in `admin-panel/`.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Icons**: Lucide (loaded via CDN, `lucide.createIcons()` in `index.html`)
- **Mobile**: Capacitor v8 Android WebView
- **Backend**: Firebase Admin SDK (`firebase-admin`)
- **Auth**: PIN-based (SHA-256 hashed + dynamic device salt, stored in localStorage)
- **Database**: Firestore (collections: `users_data`, `users_access`)
- **Build**: `npx cap copy android && gradlew.bat assembleDebug`
- **Dev**: `npx serve . -l 3000`

## Build Commands
- `npm run dev` — local HTTP server on port 3000
- `npm run sync` — `npx cap copy android`
- `npm run build` — debug APK via gradle
- `npm run install` — `adb install` the debug APK
- `npm run apk` — sync + build (full APK rebuild)

## Architecture

### Storage
| Dato | Dónde | Offline? |
|------|-------|----------|
| PIN hash | localStorage | ✅ Sí |
| PIN lockout | localStorage | ✅ Sí |
| Device ID | localStorage | ✅ Sí |
| Sesión (admin_phone, admin_access_granted) | localStorage | ✅ Sí |
| Nombre + saldo (fallback) | localStorage | ✅ Sí |
| Saldo, movimientos, contactos, nombre | **Firestore** | No necesario |
| FCM tokens | Firestore | No |

### PIN Security
- Salt dinámico: `_nequi_{phone}_{deviceId}` (único por usuario + dispositivo)
- Algoritmo: SHA-256 via `crypto.subtle.digest()`
- Migración automática: si verify falla con salt nuevo, prueba con legacy `_nequi_pin_2026` y migra
- Lockout: 4 intentos → 1 hora de bloqueo

### Firebase Sync
- `saveDB()` escribe directo a Firestore `users_data/{phone}`
- `loadDB()` carga de Firestore, fallback a `admin_display_name`/`admin_display_balance` en localStorage
- No hay DB_VERSION ni almacenamiento de DB completa en localStorage

### Access Control (Firestore `users_access/{phone}`)
- Nuevos usuarios: `is_blocked: false, status: 'active'` (entrada inmediata)
- Cuentas `pending` se auto-activan si el dispositivo coincide
- Admin puede bloquear via `admin-panel/`

## Service Worker — ELIMINADO
- `sw.js` eliminado del proyecto
- Push notifications en Android funcionan via Capacitor nativo sin SW
- En browser, push notifications no funcionan (no necesario para la app Android)

## Modo Oscuro — ELIMINADO
- Todo el código de modo oscuro eliminado (funciones JS, CSS `body.dark-mode`, toggle en Perfil)
- Colores originales restaurados en CSS

## Critical Bug Fixes Applied

### Bottom Nav Transparency Bug
- **Root cause**: GPU compositing layer artifact — the `position: fixed` nav showed a dark semi-transparent overlay on the dashboard in WebView.
- **Fix**: `www/style.css` — added `transform: translateZ(0)` to `nav.bottom-nav` to force a separate compositing layer.

### SHA-256 PIN Migration + Device Salt
- **Files**: `www/app.js` — `hashPin(pin, phone)`, `getDeviceId()`, `getPinSalt(phone)`, `hashPinLegacy()`, `verifyPin()`
- **Change**: Salt now includes device UUID (`_nequi_{phone}_{deviceId}`) instead of fixed `_nequi_pin_2026`
- **Legacy fallback**: `verifyPin()` tries new salt first, falls back to legacy salt, auto-migrates on match

### Stale localStorage vs Empty Firestore
- **Problem**: After deleting Firestore records, stale `firestore_doc_created` flag in localStorage blocked access
- **Fix**: `submitPin()` — when Firestore doc doesn't exist, clear stale flag and let `ensureUserAccessDoc()` recreate it
- **Fix**: `ensureDeviceBound()` — pending accounts with matching device now allowed through
- **Fix**: `ensureUserAccessDoc()` — auto-activates pending accounts when device matches

### Missing variable declarations
- **Problem**: `let currentScreen`, `isBalanceVisible`, `accessStatusUnsubscribe`, `currentScreenBeforeAyuda` were accidentally removed when deleting dark mode code
- **Fix**: Restored declarations in `app.js`

### FAB button not closing
- **Problem**: `showSendOptions()` closed overlay but didn't remove `fab-active` class from button
- **Fix**: Added `btnOpenFab.classList.remove('fab-active')` in `showSendOptions()`

### Card layout (`.sheet-card`)
- **Problem**: `.sheet-card` had `flex-direction: column` + `gap: 8px` causing elements to stack vertically
- **Fix**: Restored original flex row layout with `align-items: center`

### Other Fixes (Audit Findings)
- **Duplicate `send-options-modal`** removed from `index.html`.
- **`validateMovements()`** implemented — filters null entries, validates timestamp and amount.
- **Withdraw countdown timer** cleaned up on `navigateTo('withdraw-code')`.
- **Console logs** guarded behind `if (DEBUG_MODE)`.
- **Admin panel**: query changed from `timestamp` to `createdAt`.

### Android Native Changes
- `styles.xml`: `navigationBarColor` and `statusBarColor` set to `#200020`.
- `activity_main.xml`: CoordinatorLayout background `#200020`.
- `MainActivity.java`: WebView background `#200020`, system bars solid.

### Push Notifications — Android Native (Capacitor)
- **Approach**: `@capacitor/push-notifications` on Android native (no SW needed)
- **Files**: `www/app.js:260-320` — `setupCapacitorPush()`, `setupFCM()`
- **Token**: Stored in Firestore `users_access/{phone}.fcmTokens`
- **Deps**: `@capacitor/push-notifications@8.0.4`, `google-services.json` in `android/app/`
- **Android manifest**: Added `POST_NOTIFICATIONS` and `VIBRATE` permissions

### Security
- `service-account-key.json` in `.gitignore`, never tracked — still on disk, needs rotation in Firebase Console
- `admin-panel/Claves Github/github-recovery-codes.txt` in `.gitignore`

## Key Conventions
- `const DEBUG_MODE` at top of `app.js` controls debug logging (false = production)
- Navigation: `window.navigateTo(screenName)` — uses `window.location.hash`
- Theme: Purple-dark (`#200020` background, `#F7F5FA` nav default)
- All screens are in `www/` as HTML divs shown/hidden by nav
- Error display: `#debug-msg` element visible when errors occur during init
- FAB closes on: `showScreen()`, overlay click, QR/recharge/send options open

## Remaining Pending Items
1. Rotate Firebase Admin SDK key in Firebase Console.
2. `google-services.json` contains an API key — consider restricting it in Firebase Console to only Android app `com.nivel24.nequi`.
3. Vinculación real con APIs bancarias / Transfiya / Bre-B (actualmente simulado).
4. Soporte de múltiples tarjetas.
5. Historial de retiros (códigos generados).
6. Compartir QR de Nequi para recibir plata.
7. Tests automatizados.
