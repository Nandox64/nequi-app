# Sistema de bloqueo + device binding (IMPLEMENTADO v3)

## Arquitectura actual

### `users_access/{phone}` — doc ÚNICO

```javascript
{
  phoneNumber: "300...",
  devices: {
    "uuid-device-A": {
      name: "Xiaomi Redmi",
      is_blocked: false,
      blockReason: null,
      firstSeenAt: Timestamp,
      lastLoginAt: Timestamp,
      loginCount: 5
    },
    "uuid-device-B": {
      name: "Chrome Windows",
      is_blocked: true,
      blockReason: "device_replaced",
      firstSeenAt: Timestamp,
      lastLoginAt: Timestamp,
      loginCount: 2
    }
  },
  activeDeviceId: "uuid-device-A",
  authEmail: "300...@phone.nequi.co"
}
```

- **TODO en un solo doc**: el mapa `devices` contiene TODOS los dispositivos
- Admin ve y controla todo desde una sola pantalla en Firestore
- **NO hay** `is_blocked`, `deviceId`, `blockReason`, `status` al nivel del doc principal (solo dentro de `devices.{id}`)
- `ensureDeviceMap()` limpia campos legacy automáticamente

### `users_access/{phone}/access_history/{autoId}` — auditoría
- Sin cambios: cada entrada tiene `name` e `is_blocked`

## Flujo

### Conmutado (cambio de dispositivo):
1. Device A activo (`is_blocked: false`) con `activeDeviceId = "uuid-A"`
2. Device B se registra → PATH 2 lo agrega al mapa como bloqueado (usa `update()` con dot notation → A NO se pierde)
3. Admin pone Device B `is_blocked: false` en Firestore
4. Device B hace login → `submitPin` pre-check pasa → `ensureUserAccessDoc` PATH 4:
   - Itera `Object.entries(devices)` → encuentra A con `is_blocked: false` → bloquea A
   - Setea `activeDeviceId = "uuid-B"`
   - **Clave: PATH 2 y PATH 3 usan `update()` con dot notation, NO `set({ merge: true })`** (que reemplaza todo el map)
5. Device A escucha main doc via `verifyStatusSilently` → detecta `is_blocked: true` → pantalla bloqueada

### Admin elimina el doc completo:
1. `verifyStatusSilently` detecta `!doc.exists` → "Cuenta eliminada"
2. Desregistra sesión admin, muestra pantalla bloqueada

### Admin modifica `is_blocked` directamente en Firestore:
1. Cambio a `true` → listener detecta → pantalla bloqueada
2. Cambio a `false` → listener detecta + `currentScreen === 'blocked'` → login

## Bugs corregidos

### Bug 1: `set({ merge: true })` reemplazaba todo el map `devices`
- PATH 2 (nuevo device) y PATH 3 (blocked device) usaban `set({ merge: true })` que REEMPLAZA el campo `devices` entero
- Si el map tenía A y B, al agregar C se perdían A y B
- **Fix:** Reemplazar por `update()` con dot notation:
  - PATH 2: `update({ ["devices.{id}"]: { ... } })` → agrega sin borrar
  - PATH 3: `update({ ["devices.{id}.lastLoginAt"]: ts, ["devices.{id}.loginCount"]: n })` → actualiza sin borrar

### Bug 2: `submitPin()` ignoraba return de `ensureUserAccessDoc`
- Cuando un device nuevo se registraba, `ensureUserAccessDoc` PATH 2 devolvía `deviceBlocked: true`
- `submitPin()` no revisaba el return y llamaba `finishPinLogin()` igual
- **Fix:** Post-check: `if (result.deviceBlocked) { mostrar bloqueado; return; }`

### Bug 3: Campos legacy `is_blocked`, `deviceId`, `blockReason` en top-level
- Docs viejos tenían `is_blocked`, `deviceId`, `blockReason` fuera del map
- `ensureDeviceMap()` ahora los limpia con `FieldValue.delete()`

## Cambios en `www/app.js`

| Función | Línea | Cambio |
|---------|-------|--------|
| `ensureDeviceMap()` | 216 | Migra legacy + limpia campos viejos (`FieldValue.delete()`) |
| `ensureUserAccessDoc()` | 262 | 4 paths limpios. PATH 2 y 3 usan `update()` no `set()` |
| `completeAdminSetup()` | 573 | Llama `ensureDeviceMap()` antes de `ensureUserAccessDoc` |
| `checkAccessControl()` | 400 | Lee device del map. Llama `ensureDeviceMap()` |
| `verifyStatusSilently()` | 474 | **Único listener** al main doc, revisa mapa de devices |
| `submitPin()` | 1419 | Pre-check server + post-check de `ensureUserAccessDoc` |

### Eliminado
- Subcolección `devices/{deviceId}` (se reemplazó por mapa en main doc)
- Helpers `getDeviceDocRef()`, `getAllDeviceDocs()`
- Código legacy: `activeDeviceId` fallback dentro de PATH 4
- Llamada a `ensureDeviceMap()` dentro de `ensureUserAccessDoc()` (ahora se llama desde entry points)
