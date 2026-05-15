# Plan del Proyecto Nequi

## Descripción
Proyecto relacionado con Nequi Colombia que incluye:
- Script de reseteo de contraseñas via Firebase Admin SDK (`reset-password.js`)
- Web app (carpeta `www/`) 
- Aplicación Android con Capacitor (`android/`)

## Estructura
```
/
├── reset-password.js      # Script para cambiar contraseñas en Firebase Auth
├── package.json            # Dependencias Node.js (firebase-admin)
├── capacitor.config.json   # Configuración de Capacitor
├── www/                    # Web app (HTML, CSS, JS, assets)
├── android/                # Proyecto Android (Capacitor)
└── service-account-key.json # (no incluido en repo, se genera desde Firebase)
```

## Próximos pasos / Tareas

- [x] Crear script `reset-password.js` con prompt interactivo para cambiar contraseña en Firebase Auth
- [x] Botón compartir en voucher: capturar `.receipt-card` como imagen PNG con html2canvas y compartir vía Web Share API nativa

## Completado (2026-05-15)
- [x] Input celular en Enviar plata filtra no-dígitos (`www/index.html`)
- [x] Padding bottom en modales contacto/cliente (`www/style.css`)
- [x] `showComingSoon()` reemplaza los 10 mensajes "Próximamente" en Perfil, Ayuda, Tarjeta, Negocios (`www/app.js`, `www/index.html`)
- [x] `verifyStatusSilently` mejorado con flag de error de conexión + server fetch (`www/app.js`)
- [x] Banner offline "Sin conexión" en dashboard + listeners online/offline (`www/index.html`, `www/style.css`, `www/app.js`)
- [x] Bolsillos — imagen centrada (clase `.pockets-empty`, margin-top eliminado)
- [x] `pockets` agregado a lista `hide-nav` para ocultar nav/FAB en Bolsillos
- [x] PNGs organizados en `www/img/` (37 archivos) con referencias actualizadas en 5 archivos

## Notas
- `Codigos.txt` está vacío — usar para lo que necesites
- `service-account-key.json` **no debe subirse al repositorio** (ya está en `.gitignore`)
