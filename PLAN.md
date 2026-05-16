# Plan del Proyecto Nequi

## Descripción
Clon funcional de la app Nequi Colombia — web app + Android (Capacitor) + script Firebase Admin + Admin Panel.

## Estructura
```
/
├── www/                    # Web app (HTML, CSS, JS, assets)
│   ├── index.html          # SPA con ~30 pantallas
│   ├── app.js              # Lógica principal (~168 KB)
│   ├── style.css           # Estilos completos
│   ├── db.js               # Estado inicial offline
│   ├── bg-voucher.js       # Fondo voucher en base64
│   ├── manifest.json       # PWA manifest
│   ├── img/                # PNGs organizados
│   └── *.png / .jpg        # Assets
├── android/                # Proyecto Capacitor Android
├── admin-panel/            # Panel administrativo (Firebase Auth + Firestore)
├── reset-password.js       # Script CLI reset Firebase Auth password
├── notifications-server.js # Servidor de notificaciones push
├── package.json            # Scripts: dev, sync, build, apk
└── capacitor.config.json   # App ID: com.nivel24.nequi
```

## Build Commands
- `npm run dev` — local HTTP server on port 3000
- `npm run sync` — `npx cap copy android`
- `npm run build` — debug APK via gradle
- `npm run apk` — sync + build

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS + Lucide icons (CDN)
- **Mobile**: Capacitor v8 Android WebView
- **Backend**: Firebase Admin SDK
- **Auth**: PIN-based (SHA-256 + dynamic device salt, localStorage)
- **DB**: Firestore (`users_data`, `users_access`)

## Storage
| Dato | Dónde | Offline? |
|------|-------|----------|
| PIN hash | localStorage | ✅ |
| PIN lockout | localStorage | ✅ |
| Sesión | localStorage | ✅ |
| Saldo/movimientos | Firestore | Fallback localStorage |
| Contactos | Firestore | No necesario |
| FCM tokens | Firestore | No |

## Completado

### Features principales
- [x] Login/registro con PIN (hash SHA-256 + salt dinámico)
- [x] Dashboard con saldo, banner, favoritos, sugeridos
- [x] Enviar plata (Nequi, Bancolombia, Transfiya, Bre-B)
- [x] QR para recibir plata (modal desde FAB)
- [x] Sacar plata (retiro con código + timer 30 min)
- [x] Bolsillos (crear, listar, estado vacío)
- [x] Colchón (meter/sacar, movimientos)
- [x] Tarjeta Nequi Visa (bloquear/desbloquear)
- [x] Movimientos (historial, filtros día/más, buscador)
- [x] Servicios (grid de operadores + detalle + pago)
- [x] Notificaciones (tabs: recibidas/en espera)
- [x] Préstamos (simulado con monto pre-aprobado)
- [x] Bre-B (gestión de llaves, envío)
- [x] Perfil (editar nombre, cambiar PIN, seguridad)
- [x] Ayuda (buscador, reportar, casos)
- [x] Edit favoritos (modal con grid + agregar/quitar)
- [x] Admin Panel (login, dashboard, toggle bloqueo, datos usuario)

### Bugs corregidos (sesiones anteriores)
- Bottom nav transparency bug (`transform: translateZ(0)`)
- SHA-256 PIN migration + device salt dinámico
- Stale localStorage vs empty Firestore
- Missing variable declarations
- FAB button not closing
- Card layout flex-direction
- Duplicate `send-options-modal`
- `validateMovements()` implemented
- Withdraw countdown timer cleanup
- Console logs guarded behind `DEBUG_MODE`

### Corregido el 2026-05-15
- [x] Input celular en Enviar plata filtra no-dígitos
- [x] Padding bottom en modales contacto/cliente
- [x] `showComingSoon()` reemplaza mensajes "Próximamente" (14 reemplazos)
- [x] `verifyStatusSilently` con flag de error de conexión + server fetch
- [x] Banner offline "Sin conexión" en dashboard
- [x] Bolsillos imagen centrada (`.pockets-empty`)
- [x] `pockets` en lista `hide-nav`
- [x] PNGs organizados en `www/img/`
- [x] Recuperación de trabajo perdido desde APK instalado en celular vía `adb`

### Corregido el 2026-05-16
- [x] Cambio global `type="tel"` → `type="number"` en inputs numéricos
- [x] `login-phone` restaurado a `type="tel"` (readonly display)
- [x] 16 PNGs faltantes restaurados desde APK del celular
- [x] `logo_créditos.png` renombrado a `logo_creditos.png` (sin acento)
- [x] Rutas rotas corregidas (`logo_créditos.png` sin prefijo `img/`)
- [x] Status bar nativa con `@capacitor/status-bar` plugin
- [x] `styles.xml`: `statusBarColor` → `#200020`, `windowLightStatusBar=false`
- [x] `setStatusBarTheme()` ahora controla la status bar nativa por pantalla
- [x] Icono "Disponible" reemplazado por `img_disponible.png` (selector origen + confirmación)
- [x] Texto "Disponible" cambiado de `color: white` a `color: var(--nequi-purple-dark)`
- [x] Botón "Sigue" se deshabilita (pálido) hasta llenar Cel y Cuanto
- [x] `banner_inicio.jpeg` full screen antes del login, se cierra al tocar
- [x] Banner-inicio respeta safe area (`top: var(--system-status-safe-top)`)

### En progreso
- [x] Splash de inicio con logo Nequi animado (N-equi split con desaparición de 'equi')
- [x] Splash actual (puntos saltando) queda como `#loading-overlay` genérico
- [ ] Banner-inicio (desactivado temporalmente para desarrollo)

## Notas
- `Codigos.txt` está vacío
- `service-account-key.json` está en `.gitignore`
- Firebase en modo compat (`firebase-app-compat.js`, etc.)
- PIN usa SHA-256 con salt `_nequi_{phone}_{deviceId}`
- Migración automática de hashes legacy (`_nequi_pin_2026`)
- Todos los cambios se commitean después de cada corrección
- PNGs están en `www/img/` (antes en `www/`)
- `@capacitor/status-bar@8.0.2` instalado para control nativo de status bar
- `@capacitor/cli` instalado globalmente para comandos `cap`
