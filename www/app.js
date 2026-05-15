// Nequi Premium App Logic

// 🔧 DEBUG MODE: false = producción (persiste datos entre sesiones)
// Cambia a true solo para desarrollo/testing
const DEBUG_MODE = false;

// Global error capture for on-device debugging
window.onerror = function (msg, url, line) {
    const el = document.getElementById('debug-msg');
    if (el) { el.innerText = msg + ' (line ' + line + ')'; el.style.display = 'block'; }
};
window.addEventListener('unhandledrejection', function (e) {
    const el = document.getElementById('debug-msg');
    if (el) { el.innerText = 'Promise: ' + (e.reason?.message || e.reason || '?'); el.style.display = 'block'; }
});

const APP_VERSION = '20260509';
const DEFAULT_DB_STATE = JSON.parse(JSON.stringify(db));
const ADMIN_ACCESS_COLLECTION = 'users_access';
const USER_DATA_COLLECTION = 'users_data';
const AUTH_EMAIL_DOMAIN = 'phone.nequi.co';

// --- Device identification for PIN salt ---
function getDeviceId() {
    let deviceId = localStorage.getItem('nequi_device_id');
    if (!deviceId) {
        deviceId = 'dev_' + crypto.randomUUID();
        localStorage.setItem('nequi_device_id', deviceId);
    }
    return deviceId;
}
function getPinSalt(phone) {
    return `_nequi_${normalizeColombianMobile(phone)}_${getDeviceId()}`;
}

let currentScreen = 'dashboard';
let isBalanceVisible = true;
let accessStatusUnsubscribe = null;
let currentScreenBeforeAyuda = 'dashboard';

// --- PIN Management ---

function getPinStorageKey(phone) {
    return `nequi_pin_${normalizeColombianMobile(phone)}`;
}

const OLD_PIN_SALT = '_nequi_pin_2026';

async function hashPin(pin, phone) {
    const salted = String(pin) + getPinSalt(phone);
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'p' + hashHex;
}

async function hashPinLegacy(pin) {
    const salted = String(pin) + OLD_PIN_SALT;
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'p' + hashHex;
}

function getStoredPinHash(phone) {
    return localStorage.getItem(getPinStorageKey(phone));
}

async function setStoredPin(phone, pin) {
    const key = getPinStorageKey(phone);
    localStorage.setItem(key, await hashPin(pin, phone));
}

function removeStoredPin(phone) {
    localStorage.removeItem(getPinStorageKey(phone));
}

async function verifyPin(phone, pin) {
    const stored = getStoredPinHash(phone);
    if (!stored) return false;
    // Try new dynamic salt first
    if (stored === await hashPin(pin, phone)) return true;
    // Fallback: try legacy fixed salt (migration from old PIN hashes)
    if (stored === await hashPinLegacy(pin)) {
        // Migrate old hash to new salt
        await setStoredPin(phone, pin);
        return true;
    }
    return false;
}

function hasPin(phone) {
    return !!getStoredPinHash(phone);
}

// --- Offline Access Counter ---
function getOfflineCountKey(phone) {
    return `nequi_offline_count_${normalizeColombianMobile(phone)}`;
}
function getOfflineCount(phone) {
    return parseInt(localStorage.getItem(getOfflineCountKey(phone)) || '0', 10);
}
function incrementOfflineCount(phone) {
    const count = getOfflineCount(phone) + 1;
    localStorage.setItem(getOfflineCountKey(phone), String(count));
    return count;
}
function resetOfflineCount(phone) {
    localStorage.removeItem(getOfflineCountKey(phone));
}

// 📱 Helpers de autenticación por celular
const normalizePhone = phone => (phone || '').toString().replace(/\D/g, '');

function normalizeColombianMobile(phone) {
    let digits = normalizePhone(phone);
    if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return digits;
}

function isValidColombianMobile(phone) {
    return /^3\d{9}$/.test(normalizeColombianMobile(phone));
}

function buildAuthEmailFromPhone(phone) {
    return `${normalizeColombianMobile(phone)}@${AUTH_EMAIL_DOMAIN}`;
}

function getStoredAdminPhone() {
    return normalizeColombianMobile(localStorage.getItem('admin_phone'));
}

// Firebase Auth requires minimum 6 chars for password; PIN is 4 digits
function firebasePassword(pin) {
    return 'Nivel24#' + pin;
}

// --- Firebase Auth Helpers ---
async function createFirebaseAuthUser(phone, pin) {
    if (!firebaseAuth) return null;
    const email = buildAuthEmailFromPhone(phone);
    try {
        const cred = await firebaseAuth.createUserWithEmailAndPassword(email, firebasePassword(pin));
        return cred.user;
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') return null;
        throw e;
    }
}

async function signInFirebaseAuth(phone, pin) {
    if (!firebaseAuth) return null;
    const email = buildAuthEmailFromPhone(phone);
    try {
        const cred = await firebaseAuth.signInWithEmailAndPassword(email, firebasePassword(pin));
        return cred.user;
    } catch (e) {
        if (e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') return null;
        throw e;
    }
}

async function updateFirebaseAuthPassword(phone, oldPin, newPin) {
    if (!firebaseAuth) return false;
    const email = buildAuthEmailFromPhone(phone);
    try {
        const cred = await firebaseAuth.signInWithEmailAndPassword(email, firebasePassword(oldPin));
        await cred.user.updatePassword(firebasePassword(newPin));
        return true;
    } catch (e) {
        if (e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') return false;
        throw e;
    }
}

async function firebaseAuthUserExists(phone) {
    if (!firebaseAuth) return false;
    const email = buildAuthEmailFromPhone(phone);
    try {
        // fetchSignInMethodsForEmail retorna [] si no existe, no lanza excepción
        const methods = await firebaseAuth.fetchSignInMethodsForEmail(email);
        return methods.length > 0;
    } catch {
        return false;
    }
}

function getServerTimestamp() {
    return typeof firebase !== 'undefined' && firebase.firestore
        ? firebase.firestore.FieldValue.serverTimestamp()
        : new Date().toISOString();
}

function getUserAccessRef(phoneNumber) {
    return dbFirestore.collection(ADMIN_ACCESS_COLLECTION).doc(normalizeColombianMobile(phoneNumber));
}

function getUserDataRef(phoneNumber) {
    return dbFirestore.collection(USER_DATA_COLLECTION).doc(normalizeColombianMobile(phoneNumber));
}

function resetRuntimeDB() {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_DB_STATE));
    Object.keys(db).forEach(key => delete db[key]);
    Object.assign(db, fresh);
}

function clearAdminSession() {
    const phone = getStoredAdminPhone();
    localStorage.removeItem('admin_access_granted');
    localStorage.removeItem('admin_uid');
    localStorage.removeItem('admin_auth_email');
    if (phone) {
        removeFCMToken(phone);
        removeStoredPin(phone);
        resetOfflineCount(phone);
    }
    resetRuntimeDB();
}

function setAdminSession({ phoneNumber, uid, authEmail }) {
    const phone = normalizeColombianMobile(phoneNumber);
    localStorage.setItem('admin_access_granted', 'true');
    localStorage.setItem('admin_phone', phone);
    localStorage.setItem('admin_uid', uid || '');
    localStorage.setItem('admin_auth_email', authEmail || buildAuthEmailFromPhone(phone));
    setupFCM(phone);
}

// --- Push Notifications (Capacitor native + Firebase Web SDK) ---
const VAPID_KEY = 'BG1U3NJlYRLzJwYJ69f7A5rS0ohb-JnW10VH9h3RpXD2A2wpiW8fiHYM9o_w0nODSxHEvyIl0cLpK8wX7Cxh5j0';
let currentFCMToken = null;

async function setupFCM(phone) {
    if (!dbFirestore || !phone) return;
    const normalizedPhone = normalizeColombianMobile(phone);

    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
        await setupCapacitorPush(normalizedPhone);
    } else {
        await setupBrowserFCM(normalizedPhone);
    }
}

async function setupCapacitorPush(phone) {
    try {
        const { PushNotifications } = Capacitor.Plugins;
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== 'granted') return;

        await PushNotifications.register();

        PushNotifications.addListener('registration', (registration) => {
            const token = registration.value;
            if (!token) return;
            currentFCMToken = token;
            saveFCMToken(token, phone);
        });

        PushNotifications.addListener('registrationError', err => {
            if (DEBUG_MODE) console.warn('Push reg error:', err);
        });

        PushNotifications.addListener('pushNotificationReceived', notification => {
            const title = notification.title || 'Nequi';
            const body = notification.body || '';
            if (window.showToast) {
                window.showToast(`${title}: ${body}`, 'info');
            }
            if (document.getElementById('screen-notifications')?.classList.contains('active')) {
                renderNotifications();
            }
        });
    } catch (e) {
        if (DEBUG_MODE) console.warn('Capacitor push setup error:', e);
    }
}

async function setupBrowserFCM(phone) {
    if (!firebaseMessaging) return;
    try {
        if (typeof Notification === 'undefined') return;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const token = await firebaseMessaging.getToken({ vapidKey: VAPID_KEY });
        if (!token) return;
        currentFCMToken = token;
        await saveFCMToken(token, phone);

        firebaseMessaging.onMessage(payload => {
            const title = payload.notification?.title || 'Nequi';
            const body = payload.notification?.body || '';
            if (window.showToast) {
                window.showToast(`${title}: ${body}`, 'info');
            }
            if (document.getElementById('screen-notifications')?.classList.contains('active')) {
                renderNotifications();
            }
        });
    } catch (e) {
        if (DEBUG_MODE) console.warn('FCM setup error:', e);
    }
}

async function saveFCMToken(token, phone) {
    if (!dbFirestore) return;
    try {
        await getUserAccessRef(phone).set({
            fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (e) {
        if (DEBUG_MODE) console.warn('Error saving FCM token:', e);
    }
}

async function removeFCMToken(phone) {
    if (!dbFirestore || !phone) return;
    const normalizedPhone = normalizeColombianMobile(phone);

    try {
        let token = currentFCMToken;

        if (!token && firebaseMessaging) {
            token = await firebaseMessaging.getToken({ vapidKey: VAPID_KEY }).catch(() => null);
        }

        if (token) {
            await getUserAccessRef(normalizedPhone).set({
                fcmTokens: firebase.firestore.FieldValue.arrayRemove(token),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
            try { await Capacitor.Plugins.PushNotifications.unregister(); } catch (e) { }
        }
    } catch (e) {
        if (DEBUG_MODE) console.warn('Error removing FCM token:', e);
    }
}

async function getAuthEmailForPhone(phoneNumber) {
    const phone = normalizeColombianMobile(phoneNumber);
    const fallbackEmail = buildAuthEmailFromPhone(phone);

    if (!dbFirestore) return fallbackEmail;

    try {
        const doc = await getUserAccessRef(phone).get();
        if (doc.exists) {
            const data = doc.data();
            if (data.authEmail && data.authEmail.includes('@')) return data.authEmail;
            if (data.legacyEmail && data.legacyEmail.includes('@')) return data.legacyEmail;
        }
    } catch (error) {
        if (DEBUG_MODE) console.warn('No se pudo leer el mapeo de celular antes del login:', error);
    }

    return fallbackEmail;
}

async function recordAccessHistory(phoneNumber, eventType, user, deviceIdOverride) {
    if (!dbFirestore) return;

    const deviceId = deviceIdOverride || getDeviceId();
    let deviceName = adminDisplayName || '';
    let isBlocked = null;

    if (!deviceName) {
        try {
            const snap = await getUserAccessRef(phoneNumber).get();
            const dev = snap.exists && snap.data().devices ? snap.data().devices[deviceId] : null;
            if (dev) {
                deviceName = dev.name || '';
                isBlocked = dev.is_blocked;
            }
        } catch (e) { }
    }

    try {
        await getUserAccessRef(phoneNumber).collection('access_history').add({
            eventType,
            phoneNumber: normalizeColombianMobile(phoneNumber),
            uid: user ? user.uid : localStorage.getItem('admin_uid') || null,
            deviceId,
            name: deviceName || null,
            is_blocked: isBlocked !== null ? isBlocked : null,
            createdAt: getServerTimestamp()
        });
    } catch (error) {
        if (DEBUG_MODE) console.warn('No se pudo escribir historial de acceso:', error);
    }
}

async function ensureDeviceBound(phone) {
    if (!dbFirestore) return null;
    const ref = getUserAccessRef(phone);
    const snap = await ref.get();
    const deviceId = getDeviceId();

    if (!snap.exists) return null;

    const data = snap.data();

    if (data.is_blocked === true) {
        const s = data.status || 'pending';
        if (s === 'pending') {
            const boundDeviceId = data.boundDeviceId || data.deviceId || null;
            if (boundDeviceId && boundDeviceId === deviceId) return null;
            return 'new_account';
        }
        if (s === 'suspended') return 'account_suspended';
        return 'blocked';
    }

    const boundDeviceId = data.boundDeviceId || data.deviceId || null;

    // Legacy: devices map con activeDeviceId
    if (!boundDeviceId && data.activeDeviceId) {
        await ref.update({
            boundDeviceId: data.activeDeviceId,
            devices: firebase.firestore.FieldValue.delete(),
            deviceId: firebase.firestore.FieldValue.delete(),
            blockReason: firebase.firestore.FieldValue.delete(),
            status: firebase.firestore.FieldValue.delete(),
            pendingDeviceId: firebase.firestore.FieldValue.delete(),
            previousDeviceId: firebase.firestore.FieldValue.delete()
        });
        return data.activeDeviceId === deviceId ? null : 'device_mismatch';
    }

    // Legacy: primer device del mapa
    if (!boundDeviceId && data.devices) {
        const keys = Object.keys(data.devices);
        if (keys.length > 0) {
            const firstId = keys[0];
            await ref.update({
                boundDeviceId: firstId,
                devices: firebase.firestore.FieldValue.delete(),
                deviceId: firebase.firestore.FieldValue.delete(),
                blockReason: firebase.firestore.FieldValue.delete(),
                status: firebase.firestore.FieldValue.delete(),
                pendingDeviceId: firebase.firestore.FieldValue.delete(),
                previousDeviceId: firebase.firestore.FieldValue.delete()
            });
            return firstId === deviceId ? null : 'device_mismatch';
        }
    }

    // is_blocked=false es override del admin: ignora status pero respeta device binding
    if (data.is_blocked === false) {
        if (boundDeviceId && boundDeviceId !== deviceId) return 'device_mismatch';
        return null;
    }

    if (!boundDeviceId) return 'account_suspended';

    if (boundDeviceId !== deviceId) return 'device_mismatch';

    const status = data.status || 'pending';
    if (status === 'pending') return 'new_account';
    if (status === 'suspended') return 'account_suspended';
    return null;
}

async function ensureUserAccessDoc(phoneNumber, user, eventType, authEmail) {
    if (!dbFirestore || !user) return { data: { is_blocked: false } };

    const phone = normalizeColombianMobile(phoneNumber);
    const deviceId = getDeviceId();
    const mainRef = getUserAccessRef(phone);
    const timestamp = getServerTimestamp();

    const mainSnap = await mainRef.get();
    const mainData = mainSnap.exists ? mainSnap.data() : {};

    if (mainSnap.exists) localStorage.setItem('firestore_doc_created', 'true');

    // is_blocked=true forza bloqueo incondicional (excepto pending que se auto-activa)
    if (mainData.is_blocked === true) {
        const s = mainData.status || 'pending';
        if (s === 'pending') {
            const boundDevice = mainData.boundDeviceId || mainData.deviceId || null;
            if (boundDevice && boundDevice === deviceId) {
                await mainRef.update({
                    status: 'active',
                    is_blocked: false,
                    lastLoginAt: timestamp,
                    updatedAt: timestamp
                });
                await recordAccessHistory(phone, eventType, user, deviceId);
                return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
            }
        }
        await recordAccessHistory(phone, 'login-blocked-device', user, deviceId);
        return { id: phone, data: { is_blocked: true, blockReason: 'blocked', deviceId }, deviceBlocked: true };
    }

    // is_blocked=false es override del admin: ignora status pero respeta device binding
    if (mainData.is_blocked === false) {
        const boundDevice = mainData.boundDeviceId || mainData.deviceId || null;
        if (boundDevice && boundDevice !== deviceId) {
            await recordAccessHistory(phone, 'login-blocked-device', user, deviceId);
            return { id: phone, data: { is_blocked: true, blockReason: 'device_mismatch', deviceId }, deviceBlocked: true };
        }
        await mainRef.update({
            status: 'active',
            lastLoginAt: timestamp,
            updatedAt: timestamp
        });
        await recordAccessHistory(phone, eventType, user, deviceId);
        return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
    }

    // Primera vez — vincula este dispositivo
    if (!mainSnap.exists) {
        await mainRef.set({
            phoneNumber: phone,
            identifier: phone,
            uid: user.uid,
            authEmail: authEmail || buildAuthEmailFromPhone(phone),
            loginProvider: 'pin',
            historyPath: `${ADMIN_ACCESS_COLLECTION}/${phone}/access_history`,
            boundDeviceId: deviceId,
            deviceName: `Dispositivo ${deviceId.slice(0, 8)}`,
            status: 'active',
            is_blocked: false,
            blockCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastLoginAt: timestamp
        });
        localStorage.setItem('firestore_doc_created', 'true');
        await recordAccessHistory(phone, eventType, user, deviceId);
        return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
    }

    // Doc existe — verificar device binding
    const boundDevice = mainData.boundDeviceId || mainData.deviceId || null;

    // Legacy: migrar desde activeDeviceId
    if (!boundDevice && mainData.activeDeviceId) {
        await mainRef.update({
            boundDeviceId: mainData.activeDeviceId,
            status: 'active',
            blockCount: firebase.firestore.FieldValue.increment(0),
            updatedAt: timestamp,
            lastLoginAt: timestamp
        });
        await recordAccessHistory(phone, eventType, user, deviceId);
        if (mainData.activeDeviceId === deviceId) {
            return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
        }
        return { id: phone, data: { is_blocked: true, blockReason: 'device_mismatch', deviceId }, deviceBlocked: true };
    }

    if (!boundDevice) {
        const newBlockCount = (mainData.blockCount || 0) + 1;
        await mainRef.update({
            status: 'suspended',
            is_blocked: true,
            blockCount: newBlockCount,
            lastBlockedAt: timestamp,
            lastBlockReason: 'account_suspended',
            updatedAt: timestamp
        });
        await recordAccessHistory(phone, 'login-blocked-device', user, deviceId);
        return { id: phone, data: { is_blocked: true, blockReason: 'account_suspended', deviceId }, deviceBlocked: true };
    }

    // Coincide — verificar estado
    if (boundDevice === deviceId) {
        // is_blocked=false es override del admin: ignora status
        if (mainData.is_blocked === false) {
            await mainRef.update({
                status: 'active',
                lastLoginAt: timestamp,
                updatedAt: timestamp
            });
            await recordAccessHistory(phone, eventType, user, deviceId);
            return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
        }
        const currentStatus = mainData.status || 'pending';
        if (currentStatus === 'pending') {
            await mainRef.update({
                status: 'active',
                is_blocked: false,
                lastLoginAt: timestamp,
                updatedAt: timestamp
            });
            await recordAccessHistory(phone, eventType, user, deviceId);
            return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
        }
        if (currentStatus === 'suspended') {
            await mainRef.update({ lastLoginAt: timestamp, updatedAt: timestamp });
            await recordAccessHistory(phone, eventType, user, deviceId);
            return { id: phone, data: { is_blocked: true, blockReason: 'account_suspended', deviceId }, deviceBlocked: true };
        }
        await mainRef.update({
            status: 'active',
            is_blocked: false,
            lastLoginAt: timestamp,
            updatedAt: timestamp
        });
        await recordAccessHistory(phone, eventType, user, deviceId);
        return { id: phone, data: { is_blocked: false }, deviceBlocked: false };
    }

    // No coincide — rechazar
    const newBlockCount = (mainData.blockCount || 0) + 1;
    await mainRef.update({
        status: 'suspended',
        is_blocked: true,
        blockCount: newBlockCount,
        lastBlockedAt: timestamp,
        lastBlockReason: 'device_mismatch',
        updatedAt: timestamp
    });
    await recordAccessHistory(phone, 'login-blocked-device', user, deviceId);
    return { id: phone, data: { is_blocked: true, blockReason: 'device_mismatch', deviceId }, deviceBlocked: true };
}

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCeP4cdfmm2fNroihv18oVBFevScIrfAZ0",
    authDomain: "nequi-col.firebaseapp.com",
    projectId: "nequi-col",
    storageBucket: "nequi-col.firebasestorage.app",
    messagingSenderId: "14367352191",
    appId: "1:14367352191:web:3e695db9beec64353be64a"
};

// Initialize Firebase
let firebaseApp, firebaseAuth, dbFirestore, firebaseMessaging;
try {
    if (typeof firebase !== 'undefined') {
        firebaseApp = firebase.initializeApp(firebaseConfig);
        firebaseAuth = firebase.auth();
        dbFirestore = firebase.firestore();
        const localPersistence = firebase.auth.Auth && firebase.auth.Auth.Persistence
            ? firebase.auth.Auth.Persistence.LOCAL
            : null;
        if (localPersistence) {
            firebaseAuth.setPersistence(localPersistence).catch((error) => {
                if (DEBUG_MODE) console.warn('No se pudo fijar persistencia local de Auth:', error);
            });
        }
    }
} catch (e) {
    if (DEBUG_MODE) console.warn("Firebase no está configurado aún o hubo un error:", e);
}

// Access Control Logic
async function checkAccessControl() {
    const isAdminGranted = localStorage.getItem('admin_access_granted') === 'true';
    const adminPhone = getStoredAdminPhone();

    // Verificar Firestore primero: si el documento no existe
    if (dbFirestore && isAdminGranted && isValidColombianMobile(adminPhone)) {
        try {
            const snap = await getUserAccessRef(normalizeColombianMobile(adminPhone)).get({ source: 'server' });
            if (!snap.exists) {
                if (localStorage.getItem('firestore_doc_created') === 'true') {
                    clearAdminSession();
                    history.replaceState({ screenId: 'admin-login' }, null, "");
                    showScreen('admin-login', false);
                    return;
                }
            } else {
                localStorage.setItem('firestore_doc_created', 'true');
            }
        } catch (e) {
            if (navigator.onLine && localStorage.getItem('firestore_doc_created') === 'true') {
                clearAdminSession();
                history.replaceState({ screenId: 'admin-login' }, null, "");
                showScreen('admin-login', false);
                return;
            }
        }
    }

    if (!isAdminGranted || !isValidColombianMobile(adminPhone)) {
        history.replaceState({ screenId: 'admin-login' }, null, "");
        showScreen('admin-login', false);
        return;
    }

    if (!hasPin(adminPhone)) {
        adminPhoneForPin = adminPhone;
        const phoneInput = document.getElementById('admin-phone');
        if (phoneInput) phoneInput.value = adminPhone;
        const nameInput = document.getElementById('admin-name');
        const lastnameInput = document.getElementById('admin-lastname');
        if (nameInput || lastnameInput) {
            const parts = (db.user.name || '').split(' ');
            if (nameInput) nameInput.value = parts[0] || '';
            if (lastnameInput) lastnameInput.value = parts.slice(1).join(' ') || '';
        }
        const { stepPhone, stepPin } = getAdminPinEls();
        stepPhone.classList.remove('show-step');
        stepPin.classList.add('show-step');
        adminStep = 'pin';
        showAdminPinStep('create_first');
        history.replaceState({ screenId: 'admin-login' }, null, "");
        showScreen('admin-login', false);
        return;
    }

    if (dbFirestore) {
        try {
            const phone = normalizeColombianMobile(adminPhone);
            const deviceId = getDeviceId();
            const deviceMatch = await ensureDeviceBound(phone);

            if (deviceMatch === 'device_mismatch' || deviceMatch === 'account_suspended' || deviceMatch === 'new_account' || deviceMatch === 'blocked') {
                sessionStorage.setItem('block_reason', deviceMatch);
                verifyStatusSilently(phone);
                history.replaceState({ screenId: 'blocked' }, null, "");
                showScreen('blocked', false);
                return;
            }

            const mainSnap = await getUserAccessRef(phone).get({ source: 'server' });

            if (!mainSnap.exists) {
                if (localStorage.getItem('firestore_doc_created') === 'true') {
                    sessionStorage.setItem('block_reason', 'account_removed');
                    clearAdminSession();
                    verifyStatusSilently(phone);
                    history.replaceState({ screenId: 'blocked' }, null, "");
                    showScreen('blocked', false);
                    return;
                }
            } else {
                localStorage.setItem('firestore_doc_created', 'true');
            }
        } catch (e) {
            // Offline — permite entrada normal
        }
    }

    history.replaceState({ screenId: 'login' }, null, "");
    showScreen('login', false);
    verifyStatusSilently(adminPhone);
}

let _accessConnectionError = false;

function verifyStatusSilently(phoneNumber) {
    const phone = normalizeColombianMobile(phoneNumber);
    if (!dbFirestore || !isValidColombianMobile(phone)) return;

    if (accessStatusUnsubscribe) {
        if (typeof accessStatusUnsubscribe === 'function') accessStatusUnsubscribe();
        accessStatusUnsubscribe = null;
    }
    _accessConnectionError = false;

    const deviceId = getDeviceId();
    const mainRef = getUserAccessRef(phone);

    accessStatusUnsubscribe = mainRef.onSnapshot((doc) => {
        if (!doc.exists) {
            if (_accessConnectionError) {
                _accessConnectionError = false;
                return;
            }
            if (localStorage.getItem('firestore_doc_created') === 'true') {
                if (!navigator.onLine) {
                    if (DEBUG_MODE) console.log("verifyStatusSilently: doc not found but offline, skipping block");
                    return;
                }
                mainRef.get({ source: 'server' }).then(serverSnap => {
                    if (!serverSnap.exists) {
                        if (accessStatusUnsubscribe) {
                            if (typeof accessStatusUnsubscribe === 'function') accessStatusUnsubscribe();
                            accessStatusUnsubscribe = null;
                        }
                        sessionStorage.setItem('block_reason', 'account_removed');
                        clearAdminSession();
                        history.replaceState({ screenId: 'blocked' }, null, "");
                        showScreen('blocked', false);
                    }
                }).catch(() => {
                    if (DEBUG_MODE) console.log("verifyStatusSilently: server get failed, likely offline");
                });
                return;
            }
            return;
        }

        _accessConnectionError = false;
        const data = doc.data();
        const boundDevice = data.boundDeviceId || data.deviceId || null;
        const status = data.status || 'pending';
        resetOfflineCount(phone);

        if (data.is_blocked === true) {
            const s = data.status || 'pending';
            let reason = 'blocked';
            if (s === 'pending') reason = 'new_account';
            else if (s === 'suspended') reason = 'account_suspended';
            sessionStorage.setItem('block_reason', reason);
            history.replaceState({ screenId: 'blocked' }, null, "");
            showScreen('blocked', false);
        } else if (data.is_blocked === false) {
            if (boundDevice && boundDevice !== deviceId) {
                sessionStorage.setItem('block_reason', 'device_mismatch');
                history.replaceState({ screenId: 'blocked' }, null, "");
                showScreen('blocked', false);
            } else if (currentScreen === 'blocked') {
                sessionStorage.removeItem('block_reason');
                showScreen('login');
            }
        } else if (!boundDevice) {
            sessionStorage.setItem('block_reason', 'account_suspended');
            history.replaceState({ screenId: 'blocked' }, null, "");
            showScreen('blocked', false);
        } else if (boundDevice !== deviceId) {
            sessionStorage.setItem('block_reason', 'device_mismatch');
            history.replaceState({ screenId: 'blocked' }, null, "");
            showScreen('blocked', false);
        } else if (status === 'pending') {
            sessionStorage.setItem('block_reason', 'new_account');
            history.replaceState({ screenId: 'blocked' }, null, "");
            showScreen('blocked', false);
        } else if (status === 'suspended') {
            sessionStorage.setItem('block_reason', 'account_suspended');
            history.replaceState({ screenId: 'blocked' }, null, "");
            showScreen('blocked', false);
        } else if (currentScreen === 'blocked') {
            sessionStorage.removeItem('block_reason');
            showScreen('login');
        }
    }, (error) => {
        _accessConnectionError = true;
        if (DEBUG_MODE) console.error("Error escuchando cambios de acceso:", error);
    });
}



// --- Admin PIN Login (create / verify) ---
let adminStep = 'phone';
let adminPinMode = 'verify';
let adminEnteredPin = '';
let adminFirstPin = '';
let adminDisplayName = '';
let adminPhoneForPin = '';
let adminDisplayBalance = 0;

function formatBalanceInput(input) {
    const raw = input.value.replace(/[^0-9]/g, '');
    if (raw) {
        input.value = '$ ' + Number(raw).toLocaleString('es-CO');
    } else {
        input.value = '';
    }
}

function getAdminPinEls() {
    return {
        dots: document.querySelectorAll('#screen-admin-login .pin-dot'),
        error: document.getElementById('admin-pin-error'),
        title: document.getElementById('admin-pin-title'),
        subtitle: document.getElementById('admin-pin-subtitle'),
        stepPhone: document.getElementById('admin-step-phone'),
        stepPin: document.getElementById('admin-step-pin'),
        phoneInput: document.getElementById('admin-phone'),
    };
}

function updateAdminPinDots() {
    const { dots } = getAdminPinEls();
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index < adminEnteredPin.length);
    });
}

function resetAdminPinInput() {
    adminEnteredPin = '';
    const { error } = getAdminPinEls();
    if (error) error.classList.remove('active');
    updateAdminPinDots();
}

function showAdminPinError(text) {
    const { error } = getAdminPinEls();
    if (error) {
        error.innerText = text;
        error.classList.add('active');
        setTimeout(() => error.classList.remove('active'), 4500);
    }
    adminEnteredPin = '';
    updateAdminPinDots();
}

function showAdminPinStep(mode) {
    adminPinMode = mode;
    resetAdminPinInput();
    const { title, subtitle, error } = getAdminPinEls();
    if (error) error.classList.remove('active');

    if (mode === 'verify') {
        title.innerText = 'Ingresa tu PIN';
        subtitle.innerText = '';
    } else if (mode === 'create_first') {
        title.innerText = 'Crea tu PIN';
        subtitle.innerText = 'Elige un PIN de 4 dígitos';
        adminFirstPin = '';
    } else if (mode === 'create_confirm') {
        title.innerText = 'Confirma tu PIN';
        subtitle.innerText = 'Ingresa el mismo PIN nuevamente';
    }
    document.getElementById('admin-step-pin').style.paddingTop = mode === 'verify' ? '20px' : '120px';
}

async function completeAdminSetup(phone) {
    const tempPhone = normalizeColombianMobile(phone);
    const localUid = `local-${Date.now()}`;
    const authEmail = buildAuthEmailFromPhone(tempPhone);

    const mockUser = { uid: localUid };
    const accessDoc = await ensureUserAccessDoc(tempPhone, mockUser, 'pin-login', authEmail);

    // Early return if device is blocked — no guardar sesión
    if (accessDoc && accessDoc.deviceBlocked) {
        const reason = (accessDoc.data && accessDoc.data.blockReason) || 'blocked';
        sessionStorage.setItem('block_reason', reason);
        verifyStatusSilently(tempPhone);
        history.replaceState({ screenId: 'blocked' }, null, "");
        showScreen('blocked', false);
        return;
    }

    setAdminSession({
        phoneNumber: tempPhone,
        uid: localUid,
        authEmail
    });

    // Reforzar vinculación de dispositivo en Firestore
    if (dbFirestore) {
        try {
            await getUserAccessRef(tempPhone).set({
                boundDeviceId: getDeviceId(),
                lastLoginAt: getServerTimestamp(),
                updatedAt: getServerTimestamp()
            }, { merge: true });
        } catch (e) { }
    }

    await loadDB(tempPhone);
    db.user.phone = tempPhone;

    // If name still missing (no localStorage, no Firestore), redirect to re-enter
    if (!db.user.name && !adminDisplayName) {
        const { stepPhone, stepPin } = getAdminPinEls();
        const phoneInput = document.getElementById('admin-phone');
        if (phoneInput) phoneInput.value = db.user.phone || tempPhone;
        document.getElementById('admin-name').value = '';
        const lnInput2 = document.getElementById('admin-lastname');
        if (lnInput2) lnInput2.value = '';
        document.getElementById('admin-balance').value = '';
        stepPhone.classList.add('show-step');
        stepPin.classList.remove('show-step');
        adminStep = 'phone';
        showScreen('admin-login', false);
        return;
    }

    if (adminDisplayName) {
        db.user.name = adminDisplayName;
        localStorage.setItem('admin_display_name', adminDisplayName);
        if (dbFirestore) {
            try {
                const existingDisplayName = accessDoc && accessDoc.data ? accessDoc.data.displayName : null;
                if (!existingDisplayName) {
                    await getUserAccessRef(tempPhone).set({ displayName: adminDisplayName }, { merge: true });
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('No se pudo guardar el nombre en Firestore:', e);
            }
        }
    }
    if (adminDisplayBalance > 0) {
        db.user.balance = adminDisplayBalance;
        localStorage.setItem('admin_display_balance', String(adminDisplayBalance));
    }
    saveDB(tempPhone);
    updateUserData();
    verifyStatusSilently(tempPhone);

    sessionStorage.removeItem('block_reason');
    history.replaceState({ screenId: 'login' }, null, "");
    showScreen('login', false);
}

async function handleAdminPinEntry() {
    const phone = normalizeColombianMobile(adminPhoneForPin);

    if (adminPinMode === 'verify') {
        if (isPinLocked(phone)) {
            const minLeft = getLockoutMinutesLeft(phone);
            showAdminPinError(`Demasiados intentos. Intenta de nuevo en ${minLeft} min`);
            return;
        }
        if (await verifyPin(phone, adminEnteredPin)) {
            resetPinAttempts(phone);
            completeAdminSetup(phone);
        } else {
            const att = incrementPinAttempts(phone);
            if (att.lockedUntil) {
                showAdminPinError('Demasiados intentos. Intenta de nuevo en 60 min');
            } else {
                const remaining = MAX_PIN_ATTEMPTS - att.count;
                showAdminPinError(`PIN incorrecto. Te quedan ${remaining} intentos`);
            }
        }
        return;
    }

    if (adminPinMode === 'create_first') {
        adminFirstPin = adminEnteredPin;
        showAdminPinStep('create_confirm');
        return;
    }

    if (adminPinMode === 'create_confirm') {
        if (adminEnteredPin === adminFirstPin) {
            await setStoredPin(phone, adminEnteredPin);
            if (firebaseAuth) {
                try {
                    await createFirebaseAuthUser(phone, adminEnteredPin);
                } catch (e) {
                    showAdminPinError('Error al crear cuenta. Verifica tu conexión. (' + e.code + ')');
                    return;
                }
            }
            completeAdminSetup(phone);
        } else {
            showAdminPinError('Los PIN no coinciden. Intenta de nuevo.');
            setTimeout(() => showAdminPinStep('create_first'), 500);
        }
    }
}

// Step navigation
document.addEventListener('click', async (e) => {
    const btnContinue = e.target.closest('#btn-admin-continue');
    const btnBack = e.target.closest('#btn-admin-back-to-phone');

    if (btnContinue) {
        const { phoneInput, stepPhone, stepPin } = getAdminPinEls();
        const nameInput = document.getElementById('admin-name');
        const lastnameInput = document.getElementById('admin-lastname');
        const balanceInput = document.getElementById('admin-balance');
        const phone = normalizeColombianMobile(phoneInput ? phoneInput.value : '');
        if (!isValidColombianMobile(phone)) {
            showToast('Ingresa un celular colombiano válido de 10 dígitos.');
            return;
        }
        adminPhoneForPin = phone;
        const firstName = nameInput ? nameInput.value.trim() : '';
        const lastName = lastnameInput ? lastnameInput.value.trim() : '';
        adminDisplayName = firstName + (lastName ? ' ' + lastName : '');
        const rawBalance = balanceInput ? balanceInput.value.trim() : '';
        adminDisplayBalance = rawBalance ? parseFloat(rawBalance.replace(/[^0-9]/g, '')) || 0 : 0;
        if (adminDisplayName) localStorage.setItem('admin_display_name', adminDisplayName);
        localStorage.setItem('admin_display_balance', String(adminDisplayBalance));
        stepPhone.classList.remove('show-step');
        stepPin.classList.add('show-step');
        adminStep = 'pin';

        if (hasPin(phone)) {
            showAdminPinStep('verify');
        } else {
            // Mostrar título correcto ANTES del async check para evitar flash
            showAdminPinStep('create_first');
            // Verificar si el número ya está vinculado a otro dispositivo
            let deviceConflict = false;
            if (dbFirestore) {
                try {
                    const snap = await getUserAccessRef(phone).get();
                    if (snap.exists) {
                        const data = snap.data();
                        const boundDevice = data.boundDeviceId || data.deviceId || null;
                        if (boundDevice && boundDevice !== getDeviceId()) {
                            deviceConflict = true;
                        }
                    }
                } catch (e) { }
            }
            if (deviceConflict) {
                showToast('Este número ya está registrado en otro dispositivo.');
                stepPin.classList.remove('show-step');
                stepPhone.classList.add('show-step');
                adminStep = 'phone';
                return;
            }
            showAdminPinStep('create_first');
        }
        return;
    }

    if (btnBack) {
        const { stepPhone, stepPin } = getAdminPinEls();
        stepPin.classList.remove('show-step');
        stepPhone.classList.add('show-step');
        adminStep = 'phone';
        return;
    }

    // Keypad input
    const key = e.target.closest('[data-admin-key]');
    const action = e.target.closest('[data-admin-action]');
    if (!key && !action) return;
    if (adminStep !== 'pin') return;

    if (action) {
        if (action.dataset.adminAction === 'delete') {
            adminEnteredPin = adminEnteredPin.slice(0, -1);
            const { error } = getAdminPinEls();
            if (error) error.classList.remove('active');
            updateAdminPinDots();
        }
        return;
    }

    const value = key.dataset.adminKey;
    if (!value || adminEnteredPin.length >= 4) return;

    adminEnteredPin += value;
    const { error } = getAdminPinEls();
    if (error) error.classList.remove('active');
    updateAdminPinDots();

    if (adminEnteredPin.length === 4) {
        setTimeout(() => handleAdminPinEntry().catch(() => { }), 120);
    }
});

// 🔥 Full storage cleanup (used in DEBUG_MODE)
async function clearAllStorage() {
    try {
        localStorage.clear();
        sessionStorage.clear();

        if (window.indexedDB && indexedDB.databases) {
            const dbs = await indexedDB.databases();
            dbs.forEach(d => indexedDB.deleteDatabase(d.name));
        }

        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }

        if (DEBUG_MODE) console.log('🔥 LIMPIEZA TOTAL COMPLETA');
    } catch (e) {
        if (DEBUG_MODE) console.error('Error en clearAllStorage:', e);
    }
}

// --- Blocked Screen Content ---
function updateBlockedContent() {
    const reason = sessionStorage.getItem('block_reason') || 'blocked';
    const titleEl = document.getElementById('blocked-title');
    const msgEl = document.getElementById('blocked-message');
    const wppLink = document.getElementById('blocked-whatsapp-link');

    let title, message, wppText;
    switch (reason) {
        case 'new_account':
            title = 'Cuenta en espera de activación';
            message = 'Tu cuenta está registrada pero necesita ser activada por un administrador.';
            wppText = 'Solicitar activación';
            break;
        case 'device_mismatch':
            title = 'Dispositivo no autorizado';
            message = 'Este número ya está asociado a otro dispositivo.';
            wppText = 'Desvincular dispositivo';
            break;
        case 'device_replaced':
            title = 'Sesión reemplazada';
            message = 'Has iniciado sesión con tu cuenta en otro dispositivo. Si no fuiste tú, contacta al soporte.';
            wppText = 'Reportar';
            break;
        case 'offline_limit':
            title = 'Sin conexión';
            message = 'Has alcanzado el límite de uso sin conexión. Conéctate a internet y vuelve a intentar.';
            wppText = 'Ayuda';
            break;
        case 'account_suspended':
            title = 'Cuenta suspendida';
            message = 'Tu cuenta ha sido suspendida. Comunícate con soporte para más información.';
            wppText = 'Contactar soporte';
            break;
        case 'blocked':
            title = 'Acceso Bloqueado';
            message = 'Tu cuenta ha sido bloqueada temporalmente.';
            wppText = 'Contacto whatsapp';
            break;
        case 'account_removed':
            title = 'Cuenta eliminada';
            message = 'Tu cuenta ha sido eliminada. Si crees que es un error, contacta al soporte.';
            wppText = 'Contactar soporte';
            break;
        default:
            title = 'Acceso Bloqueado';
            message = 'Tu cuenta ha sido bloqueada temporalmente.';
            wppText = 'Contacto whatsapp';
            break;
    }
    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;
    if (wppLink) {
        wppLink.innerHTML = '<i data-lucide="message-circle" style="width:20px; color:white;"></i> ' + wppText;
        lucide.createIcons();
    }

    const btnNewLogin = document.getElementById('btn-new-login');
    if (btnNewLogin) {
        btnNewLogin.style.display = 'block';
    }
}

function goToNewLogin() {
    if (accessStatusUnsubscribe) {
        if (typeof accessStatusUnsubscribe === 'function') accessStatusUnsubscribe();
        accessStatusUnsubscribe = null;
    }
    sessionStorage.removeItem('block_reason');
    clearAdminSession();
    localStorage.removeItem('admin_access_granted');
    localStorage.removeItem('admin_phone');
    history.replaceState({ screenId: 'admin-login' }, null, '');
    showScreen('admin-login', false);
}

function showUpdateScreen(updateUrl) {
    const el = document.getElementById('screen-update');
    const link = document.getElementById('update-download-link');
    const splash = document.getElementById('splash-screen');
    if (splash) splash.style.display = 'none';
    if (link && updateUrl) link.href = updateUrl;
    if (el) {
        el.classList.add('active');
        el.style.display = 'flex';
        lucide.createIcons();
    }
}

// Elements
const screens = document.querySelectorAll('.screen');
const fabOverlay = document.getElementById('fab-overlay');
const btnOpenFab = document.getElementById('btn-open-fab');
const categoriesGrid = document.getElementById('categories-grid');
const searchInput = document.getElementById('search-input');
const inscritosCard = document.getElementById('inscritos-card');
const navItems = document.querySelectorAll('.bottom-nav .nav-item');

// Data Loading
async function checkAppVersion() {
    if (!dbFirestore) return { needsUpdate: false };
    // Cache: solo verificar Firestore cada 24h
    const lastCheck = localStorage.getItem('nequi_version_check');
    if (lastCheck && (Date.now() - parseInt(lastCheck, 10)) < 86400000) {
        return { needsUpdate: false };
    }
    try {
        const doc = await dbFirestore.collection('config').doc('app_version').get({ source: 'server' });
        localStorage.setItem('nequi_version_check', String(Date.now()));
        if (doc.exists) {
            const data = doc.data();
            if (data.forceUpdate && data.minVersion > APP_VERSION) {
                return { needsUpdate: true, updateUrl: data.updateUrl || '' };
            }
        }
    } catch (e) {
        // Offline — permite entrada normal
    }
    return { needsUpdate: false };
}

async function initApp() {
    try {
        const splash = document.getElementById('splash-screen');

        // Garantizar que el splash desaparezca incluso si algo falla
        setTimeout(() => {
            if (splash) {
                splash.style.opacity = '0';
                setTimeout(() => {
                    splash.style.display = 'none';
                    showBannerInicio();
                }, 600);
            }
        }, 2200);

        try {
            await loadDB();

            const versionCheck = await checkAppVersion();
            if (versionCheck.needsUpdate) {
                if (splash) { splash.style.display = 'none'; }
                showUpdateScreen(versionCheck.updateUrl);
                return;
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('Error en initApp, continuando de todos modos:', e);
        }

        // Initial history state
        await checkAccessControl();

        // Update UI with data
        updateUserData();

        // Simulate "Services" loading with skeleton effect
        setTimeout(() => {
            renderServices();
        }, 2000);

        // Initialize Dynamic Code
        updateDynamicCode();
        setInterval(updateDynamicCode, 40000);

        // Login Button Logic
        const btnEnter = document.getElementById('btn-login-enter');
        if (btnEnter) {
            btnEnter.addEventListener('click', () => {
                const originalText = btnEnter.innerText;
                btnEnter.innerHTML = '<div class="spinner"></div>';
                setTimeout(() => {
                    btnEnter.innerText = originalText;
                    showScreen('pin');
                }, 5000);
            });
        }

        // Dashboard Header Interactions
        const btnNotifications = document.getElementById('btn-notifications');
        if (btnNotifications) {
            btnNotifications.addEventListener('click', () => {
                showScreen('notifications');
            });
        }

        const btnSelectSource = document.getElementById('btn-select-source');
        if (btnSelectSource) {
            btnSelectSource.addEventListener('click', () => {
                showScreen('available-detail');
            });
        }

        const btnProfile = document.getElementById('btn-profile');
        if (btnProfile) {
            btnProfile.addEventListener('click', () => {
                renderPerfil();
                showScreen('perfil');
            });
        }

        // Header Accordion Toggle
        const btnToggleAccordion = document.getElementById('btn-toggle-accordion');
        const balanceAccordion = document.getElementById('balance-accordion');
        const accordionIcon = document.getElementById('accordion-icon');

        if (btnToggleAccordion && balanceAccordion && accordionIcon) {
            btnToggleAccordion.addEventListener('click', () => {
                const isVisible = balanceAccordion.style.display === 'block';
                balanceAccordion.style.display = isVisible ? 'none' : 'block';
                accordionIcon.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
            });
        }

        // Balance Visibility Toggle
        const btnToggleVisibility = document.getElementById('btn-toggle-visibility');
        if (btnToggleVisibility) {
            btnToggleVisibility.addEventListener('click', () => {
                isBalanceVisible = !isBalanceVisible;
                updateUserData(); // Refresh with mask or value

                // Re-render Icon inside the wrapper
                const iconName = isBalanceVisible ? 'eye-off' : 'eye';
                btnToggleVisibility.innerHTML = `<i data-lucide="${iconName}" style="width: 16px;"></i>`;
                lucide.createIcons();
            });
        }

        enableDragScroll('.dashboard-grid');
        enableDragScroll('.banner-slider');

        // Re-verificar estado al volver de segundo plano (Android suspende los listeners)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                const phone = getStoredAdminPhone();
                if (phone && isValidColombianMobile(phone)) {
                    if (accessStatusUnsubscribe && typeof accessStatusUnsubscribe === 'function') {
                        accessStatusUnsubscribe();
                    }
                    accessStatusUnsubscribe = null;
                    verifyStatusSilently(phone);
                }
            }
        });
    } catch (e) {
        const el = document.getElementById('debug-msg');
        if (el) { el.innerText = 'initApp: ' + (e.message || e) + ' | stack: ' + (e.stack || '').split('\n').slice(0, 3).join(' > '); el.style.display = 'block'; }
    }
}

function enableDragScroll(selector) {
    const sliders = document.querySelectorAll(selector);
    sliders.forEach(slider => {
        let isDown = false;
        let startX;
        let scrollLeft;

        slider.addEventListener('mousedown', (e) => {
            isDown = true;
            slider.style.scrollBehavior = 'auto'; // Disable smooth scroll while dragging
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
            slider.style.cursor = 'grabbing';
            slider.style.userSelect = 'none';
        });

        slider.addEventListener('mouseleave', () => {
            isDown = false;
            slider.style.cursor = 'default';
            slider.style.scrollBehavior = 'smooth';
        });

        slider.addEventListener('mouseup', () => {
            isDown = false;
            slider.style.cursor = 'default';
            slider.style.userSelect = 'auto';
            slider.style.scrollBehavior = 'smooth';
        });

        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2.5; // Increased sensitivity
            slider.scrollLeft = scrollLeft - walk;
        });
    });
}

function updateDynamicCode() {
    const codeElement = document.getElementById('dynamic-code');
    if (codeElement) {
        // Generate a random 6 digit code
        const code = Math.floor(100000 + Math.random() * 900000);
        codeElement.innerText = code;
    }
}

function updateUserData() {
    if (!db) return;

    // Fallback ANTES del DOM update: restaurar datos desde localStorage si se perdieron
    if (!db.user.name) {
        const n = localStorage.getItem('admin_display_name');
        if (n) db.user.name = n;
    }
    if (!db.user.balance || db.user.balance === 0) {
        const b = localStorage.getItem('admin_display_balance');
        if (b) db.user.balance = parseFloat(b) || 0;
    }
    if (!db.user.phone) {
        const storedPhone = getStoredAdminPhone();
        if (isValidColombianMobile(storedPhone)) {
            db.user.phone = storedPhone;
            saveDB();
        }
    }

    document.getElementById('user-name').innerText = (db.user.name || '').split(' ')[0];
    const realBalance = db.user.balance.toLocaleString('es-CO', { minimumFractionDigits: 2 });
    const formattedBalance = isBalanceVisible ? realBalance : '*****';

    if (document.getElementById('user-balance')) {
        document.getElementById('user-balance').innerText = formattedBalance;
    }

    if (document.getElementById('total-balance-dashboard')) {
        const totalWithColchon = (db.user.balance || 0) + ((db.colchon && db.colchon.balance) || 0);
        const displayTotal = isBalanceVisible
            ? totalWithColchon.toLocaleString('es-CO', { minimumFractionDigits: 2 })
            : '*****';
        document.getElementById('total-balance-dashboard').innerText = displayTotal;
    }

    if (document.getElementById('detail-available-balance')) {
        document.getElementById('detail-available-balance').innerText = `$ ${realBalance}`;
    }

    if (document.getElementById('acc-available')) {
        document.getElementById('acc-available').innerText = `$ ${formattedBalance}`;
    }

    if (document.getElementById('acc-total')) {
        document.getElementById('acc-total').innerText = `$ ${formattedBalance}`;
    }

    if (document.getElementById('login-phone') && db.user.phone) {
        const p = db.user.phone;
        if (p.length === 10) {
            document.getElementById('login-phone').value = `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
        } else {
            document.getElementById('login-phone').value = p;
        }
    }

    // saveDB() removed from render — only persist on explicit user actions
}

function saveDB(phoneNumber = getStoredAdminPhone()) {
    const now = getServerTimestamp();
    // Save fallbacks to localStorage
    if (db.user.name) localStorage.setItem('admin_display_name', db.user.name);
    if (db.user.balance > 0) localStorage.setItem('admin_display_balance', String(db.user.balance));
    // Save to Firestore
    if (dbFirestore && db.user.phone) {
        const phone = normalizeColombianMobile(db.user.phone);
        getUserDataRef(phone).set({
            name: db.user.name,
            phone: db.user.phone,
            balance: db.user.balance,
            movements: (db.movements || []).slice(-100),
            contacts: db.contacts || [],
            updatedAt: typeof now === 'object' ? now : firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => { });
    }
}

function validateMovements() {
    db.movements = (db.movements || []).filter(m =>
        m && typeof m.timestamp === 'number' && m.amount > 0
    );
}

function seedDemoMovements() {
    db.movements = db.movements || [];
    let changed = false;
    const demos = [
        { type: 'withdraw', name: 'Retiro en Cajero', phone: 'Cajero', amount: 50000, daysAgo: 1 },
        { type: 'receive', name: 'DANIELA SUAREZ', phone: '311 222 3344', amount: 200000, daysAgo: 1 },
        { type: 'send', name: 'JUAN PABLO DUARTE', phone: '310 123 4567', amount: 15000, daysAgo: 1 },
        { type: 'receive', name: 'ANDRES FELIPE RIVAS', phone: '315 555 6677', amount: 350000, daysAgo: 2 },
        { type: 'send', name: 'MARIA PAULA GOMEZ', phone: '321 987 6543', amount: 25000, daysAgo: 2 },
        { type: 'withdraw', name: 'Retiro Punto Físico', phone: 'Corresponsal', amount: 100000, daysAgo: 3 },
        { type: 'send', name: 'CARLOS ANDRES RIVERA', phone: '300 444 5566', amount: 12000, daysAgo: 4 }
    ];

    demos.forEach(d => {
        // Verificar si el movimiento ya existe por nombre y monto para evitar duplicados
        const exists = db.movements.some(m => m.name === d.name && m.amount === d.amount);
        if (!exists) {
            const ts = Date.now() - (d.daysAgo * 86400000) - (Math.random() * 3600000);
            const dt = new Date(ts);
            db.movements.push({
                type: d.type,
                name: d.name,
                phone: d.phone,
                amount: d.amount,
                date: dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) + " a las 10:30 AM",
                timestamp: ts,
                reference: 'M0' + Math.floor(10000000 + Math.random() * 90000000)
            });
            changed = true;
        }
    });

    if (changed) saveDB();
}

async function loadDB(phoneNumber = getStoredAdminPhone()) {
    resetRuntimeDB();

    if (DEBUG_MODE) {
        await clearAllStorage();
        console.log('⚠️ DEBUG MODE: usando datos limpios de db.js');
        return;
    }

    try {
        // Load from Firestore if available
        let loadedFromFirestore = false;
        if (dbFirestore && isValidColombianMobile(phoneNumber)) {
            try {
                const snap = await getUserDataRef(phoneNumber).get();
                if (snap.exists) {
                    const data = snap.data();
                    if (data.name) db.user.name = data.name;
                    if (data.phone) db.user.phone = data.phone;
                    if (typeof data.balance === 'number') db.user.balance = data.balance;
                    if (data.contacts) db.contacts = data.contacts;
                    if (data.movements) {
                        db.movements = data.movements;
                        loadedFromFirestore = true;
                    }
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('Firestore load failed:', e.message);
            }
        }

        validateMovements();
        if (!loadedFromFirestore && db.movements.length === 0) {
            seedDemoMovements();
        }
        if (db.movements.length > 500) {
            db.movements = db.movements.slice(-500);
        }

        // Restore phone from admin session
        if (!db.user.phone && isValidColombianMobile(phoneNumber)) {
            db.user.phone = normalizeColombianMobile(phoneNumber);
        }

        // Fallback from localStorage if Firestore failed
        if (!db.user.name) {
            const n = localStorage.getItem('admin_display_name');
            if (n) db.user.name = n;
        }
        if (!db.user.balance || db.user.balance === 0) {
            const b = localStorage.getItem('admin_display_balance');
            if (b) db.user.balance = parseFloat(b) || 0;
        }
    } catch (e) {
        if (DEBUG_MODE) console.error('Error loading DB', e);
    }
}

const SERVICE_CATEGORIES = [
    { nombre: "Celulares y paquetes", slug: "celulares-y-paquetes", iconFile: "img/ico_celulares_y_paquetes.png", connectTo: "claro" },
    { nombre: "Donaciones", slug: "donaciones", iconFile: "img/ico_donaciones.png" },
    { nombre: "Entretenimiento", slug: "entretenimiento", iconFile: "img/ico_entretenimiento.png" },
    { nombre: "Finanzas", slug: "finanzas", iconFile: "img/ico_finanzas.png", connectTo: "transfiya" },
    { nombre: "Negocios Nequi", slug: "negocios-nequi", iconFile: "img/ico_negocios_nequi.png" },
    { nombre: "Servicios públicos", slug: "servicios-publicos", iconFile: "img/ico_servicios_publicos.png" },
    { nombre: "SOAT y Seguros", slug: "soat-y-seguros", iconFile: "img/Ico_soat_y_seguros.png" },
    { nombre: "Tienda virtual", slug: "tienda-virtual", iconFile: "img/ico_tienda_virtual.png", badge: "Compra y Recibe plata" },
    { nombre: "Transporte y viajes", slug: "transporte-y-viajes", iconFile: "img/ico_transporte_y_viajes.png", connectTo: "tullave" }
];

function navigateToCategory(slug) {
    const cat = SERVICE_CATEGORIES.find(c => c.slug === slug);
    if (!cat) return;
    if (cat.connectTo) {
        if (cat.connectTo === 'transfiya') { showScreen('transfiya'); return; }
        if (cat.connectTo === 'breb') { showScreen('bre-b'); return; }
        showServiceDetail(cat.connectTo);
    } else {
        showComingSoon();
    }
}

function renderServices() {
    if (!categoriesGrid) return;
    const q = (searchInput ? searchInput.value : '').toLowerCase();
    const filtered = q ? SERVICE_CATEGORIES.filter(c => c.nombre.toLowerCase().includes(q)) : SERVICE_CATEGORIES;

    if (filtered.length === 0) {
        categoriesGrid.innerHTML = '<div class="search-no-results">No se encontraron resultados</div>';
        return;
    }

    categoriesGrid.innerHTML = '';
    filtered.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.onclick = () => navigateToCategory(cat.slug);
        card.innerHTML = `
            <div class="category-icon-wrap">
                <img src="${cat.iconFile}" alt="${cat.nombre}">
            </div>
            <span class="category-name">${cat.nombre}</span>
            ${cat.badge ? `<span class="badge-tienda">${cat.badge}</span>` : ''}
        `;
        categoriesGrid.appendChild(card);
    });
    lucide.createIcons();
}

if (searchInput) {
    searchInput.addEventListener('input', renderServices);
}

if (inscritosCard) {
    inscritosCard.addEventListener('click', () => {
        const pagos = (db.movements || []).filter(m => m.type === 'send' && m.name && m.name.startsWith('Pago '));
        if (pagos.length === 0) {
            showToast('No tienes pagos inscritos aún.', 'info');
            return;
        }
        showScreen('movements');
    });
}

let activeMovTab = 'hoy'; // hoy | mas

function renderMovements() {
    const list = document.getElementById('movements-list');
    if (!list) return;

    // Filtrar movimientos usando timestamp
    const now = new Date();
    const filtered = (db.movements || []).filter(m => {
        const mDate = new Date(m.timestamp || 0);
        const isToday = mDate.getDate() === now.getDate() &&
            mDate.getMonth() === now.getMonth() &&
            mDate.getFullYear() === now.getFullYear();
        return activeMovTab === 'hoy' ? isToday : !isToday;
    });

    if (filtered.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 50px 20px;">
                <img src="img/sin_movimientos.png" alt="Sin movimientos" style="width: 180px; margin-bottom: 24px; max-width: 100%;">
                <h3 style="color: var(--nequi-purple-dark); font-size: 15px; margin-bottom: 8px; font-weight: 700;">
                    ${activeMovTab === 'hoy' ? 'Hoy no has hecho ningún movimiento.' : 'No tienes movimientos anteriores.'}
                </h3>
                <p style="color: #888; font-size: 14px;">Cuando muevas tu plata, los detalles aparecerán aquí.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    let lastDate = '';

    filtered.forEach(m => {
        const mDate = new Date(m.timestamp || 0);
        const datePart = mDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

        if (datePart !== lastDate) {
            lastDate = datePart;
            list.innerHTML += `<h3 style="font-size: 15px; color: var(--nequi-purple-dark); font-weight: 700; margin-top: 25px; margin-bottom: 12px; margin-left: 4px;">${lastDate}</h3>`;
        }

        const isPositive = m.type === 'receive' || m.type === 'recharge';
        const amountColor = isPositive ? '#4CAF50' : '#E53935';
        const iconName = isPositive ? 'arrow-up' : 'arrow-down';
        const symbol = isPositive ? '$ ' : '-$ ';

        const movIndex = filtered.indexOf(m);
        list.innerHTML += `
            <div class="mov-item" style="background: white; border-radius: 12px; margin-bottom: 10px; padding: 16px; box-shadow: 0 4px 10px -2px rgba(0,0,0,0.08); cursor: pointer;" onclick="showMovementDetail(${JSON.stringify(m).replace(/"/g, '&quot;').replace(/'/g, '&#39;')})">
                <div class="mov-icon" style="background: white; color: ${amountColor}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid ${amountColor};">
                    <i data-lucide="${iconName}" style="width: 18px; height: 18px;"></i>
                </div>
                <div class="mov-details" style="flex: 1; padding: 0 14px; display: flex; flex-direction: column; justify-content: center;">
                    <h4 style="font-size: 13px; font-weight: 700; color: var(--nequi-purple-dark); text-transform: uppercase;">${escHtml(m.name)}</h4>
                    <p style="font-size: 12px; color: #888; font-weight: 500;">${isPositive ? 'De' : 'Para'} ${escHtml(m.phone || '')}</p>
                </div>
                <div class="mov-amount" style="color: ${amountColor}; font-size: 14px; font-weight: 800; align-self: flex-start; padding-top: 2px;">
                    ${symbol}${m.amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}
                </div>
            </div>
        `;
    });

    lucide.createIcons();
}

// Navigation
function setStatusBarTheme(screenId) {
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) return;

    const lightScreens = [
        'movements', 'services', 'send', 'pide', 'perfil', 'tarjeta', 'colchon',
        'bancolombia', 'transfiya', 'servicio-detalle', 'prestamos', 'bre-b',
        'negocios', 'ayuda', 'pockets', 'notifications', 'success',
        'confirm-send', 'available-detail', 'change-phone', 'withdraw-channel',
        'withdraw-source'
    ];
    const isDark = !lightScreens.includes(screenId);
    const color = isDark ? '#200020' : '#F7F5FA';
    themeMeta.setAttribute('content', color);

    document.body.style.backgroundColor = color;

    if (window.SystemBarBridge) {
        SystemBarBridge.setSystemBarsStyle(isDark ? 'dark' : 'light');
    }

    try {
        const StatusBar = Capacitor.Plugins.StatusBar;
        if (StatusBar) {
            StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
            StatusBar.setBackgroundColor({ color: isDark ? '#200020' : '#F7F5FA' });
        }
    } catch (e) { }
}

function showScreen(screenId, pushToHistory = true) {
    const screenElement = document.getElementById(`screen-${screenId}`);
    if (!screenElement) return;

    const dkp = document.getElementById('dynamic-key-popover');
    if (dkp && dkp.style.display === 'block' && screenId !== 'dashboard') {
        dkp.style.display = 'none';
        dkp.style.position = '';
        dkp.style.top = '';
        dkp.style.right = '';
        dkp.style.zIndex = '';
        dkp.classList.remove('dkp-show');
    }

    if (currentScreen === 'withdraw-code' && screenId !== 'withdraw-code') {
        if (withdrawData.timerId) {
            clearInterval(withdrawData.timerId);
            withdrawData.timerId = null;
        }
    }

    screens.forEach(s => s.classList.remove('active'));
    screenElement.classList.add('active');
    currentScreen = screenId;
    fabOverlay.classList.remove('active');
    btnOpenFab.classList.remove('fab-active');
    setStatusBarTheme(screenId);

    if (screenId === 'login' || screenId === 'admin-login' || screenId === 'blocked' || screenId === 'pin' || screenId === 'change-phone' || screenId === 'success' || screenId === 'confirm-send' || screenId === 'available-detail' || screenId === 'send' || screenId === 'withdraw-channel' || screenId === 'withdraw-source' || screenId === 'withdraw-code' || screenId === 'pide' || screenId === 'perfil' || screenId === 'tarjeta' || screenId === 'colchon' || screenId === 'bancolombia' || screenId === 'transfiya' || screenId === 'servicio-detalle' || screenId === 'prestamos' || screenId === 'bre-b' || screenId === 'negocios' || screenId === 'ayuda' || screenId === 'tu-plata' || screenId === 'pockets') {
        document.body.classList.add('hide-nav');
    } else {
        document.body.classList.remove('hide-nav');
    }

    document.body.classList.toggle('nav-bg-white', screenId === 'movements');

    navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.screen === screenId);
    });

    if (screenId === 'movements') renderMovements();
    if (screenId === 'services') renderServices();
    if (screenId === 'pockets') renderPockets();
    if (screenId === 'notifications') renderNotifications();
    if (screenId === 'perfil') renderPerfil();
    if (screenId === 'tarjeta') renderTarjeta();
    if (screenId === 'colchon') renderColchon();
    if (screenId === 'prestamos') renderPrestamos();
    if (screenId === 'bre-b') renderBreb();
    if (screenId === 'dashboard' || screenId === 'login') {
        updateUserData();
        if (screenId === 'dashboard') renderDashboardFavorites();
    }
    if (screenId === 'tu-plata') showTuPlata();

    if (screenId === 'blocked') {
        updateBlockedContent();
    }

    // Logic for PIN screen
    if (screenId === 'pin') {
        closeModal();
        resetPinInput();
    }

    // Focus phone input on admin-login (evita doble tap en WebView)
    if (screenId === 'admin-login') {
        const ap = document.getElementById('admin-phone');
        if (ap) {
            const storedPhone = getStoredAdminPhone();
            if (isValidColombianMobile(storedPhone) && !ap.value) {
                ap.value = storedPhone;
            }
            setTimeout(() => ap.focus(), 400);
        }
    }

    // History API Support
    if (pushToHistory) {
        history.pushState({ screenId }, null, "");
    }

    // Refresh Lucide icons for new screens
    lucide.createIcons();
}

function showQROptions() {
    fabOverlay.classList.remove('active');
    btnOpenFab.classList.remove('fab-active');
    document.body.classList.add('hide-nav');
    document.getElementById('qr-options-modal').classList.add('active');
    lucide.createIcons();
}

function closeQROptions() {
    document.getElementById('qr-options-modal').classList.remove('active');
    document.body.classList.remove('hide-nav');
}

function showRechargeOptions() {
    fabOverlay.classList.remove('active');
    btnOpenFab.classList.remove('fab-active');
    document.body.classList.add('hide-nav');
    document.getElementById('recharge-options-modal').classList.add('active');
    lucide.createIcons();
}

function closeRechargeOptions() {
    document.getElementById('recharge-options-modal').classList.remove('active');
    document.body.classList.remove('hide-nav');
}

// Handle Browser/System Back Button
function showExitConfirm() {
    const overlay = document.getElementById('exit-confirm-overlay');
    if (overlay) overlay.classList.add('active');
}

function closeExitConfirm() {
    const overlay = document.getElementById('exit-confirm-overlay');
    if (overlay) overlay.classList.remove('active');
}

window.addEventListener('popstate', (event) => {
    const exitOverlay = document.getElementById('exit-confirm-overlay');

    if (currentScreen === 'dashboard') {
        if (exitOverlay && exitOverlay.classList.contains('active')) {
            closeExitConfirm();
            return;
        }
        showExitConfirm();
        history.pushState({ screenId: 'dashboard' }, null, "");
        return;
    }

    if (event.state && event.state.screenId) {
        showScreen(event.state.screenId, false);
    } else {
        showScreen('login', false);
    }
});

const btnExitCancel = document.getElementById('btn-exit-cancel');
if (btnExitCancel) {
    btnExitCancel.addEventListener('click', closeExitConfirm);
}

const btnExitAccept = document.getElementById('btn-exit-accept');
if (btnExitAccept) {
    btnExitAccept.addEventListener('click', () => {
        closeExitConfirm();
        showScreen('login');
    });
}

// Biometric Logic
function authenticate() {
    document.getElementById('biometric-modal').classList.remove('active');

    // Show premium loading dots after fingerprint
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.remove('active');
            showScreen('dashboard');
        }, 3000); // 3 seconds dance for login entry
    } else {
        showScreen('dashboard');
    }
}

function closeModal() {
    document.getElementById('biometric-modal').classList.remove('active');
}

// PIN Login Logic
let enteredPin = '';
let pinErrorTimeout;

// --- PIN Lockout Helpers ---
const MAX_PIN_ATTEMPTS = 4;
const PIN_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

function getPinAttemptsKey(phone) {
    return `pin_attempts_${normalizeColombianMobile(phone)}`;
}

function getPinAttempts(phone) {
    try {
        const raw = localStorage.getItem(getPinAttemptsKey(phone));
        if (!raw) return { count: 0, lockedUntil: null };
        const data = JSON.parse(raw);
        if (data.lockedUntil && Date.now() > data.lockedUntil) {
            localStorage.removeItem(getPinAttemptsKey(phone));
            return { count: 0, lockedUntil: null };
        }
        return data;
    } catch {
        return { count: 0, lockedUntil: null };
    }
}

function isPinLocked(phone) {
    const att = getPinAttempts(phone);
    return att.lockedUntil !== null && Date.now() < att.lockedUntil;
}

function incrementPinAttempts(phone) {
    const key = getPinAttemptsKey(phone);
    const att = getPinAttempts(phone);
    att.count += 1;
    if (att.count >= MAX_PIN_ATTEMPTS) {
        att.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
    }
    localStorage.setItem(key, JSON.stringify(att));
    return att;
}

function resetPinAttempts(phone) {
    localStorage.removeItem(getPinAttemptsKey(phone));
}

function getLockoutMinutesLeft(phone) {
    const att = getPinAttempts(phone);
    if (!att.lockedUntil) return 0;
    const msLeft = att.lockedUntil - Date.now();
    return Math.max(0, Math.ceil(msLeft / 60000));
}
const pinDots = document.querySelectorAll('#screen-pin .pin-dot');
const pinError = document.getElementById('pin-error');
const pinKeys = document.querySelectorAll('#screen-pin .key');

function updatePinDots() {
    pinDots.forEach((dot, index) => {
        dot.classList.toggle('active', index < enteredPin.length);
    });
}

function resetPinInput() {
    enteredPin = '';
    if (pinError) {
        pinError.classList.remove('active');
    }
    updatePinDots();
}

function showPinError(text) {
    if (pinError) {
        pinError.innerText = text;
        pinError.classList.add('active');

        clearTimeout(pinErrorTimeout);
        pinErrorTimeout = setTimeout(() => {
            pinError.classList.remove('active');
        }, 4500);
    }
    enteredPin = '';
    updatePinDots();
}

function finishPinLogin() {
    const overlay = document.getElementById('loading-overlay');
    setupFCM(getStoredAdminPhone());
    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.remove('active');
            showScreen('dashboard');
        }, 3000);
    } else {
        showScreen('dashboard');
    }
    verifyStatusSilently(getStoredAdminPhone());
}

async function submitPin() {
    const phone = getStoredAdminPhone();

    if (phone && isPinLocked(phone)) {
        const minLeft = getLockoutMinutesLeft(phone);
        showPinError(`Demasiados intentos. Intenta de nuevo en ${minLeft} min`);
        return;
    }

    if (!phone || !(await verifyPin(phone, enteredPin))) {
        if (phone) {
            const att = incrementPinAttempts(phone);
            if (att.lockedUntil) {
                showPinError('Demasiados intentos. Intenta de nuevo en 60 min');
            } else {
                const remaining = MAX_PIN_ATTEMPTS - att.count;
                showPinError(`¡Ups! esa no es tu clave, tranqui tienes ${remaining} intentos más`);
            }
        } else {
            showPinError('PIN incorrecto');
        }
        return;
    }

    resetPinAttempts(phone);
    if (pinError) {
        pinError.classList.remove('active');
    }

    // Firebase Auth validation silenciosa (si hay conexión)
    if (firebaseAuth) {
        try {
            const fbUser = await signInFirebaseAuth(phone, enteredPin);
            if (!fbUser) {
                // Firebase rechazó — posiblemente PIN cambiado en otro lado
                // Se permite igual (fallback offline)
            }
        } catch (e) {
            // Sin conexión — se permite offline
        }
    }

    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('active');

    if (dbFirestore) {
        try {
            const phoneNorm = normalizeColombianMobile(phone);
            const deviceMatch = await ensureDeviceBound(phoneNorm);
            resetOfflineCount(phoneNorm);

            if (deviceMatch === 'device_mismatch' || deviceMatch === 'account_suspended' || deviceMatch === 'new_account' || deviceMatch === 'blocked') {
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                sessionStorage.setItem('block_reason', deviceMatch);
                history.replaceState({ screenId: 'blocked' }, null, "");
                showScreen('blocked', false);
                return;
            }

            const mainSnap = await getUserAccessRef(phoneNorm).get({ source: 'server' });
            if (!mainSnap.exists) {
                localStorage.removeItem('firestore_doc_created');
            }
        } catch (e) {
            const count = incrementOfflineCount(phone);
            if (count > 1) {
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                sessionStorage.setItem('block_reason', 'offline_limit');
                history.replaceState({ screenId: 'blocked' }, null, "");
                showScreen('blocked', false);
                return;
            }
        }
    }

    const storedUid = localStorage.getItem('admin_uid') || `local-${Date.now()}`;
    const storedEmail = localStorage.getItem('admin_auth_email') || buildAuthEmailFromPhone(phone);
    const result = await ensureUserAccessDoc(phone, { uid: storedUid }, 'pin-login', storedEmail);

    if (result && result.deviceBlocked) {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        const reason = (result.data && result.data.blockReason) || 'blocked';
        sessionStorage.setItem('block_reason', reason);
        verifyStatusSilently(normalizeColombianMobile(phone));
        history.replaceState({ screenId: 'blocked' }, null, "");
        showScreen('blocked', false);
        return;
    }

    // Recovery: if name is empty, redirect to admin-login to enter name/balance
    if (!db.user.name) {
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        showScreen('admin-login', false);
        const phoneInput = document.getElementById('admin-phone');
        if (phoneInput) phoneInput.value = normalizeColombianMobile(phone);
        document.getElementById('admin-name').value = '';
        const lnInputRec = document.getElementById('admin-lastname');
        if (lnInputRec) lnInputRec.value = '';
        document.getElementById('admin-balance').value = '';
        const { stepPhone, stepPin } = getAdminPinEls();
        stepPhone.classList.add('show-step');
        stepPin.classList.remove('show-step');
        adminStep = 'phone';
        return;
    }

    finishPinLogin();
}

pinKeys.forEach(key => {
    key.addEventListener('click', () => {
        const value = key.dataset.key;
        const action = key.dataset.action;

        if (action === 'delete') {
            enteredPin = enteredPin.slice(0, -1);
            if (pinError) {
                pinError.classList.remove('active');
            }
            updatePinDots();
            return;
        }

        if (!value || enteredPin.length >= 4) return;

        enteredPin += value;
        if (pinError) {
            pinError.classList.remove('active');
        }
        updatePinDots();

        if (enteredPin.length === 4) {
            setTimeout(() => submitPin().catch(() => { }), 120);
        }
    });
});

// FAB Toggle
if (btnOpenFab) {
    btnOpenFab.addEventListener('click', () => {
        const isActive = fabOverlay.classList.toggle('active');
        btnOpenFab.classList.toggle('fab-active', isActive);
        lucide.createIcons();
    });
}



// Close on overlay click
if (fabOverlay) {
    fabOverlay.addEventListener('click', (e) => {
        if (e.target === fabOverlay) {
            fabOverlay.classList.remove('active');
            btnOpenFab.classList.remove('fab-active');
        }
    });
}

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const screenId = item.dataset.screen;
        if (screenId) showScreen(screenId);
    });
});

// Notification Tabs Logic
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('notif-tab')) {
        const notifTabs = document.querySelectorAll('.notif-tab');
        notifTabs.forEach(t => {
            t.classList.remove('active');
            t.style.background = 'transparent';
            t.style.color = '#888';
            t.style.fontWeight = '600';
            t.style.boxShadow = 'none';
        });
        e.target.classList.add('active');
        e.target.style.background = 'var(--nequi-magenta)';
        e.target.style.color = 'white';
        e.target.style.fontWeight = '800';
        e.target.style.boxShadow = '0 2px 4px rgba(218, 0, 129, 0.2)';
        renderNotifications();
    }
});

// Send Money Logic
const inputPhone = document.getElementById('input-phone');
const recipientHint = document.getElementById('recipient-name');

// Validation Logic Helpers
const defaultPhoneMsg = "Revisa bien el número para enviarle a la persona correcta.";

function showFieldError(msgId, text) {
    const el = document.getElementById(msgId);
    if (el) {
        el.innerText = text;
        el.className = 'field-message error';
    }
}

function showFieldHint(msgId, text) {
    const el = document.getElementById(msgId);
    if (el) {
        el.innerText = text;
        el.className = 'field-message hint';
    }
}

function clearFieldMessage(msgId) {
    const el = document.getElementById(msgId);
    if (el) {
        el.innerText = '';
        el.className = 'field-message';
    }
}

inputPhone.addEventListener('focus', () => {
    if (!inputPhone.value) {
        showFieldError('msg-phone', '!Ups! Debes llenar esto');
    }
});

inputPhone.addEventListener('blur', () => {
    if (!inputPhone.value) {
        showFieldError('msg-phone', '!Ups! Debes llenar esto');
    } else {
        showFieldHint('msg-phone', defaultPhoneMsg);
    }
});

inputPhone.addEventListener('input', (e) => {
    const val = e.target.value;

    if (val.length > 0) {
        // As per user request, hints are also shown in red (error style)
        showFieldError('msg-phone', 'Escribe un número de 10 dígitos para enviar plata');
    } else {
        showFieldError('msg-phone', '!Ups! Debes llenar esto');
    }

    if (val.length === 10) {
        if (recipientHint) recipientHint.innerText = "";
    } else {
        if (recipientHint) recipientHint.innerText = "";
    }
});

const inputAmount = document.getElementById('input-amount');
inputAmount.addEventListener('focus', () => {
    if (!inputAmount.value) {
        showFieldError('msg-amount', '!Ups! Debes llenar esto');
    }
});

inputAmount.addEventListener('blur', () => {
    if (!inputAmount.value) {
        showFieldError('msg-amount', '!Ups! Debes llenar esto');
    } else {
        clearFieldMessage('msg-amount');
    }
});

inputAmount.addEventListener('input', () => {
    if (inputAmount.value) {
        clearFieldMessage('msg-amount');
    } else {
        showFieldError('msg-amount', '!Ups! Debes llenar esto');
    }
});

function toggleSendButton() {
    const phoneOk = (document.getElementById('input-phone').value || '').replace(/\D/g, '').length >= 10;
    const amountOk = parseFloat(document.getElementById('input-amount').value) > 0;
    btnConfirmSend.disabled = !(phoneOk && amountOk);
}

document.getElementById('input-phone').addEventListener('input', toggleSendButton);
document.getElementById('input-amount').addEventListener('input', toggleSendButton);
setTimeout(toggleSendButton, 100);

const btnConfirmSend = document.getElementById('btn-confirm-send');
btnConfirmSend.addEventListener('click', () => {
    const phoneInput = document.getElementById('input-phone').value;
    const phoneVal = normalizePhone(phoneInput); // Normalización definitiva
    const amountVal = parseFloat(document.getElementById('input-amount').value);

    if (!phoneVal || phoneVal.length < 10 || isNaN(amountVal) || amountVal <= 0) {
        showToast("Por favor completa los datos correctamente.");
        return;
    }

    // Prepare Confirmation Data
    let recipientName = "Usuario Desconocido";
    const userPhone = normalizePhone(db.user.phone);

    if (phoneVal === userPhone) {
        recipientName = "Tu propia cuenta (Recarga)";
    } else {
        const contact = db.contacts.find(c => normalizePhone(c.phone) === phoneVal);
        recipientName = contact ? contact.name : phoneVal;
    }

    document.getElementById('confirm-recipient-name').innerText = recipientName === "Tu propia cuenta (Recarga)" ? recipientName : maskName(recipientName);
    document.getElementById('confirm-recipient-phone').innerText = formatPhone(phoneVal);
    document.getElementById('confirm-amount').innerText = `$ ${amountVal.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;

    showScreen('confirm-send');

    // Show turquoise warning toast
    const warningToast = document.getElementById('confirm-warning-toast');
    if (warningToast) {
        warningToast.classList.add('active');
        setTimeout(() => {
            warningToast.classList.remove('active');
        }, 6000);
    }
});

const btnFinalSend = document.getElementById('btn-final-send');
btnFinalSend.addEventListener('click', () => {
    const phoneInput = document.getElementById('input-phone').value;
    const phoneVal = normalizePhone(phoneInput);
    const amountVal = parseFloat(document.getElementById('input-amount').value);
    const messageVal = document.getElementById('input-message').value || "Nada";

    // Logic for Self-Recharge (Special hidden feature)
    if (phoneVal === normalizePhone(db.user.phone)) {
        db.user.balance += amountVal;
        // Registro de movimiento para recarga
        db.movements = db.movements || [];
        db.movements.unshift({
            type: 'recharge',
            name: 'Recarga de saldo',
            phone: formatPhone(phoneVal),
            amount: amountVal,
            date: getCurrentDateTime(),
            timestamp: Date.now(),
            reference: generateReference()
        });
        updateUserData();
        saveDB(); // Persist: user action (self-recharge)

        const successToast = document.getElementById('success-toast');
        if (successToast) {
            successToast.innerText = "¡Saldo actualizado con éxito!";
            successToast.classList.add('active');
            setTimeout(() => {
                successToast.classList.remove('active');
            }, 3000);
        }

        showReceipt(amountVal, "Tu propia cuenta", phoneVal, messageVal);
        return;
    }

    if (amountVal > db.user.balance) {
        showToast("Saldo insuficiente.");
        return;
    }

    // Process Transaction
    db.user.balance -= amountVal;
    const contact = db.contacts.find(c => normalizePhone(c.phone) === phoneVal);
    const recipientName = contact ? contact.name : phoneVal;
    db.movements = db.movements || [];
    db.movements.unshift({
        type: 'send',
        name: recipientName,
        phone: formatPhone(phoneVal),
        amount: amountVal,
        message: messageVal,
        date: getCurrentDateTime(),
        timestamp: Date.now(),
        reference: generateReference()
    });
    updateUserData();
    saveDB(); // Persist: user action (send money)

    showReceipt(amountVal, recipientName, phoneVal, messageVal);
});

function showReceipt(amount, name, phone, message, type = 'send') {
    // Prepara los datos del recibo antes de mostrar la animación
    document.getElementById('receipt-amount').innerText = `$ ${amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    document.getElementById('receipt-name').innerText = name;
    document.getElementById('receipt-phone').innerText = formatPhone(phone);
    const statusBadge = document.querySelector('.status-badge');
    if (statusBadge) {
        const icon = type === 'pide' ? 'arrow-up' : 'arrow-down';
        const text = type === 'pide' ? 'Solicitud Enviada' : 'Envío Realizado';
        statusBadge.innerHTML = `<div style="width:20px;height:20px;background:#FFEDF4;color:#D66D8C;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;"><i data-lucide="${icon}" style="width:12px;"></i></div>${text}`;
    }

    // Gestión inteligente de la "Conversación"
    const msgEl = document.getElementById('receipt-message');
    const msgRow = msgEl.parentElement; // .receipt-item
    const cleanMsg = (message || '').toString().trim();

    if (!cleanMsg || cleanMsg.toLowerCase() === 'nada' || cleanMsg.toLowerCase() === 'ninguna') {
        msgRow.style.display = 'none';
    } else {
        msgRow.style.display = 'block';
        msgEl.innerText = cleanMsg;
    }
    document.getElementById('receipt-date').innerText = getCurrentDateTime();
    const ref = generateReference();
    document.getElementById('receipt-ref').innerText = ref;

    // Generar QR Real con datos
    const qrData = `Nequi Voucher|Ref:${ref}|Para:${name}|Valor:${amount}`;
    renderRealReceiptQr(qrData);

    // Muestra animación de carga antes del recibo (igual que al inicio y login)
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.remove('active');
            showScreen('success');
        }, 3000);
    } else {
        showScreen('success');
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function drawVoucherCanvas(callback) {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 950;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, 600, 950);
        drawVoucherContent(ctx, canvas, callback);
    };
    img.onerror = () => fallbackBg(ctx, canvas, callback);
    img.src = 'data:image/png;base64,' + (typeof FONDO_VOUCHER_B64 !== 'undefined' ? FONDO_VOUCHER_B64 : '');
}

function fallbackBg(ctx, canvas, callback) {
    const grad = ctx.createLinearGradient(0, 0, 0, 950);
    grad.addColorStop(0, '#F7F5FA');
    grad.addColorStop(0.3, '#FFFFFF');
    grad.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 950);
    drawVoucherContent(ctx, canvas, callback);
}

function drawVoucherContent(ctx, canvas, callback) {
    try {
        ctx.fillStyle = '#666';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Comprobante de pago', 300, 45);

        ctx.textAlign = 'left';
        ctx.beginPath();
        ctx.arc(45, 85, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#FFEDF4';
        ctx.fill();
        ctx.strokeStyle = '#D66D8C';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#D66D8C';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('↓', 45, 91);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#D66D8C';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('Envío Realizado', 70, 91);

        const qrContainer = document.getElementById('receipt-random-qr');
        const qrImgEl = qrContainer ? qrContainer.querySelector('.qr-main-img') : null;
        const qx = 210, qy = 125, qw = 160, qh = 160, r = 8;

        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.08)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(qx + r, qy);
        ctx.lineTo(qx + qw - r, qy);
        ctx.arcTo(qx + qw, qy, qx + qw, qy + r, r);
        ctx.lineTo(qx + qw, qy + qh - r);
        ctx.arcTo(qx + qw, qy + qh, qx + qw - r, qy + qh, r);
        ctx.lineTo(qx + r, qy + qh);
        ctx.arcTo(qx, qy + qh, qx, qy + qh - r, r);
        ctx.lineTo(qx, qy + r);
        ctx.arcTo(qx, qy, qx + r, qy, r);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

        try {
            if (qrImgEl && qrImgEl.complete && qrImgEl.naturalWidth > 0) {
                ctx.drawImage(qrImgEl, qx + 10, qy + 10, 140, 140);
            } else {
                throw new Error('QR not ready');
            }
        } catch {
            ctx.fillStyle = '#EEE';
            ctx.fillRect(qx + 10, qy + 10, 140, 140);
            ctx.fillStyle = '#999';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('QR', qx + 80, qy + 85);
        }

        ctx.beginPath();
        ctx.arc(qx + 80, qy + 80, 16, 0, Math.PI * 2);
        ctx.fillStyle = '#DA0081';
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', qx + 80, qy + 80);
        ctx.textBaseline = 'alphabetic';

        ctx.fillStyle = '#999';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('¡Escanea este QR con Nequi para verificar tu envío al instante!', 300, 315);

        const details = [
            { label: 'Para', id: 'receipt-name' },
            { label: 'Conversación', id: 'receipt-message' },
            { label: '¿Cuánto?', id: 'receipt-amount' },
            { label: 'Número Nequi', id: 'receipt-phone' },
            { label: 'Fecha', id: 'receipt-date' },
            { label: 'Referencia', id: 'receipt-ref' },
            { label: '¿De dónde salió la plata?', value: 'Disponible' },
        ];

        let y = 340;
        ctx.textAlign = 'left';
        details.forEach(d => {
            const val = d.value || document.getElementById(d.id)?.innerText || '';
            ctx.strokeStyle = '#E5E5E5';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(570, y);
            ctx.stroke();
            y += 16;
            ctx.fillStyle = '#999';
            ctx.font = '12px sans-serif';
            ctx.fillText(d.label, 30, y);
            y += 18;
            ctx.fillStyle = '#200020';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(val, 30, y);
            y += 30;
        });

        canvas.toBlob(callback, 'image/jpeg', 0.92);
    } catch (e) {
        if (DEBUG_MODE) console.error('Voucher error:', e);
        showToast('No se pudo generar el voucher: ' + e.message, 'error');
    }
}

function genVoucher() {
    showToast('Generando voucher de prueba...', 'info');
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 950;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, 600, 950);
        drawVoucherContent(ctx, canvas, blob => {
            if (!blob) { showToast('Error', 'error'); return; }
            downloadBlob(blob, 'voucher-test.jpg');
            showToast('Voucher descargado', 'success');
        });
    };
    img.onerror = () => {
        const grad = ctx.createLinearGradient(0, 0, 0, 950);
        grad.addColorStop(0, '#F7F5FA'); grad.addColorStop(1, '#FFFFFF');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 600, 950);
        drawVoucherContent(ctx, canvas, blob => {
            if (!blob) { showToast('Error', 'error'); return; }
            downloadBlob(blob, 'voucher-test.jpg');
            showToast('Voucher descargado', 'success');
        });
    };
    img.src = 'data:image/png;base64,' + (typeof FONDO_VOUCHER_B64 !== 'undefined' ? FONDO_VOUCHER_B64 : '');
}

// Compartir Voucher: canvas puro → JPG → share nativo / descarga
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-share-receipt');
    if (btn) {
        e.preventDefault();
        e.stopPropagation();
        showToast('Generando imagen del voucher...', 'info');
        drawVoucherCanvas(blob => {
            if (!blob) { showToast('No se pudo generar el voucher', 'error'); return; }
            const file = new File([blob], 'voucher-nequi.jpg', { type: 'image/jpeg' });
            if (navigator.share) {
                navigator.share({ files: [file] }).catch(() => {
                    downloadBlob(blob, 'voucher-nequi.jpg');
                    showToast('Voucher descargado', 'success');
                });
            } else {
                downloadBlob(blob, 'voucher-nequi.jpg');
                showToast('Voucher descargado', 'success');
            }
        });
    }
});

// Helpers
function maskName(fullName) {
    const parts = fullName.split(' ');
    const maskedParts = parts.map(part => {
        if (part.length <= 3) return part;
        return part.slice(0, 3) + '***';
    });
    return maskedParts.slice(0, 2).join(' '); // Limit to First Name and First Surname
}

function formatPhone(phone) {
    if (phone.length === 10) {
        return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
    }
    return phone;
}

function generateReference() {
    const randomNum = Math.floor(10000000 + Math.random() * 90000000);
    return `M0${randomNum}`;
}

function generateQrFallbackDataUrl(text) {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 160, 160);
    ctx.fillStyle = '#200020';
    const grid = 6, gap = 1, cell = Math.floor((160 - gap) / grid);
    for (let r = 0; r < grid; r++) {
        for (let col = 0; col < grid; col++) {
            if ((r + col) % 2 === 0 || (r === col) || (r + col === grid - 1)) {
                ctx.fillRect(col * (cell + gap), r * (cell + gap), cell, cell);
            }
        }
    }
    ctx.fillStyle = '#200020';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    const label = text.split('|').slice(0, 2).join(' ');
    ctx.fillText(label.length > 20 ? label.slice(0, 20) + '..' : label, 80, 150);
    return c.toDataURL('image/png');
}

async function renderRealReceiptQr(text) {
    const qrContainer = document.getElementById('receipt-random-qr');
    if (!qrContainer) return;

    const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(text)}&color=200020`;

    try {
        const resp = await fetch(apiUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const dataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        qrContainer.innerHTML = `
            <img src="${dataUrl}" alt="QR Code" class="qr-main-img">
            <img src="img/logo_n.png" alt="N" class="qr-center-logo">
        `;
    } catch {
        const fallbackUrl = generateQrFallbackDataUrl(text);
        qrContainer.innerHTML = `
            <img src="${fallbackUrl}" alt="QR Code" class="qr-main-img">
            <img src="img/logo_n.png" alt="N" class="qr-center-logo">
        `;
    }
}

function getCurrentDateTime() {
    const now = new Date();
    const options = {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    return now.toLocaleDateString('es-CO', options).replace(',', ' a las');
}

// Styled toast - replaces alert() for errors, success, info, warning
function showToast(text, type = 'error', duration = 4000) {
    const el = document.getElementById('toast-message');
    if (!el) return;
    el.className = 'toast-message';
    el.classList.add(type);
    el.innerText = text;
    el.classList.add('active');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('active'), duration);
}

// Show loading then "no connection" message (replaces "Próximamente")
function showComingSoon() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('active');
    setTimeout(() => {
        if (overlay) overlay.classList.remove('active');
        showToast('No se pudo cargar la pantalla, revisa tu conexión a internet', 'warning', 4000);
    }, 1500);
}

// WhatsApp Sharing (Placeholder for future update)
// Redesigned UI uses a share icon in the header.

// Send Options Menu
function showSendOptions() {
    document.getElementById('send-options-modal').classList.add('active');
    document.getElementById('fab-overlay').classList.remove('active');
    document.getElementById('btn-open-fab').classList.remove('fab-active');
}

function closeSendOptions() {
    document.getElementById('send-options-modal').classList.remove('active');
}

function goToSendMoney() {
    closeSendOptions();
    showScreen('send');
}

// Add Client Logic
const addClientModal = document.getElementById('add-client-modal');
const btnAddClientTrigger = document.getElementById('btn-add-client-trigger');
const btnSaveClient = document.getElementById('btn-save-client');

if (btnAddClientTrigger) {
    btnAddClientTrigger.addEventListener('click', () => {
        addClientModal.classList.add('active');
        // Pre-fill with current data if needed, or leave empty for "new"
        document.getElementById('new-client-name').value = db.user.name;
        document.getElementById('new-client-phone').value = db.user.phone;
    });
}

function closeAddClient() {
    addClientModal.classList.remove('active');
}

if (btnSaveClient) {
    btnSaveClient.addEventListener('click', () => {
        const newName = document.getElementById('new-client-name').value;
        const newPhone = document.getElementById('new-client-phone').value;

        if (!newName || !newPhone || newPhone.length < 10) {
            showToast("Por favor ingresa un nombre y un número válido.");
            return;
        }

        // Update DB
        db.user.name = newName;
        db.user.phone = newPhone;

        // Update UI
        updateUserData();
        saveDB(); // Persist: user action (save client)

        // Close modal
        closeAddClient();

        // Visual feedback
        showToast("¡Cliente actualizado con éxito!", 'success');
    });
}

// Add Contact Logic
const addContactModal = document.getElementById('add-contact-modal');
const btnAddContactTrigger = document.getElementById('btn-add-contact-trigger');
const btnSaveContact = document.getElementById('btn-save-contact');

if (btnAddContactTrigger) {
    btnAddContactTrigger.addEventListener('click', () => {
        addContactModal.classList.add('active');
        document.getElementById('new-contact-name').value = '';
        document.getElementById('new-contact-phone').value = '';
    });
}

function closeAddContact() {
    addContactModal.classList.remove('active');
}

if (btnSaveContact) {
    btnSaveContact.addEventListener('click', () => {
        const name = document.getElementById('new-contact-name').value;
        const phone = document.getElementById('new-contact-phone').value;

        if (!name || !phone || phone.length < 10) {
            showToast("Por favor ingresa nombre y celular del contacto.");
            return;
        }

        // Add to contacts array
        db.contacts.push({ name, phone });
        saveDB(); // Persist new contact

        // Close modal
        closeAddContact();

        // Visual feedback
        showToast(`¡Contacto ${name} agregado con éxito!`, 'success');
    });
}

// Movimientos Tabs Logic
const tabHoy = document.getElementById('tab-hoy');
const tabMasMov = document.getElementById('tab-mas-mov');

if (tabHoy && tabMasMov) {
    tabHoy.addEventListener('click', () => {
        activeMovTab = 'hoy';
        tabHoy.style.background = 'var(--nequi-magenta)';
        tabHoy.style.color = 'white';
        tabHoy.style.fontWeight = '800';
        tabHoy.style.boxShadow = '0 2px 4px rgba(218, 0, 129, 0.2)';

        tabMasMov.style.background = 'transparent';
        tabMasMov.style.color = '#888';
        tabMasMov.style.fontWeight = '600';
        tabMasMov.style.boxShadow = 'none';

        renderMovements();
    });

    tabMasMov.addEventListener('click', () => {
        activeMovTab = 'mas';
        tabMasMov.style.background = 'var(--nequi-magenta)';
        tabMasMov.style.color = 'white';
        tabMasMov.style.fontWeight = '800';
        tabMasMov.style.boxShadow = '0 2px 4px rgba(218, 0, 129, 0.2)';

        tabHoy.style.background = 'transparent';
        tabHoy.style.color = '#888';
        tabHoy.style.fontWeight = '600';
        tabHoy.style.boxShadow = 'none';

        renderMovements();
    });
}

// Global Error/Loading Handler for Unimplemented Features
function showConnectionError() {
    const overlay = document.getElementById('loading-overlay');
    const errorOverlay = document.getElementById('error-overlay');

    if (!overlay || !errorOverlay) return;

    overlay.classList.add('active');

    // Simulate loading/connection dance (Extended as per user request)
    setTimeout(() => {
        overlay.classList.remove('active');
        errorOverlay.classList.add('active');
    }, 8000);
}

// Attach to global window for inline onclick use if needed
window.showConnectionError = showConnectionError;

// Auto-attach to unimplemented elements (currently unused, kept for future)
// --- FLOW: WITHDRAW (SACA) ---
let withdrawData = {
    channel: '',
    code: '',
    timeLeft: 1800, // 30 minutes in seconds
    timerId: null,
    isCodeVisible: false
};

function startWithdraw() {
    withdrawData.channel = '';
    withdrawData.code = '';
    withdrawData.timeLeft = 1800;
    withdrawData.isCodeVisible = false;

    // Update available balance in withdraw source screen
    const available = db.user.balance.toLocaleString('es-CO', { minimumFractionDigits: 2 });
    const el = document.getElementById('withdraw-available-balance');
    if (el) el.innerText = `$ ${available}`;

    showScreen('withdraw-channel');
}

function selectWithdrawChannel(channel) {
    withdrawData.channel = channel;

    // Update available balances
    const available = db.user.balance.toLocaleString('es-CO', { minimumFractionDigits: 2 });
    const el = document.getElementById('withdraw-available-balance');
    if (el) el.innerText = `$ ${available}`;

    const colchon = (db.colchon?.balance || 0).toLocaleString('es-CO', { minimumFractionDigits: 2 });
    const elColchon = document.getElementById('withdraw-colchon-balance');
    if (elColchon) elColchon.innerText = `$ ${colchon}`;

    showScreen('withdraw-source');
}

function confirmWithdraw() {
    // Show existing splash
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.remove('active');
            completeWithdraw();
        }, 3000);
    } else {
        completeWithdraw();
    }
}

function completeWithdraw() {
    const amountInput = document.getElementById('withdraw-amount');
    const amount = amountInput ? parseFloat(amountInput.value) : 0;
    if (isNaN(amount) || amount <= 0) {
        showToast('Ingresa un monto válido para retirar.');
        showScreen('dashboard');
        return;
    }
    if (amount < 10000) {
        showToast('El monto mínimo de retiro es $10.000.');
        showScreen('dashboard');
        return;
    }

    if (db.user.balance < amount) {
        showToast("Saldo insuficiente para realizar el retiro.");
        showScreen('dashboard');
        return;
    }

    db.user.balance -= amount;

    // Register movement
    db.movements = db.movements || [];
    db.movements.unshift({
        type: 'withdraw',
        name: `Retiro ${withdrawData.channel}`,
        phone: withdrawData.channel,
        amount: amount,
        date: getCurrentDateTime(),
        timestamp: Date.now(),
        reference: generateReference(),
        status: 'pending'
    });

    // Generate Code
    withdrawData.code = Math.floor(100000 + Math.random() * 900000).toString();

    // Reset Timer
    withdrawData.timeLeft = 1800;
    if (withdrawData.timerId) clearInterval(withdrawData.timerId);
    withdrawData.timerId = setInterval(updateWithdrawTimer, 1000);

    // UI Update
    const display = document.getElementById('withdraw-code-display');
    if (display) {
        display.innerText = '••••••';
        display.classList.add('withdraw-code-hidden');
    }
    const eyeBtn = document.getElementById('btn-toggle-withdraw-code');
    if (eyeBtn) {
        eyeBtn.innerHTML = '<i data-lucide="eye-off"></i>';
        lucide.createIcons();
    }

    document.getElementById('withdraw-expired-msg').style.display = 'none';

    updateWithdrawTimer(); // Initial call to set UI
    updateUserData();
    saveDB();
    showScreen('withdraw-code');
}

function updateWithdrawTimer() {
    if (withdrawData.timeLeft <= 0) {
        clearInterval(withdrawData.timerId);
        document.getElementById('withdraw-timer-countdown').innerText = '00:00';
        document.getElementById('withdraw-expired-msg').style.display = 'block';
        document.getElementById('withdraw-code-display').innerText = 'EXPIRED';
        document.getElementById('withdraw-timer-progress').style.strokeDashoffset = '339.29';
        return;
    }

    const minutes = Math.floor(withdrawData.timeLeft / 60);
    const seconds = withdrawData.timeLeft % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const countdownEl = document.getElementById('withdraw-timer-countdown');
    if (countdownEl) countdownEl.innerText = formattedTime;

    // Progress circle (339.29 is circumference)
    const progress = (withdrawData.timeLeft / 1800) * 339.29;
    const progressEl = document.getElementById('withdraw-timer-progress');
    if (progressEl) progressEl.style.strokeDashoffset = 339.29 - progress;

    withdrawData.timeLeft--;
}

// Eye Toggle Logic
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-toggle-withdraw-code');
    if (btn) {
        withdrawData.isCodeVisible = !withdrawData.isCodeVisible;
        const display = document.getElementById('withdraw-code-display');
        if (display) {
            if (withdrawData.isCodeVisible) {
                display.innerText = withdrawData.code;
                display.classList.remove('withdraw-code-hidden');
                btn.innerHTML = '<i data-lucide="eye"></i>';
            } else {
                display.innerText = '••••••';
                display.classList.add('withdraw-code-hidden');
                btn.innerHTML = '<i data-lucide="eye-off"></i>';
            }
            lucide.createIcons();
        }
    }
});

// Auto-attach startWithdraw to global window
window.startWithdraw = startWithdraw;
window.selectWithdrawChannel = selectWithdrawChannel;
window.confirmWithdraw = confirmWithdraw;

function showPide() {
    showScreen('pide');
}

// Auto-attach showPide to global window
window.showPide = showPide;

// ===== PHASE 2: New screens =====

// --- Perfil ---
function renderPerfil() {
    const nameEl = document.getElementById('perfil-name');
    const phoneEl = document.getElementById('perfil-phone');
    if (nameEl) nameEl.innerText = db.user.name;
    if (phoneEl) {
        const p = db.user.phone || '';
        phoneEl.innerText = p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
    }
}

function showEditProfile() {
    document.getElementById('edit-profile-modal').classList.add('active');
    document.getElementById('edit-name').value = db.user.name;
    document.getElementById('edit-phone').value = db.user.phone || '';
}

function closeEditProfile() {
    document.getElementById('edit-profile-modal').classList.remove('active');
}

function saveProfile() {
    const name = document.getElementById('edit-name').value.trim();
    const phone = normalizePhone(document.getElementById('edit-phone').value);
    if (!name || !phone || phone.length < 10) {
        showToast('Completa todos los campos correctamente.');
        return;
    }
    db.user.name = name;
    db.user.phone = phone;
    saveDB();
    updateUserData();
    renderPerfil();
    closeEditProfile();
    const toast = document.getElementById('success-toast');
    if (toast) { toast.innerText = 'Perfil actualizado'; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
}

// --- Tarjeta ---
function renderTarjeta() {
    const data = db.tarjeta || {};
    const numEl = document.getElementById('tarjeta-number');
    const balEl = document.getElementById('tarjeta-balance');
    const holderEl = document.getElementById('tarjeta-holder');
    const toggleBtn = document.getElementById('btn-tarjeta-toggle');
    if (numEl) numEl.innerText = data.number || '**** **** **** 0000';
    if (balEl) balEl.innerText = `$ ${(data.balance || 0).toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    if (holderEl) holderEl.innerText = db.user.name;
    if (toggleBtn) {
        const blocked = data.status === 'blocked';
        toggleBtn.innerText = blocked ? 'Desbloquear' : 'Bloquear';
        toggleBtn.style.background = blocked ? '#4CAF50' : '#E53935';
        const card = document.getElementById('tarjeta-card');
        if (card) card.style.opacity = blocked ? '0.5' : '1';
    }
}

function toggleTarjetaStatus() {
    db.tarjeta = db.tarjeta || {};
    db.tarjeta.status = db.tarjeta.status === 'blocked' ? 'active' : 'blocked';
    saveDB();
    renderTarjeta();
    const msg = db.tarjeta.status === 'blocked' ? 'Tarjeta bloqueada' : 'Tarjeta desbloqueada';
    const toast = document.getElementById('success-toast');
    if (toast) { toast.innerText = msg; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
}

// --- Colchón ---
function renderColchon() {
    const bal = db.colchon?.balance || 0;
    const el = document.getElementById('colchon-balance');
    if (el) el.innerText = `$ ${bal.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    // Colchon movements
    const movList = document.getElementById('colchon-mov-list');
    if (movList) {
        const movs = (db.movements || []).filter(m => m.type === 'colchon_add' || m.type === 'colchon_withdraw').slice(0, 5);
        if (movs.length === 0) {
            movList.innerHTML = '<p style="text-align:center;color:#888;font-size:14px;padding:20px;">No has movido plata del Colchón</p>';
        } else {
            movList.innerHTML = movs.map(m => `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #F0F0F0;">
                    <div style="width:32px;height:32px;background:${m.type === 'colchon_add' ? '#E8F5E9' : '#FFEBEE'};border-radius:50%;display:flex;align-items:center;justify-content:center;">
                        <i data-lucide="${m.type === 'colchon_add' ? 'arrow-down' : 'arrow-up'}" style="width:14px;color:${m.type === 'colchon_add' ? '#4CAF50' : '#E53935'};"></i>
                    </div>
                    <div style="flex:1;"><p style="font-size:13px;font-weight:600;color:var(--nequi-purple-dark);">${m.name}</p><p style="font-size:11px;color:#888;">${m.date}</p></div>
                    <span style="font-weight:700;font-size:14px;color:${m.type === 'colchon_add' ? '#4CAF50' : '#E53935'};">${m.type === 'colchon_add' ? '+' : '-'}$${m.amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</span>
                </div>
            `).join('');
            lucide.createIcons();
        }
    }
}

function showColchonAdd() {
    document.getElementById('colchon-modal-title').innerText = 'Meter plata al Colchón';
    document.getElementById('colchon-modal-btn').innerText = 'Meter';
    document.getElementById('colchon-modal-btn').onclick = confirmColchonAdd;
    document.getElementById('colchon-amount').value = '';
    document.getElementById('colchon-modal').classList.add('active');
}

function showColchonWithdraw() {
    document.getElementById('colchon-modal-title').innerText = 'Sacar plata del Colchón';
    document.getElementById('colchon-modal-btn').innerText = 'Sacar';
    document.getElementById('colchon-modal-btn').onclick = confirmColchonWithdraw;
    document.getElementById('colchon-amount').value = '';
    document.getElementById('colchon-modal').classList.add('active');
}

function closeColchonModal() {
    document.getElementById('colchon-modal').classList.remove('active');
}

function confirmColchonAdd() {
    const amount = parseFloat(document.getElementById('colchon-amount').value);
    if (!amount || amount <= 0) { showToast('Ingresa un valor válido'); return; }
    if (amount > db.user.balance) { showToast('Saldo insuficiente'); return; }
    db.user.balance -= amount;
    db.colchon.balance = (db.colchon.balance || 0) + amount;
    db.movements.unshift({ type: 'colchon_add', name: 'Meter al Colchón', phone: 'Colchón', amount, date: getCurrentDateTime(), timestamp: Date.now(), reference: generateReference() });
    saveDB(); updateUserData(); renderColchon(); closeColchonModal();
    const toast = document.getElementById('success-toast');
    if (toast) { toast.innerText = `$${amount.toLocaleString('es-CO')} metidos al Colchón`; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
}

function confirmColchonWithdraw() {
    const amount = parseFloat(document.getElementById('colchon-amount').value);
    if (!amount || amount <= 0) { showToast('Ingresa un valor válido'); return; }
    if (amount > (db.colchon?.balance || 0)) { showToast('No tienes suficiente en el Colchón'); return; }
    db.colchon.balance = (db.colchon.balance || 0) - amount;
    db.user.balance += amount;
    db.movements.unshift({ type: 'colchon_withdraw', name: 'Sacar del Colchón', phone: 'Colchón', amount, date: getCurrentDateTime(), timestamp: Date.now(), reference: generateReference() });
    saveDB(); updateUserData(); renderColchon(); closeColchonModal();
    const toast = document.getElementById('success-toast');
    if (toast) { toast.innerText = `$${amount.toLocaleString('es-CO')} sacados del Colchón`; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
}

// --- Transfiya ---
function confirmTransfiya() {
    const phone = normalizePhone(document.getElementById('transfiya-phone').value);
    const bank = document.getElementById('transfiya-bank').value.trim();
    const amount = parseFloat(document.getElementById('transfiya-amount').value);
    const message = document.getElementById('transfiya-message').value || '';
    if (!phone || phone.length < 10 || !bank || isNaN(amount) || amount <= 0) {
        showToast('Completa todos los campos correctamente.'); return;
    }
    if (amount > db.user.balance) { showToast('Saldo insuficiente'); return; }
    db.user.balance -= amount;
    db.movements.unshift({ type: 'send', name: `Transfiya a ${bank}`, phone: formatPhone(phone), amount, message, date: getCurrentDateTime(), timestamp: Date.now(), reference: generateReference() });
    saveDB(); updateUserData();
    showReceipt(amount, `Transfiya - ${bank}`, phone, message, 'send');
}

// --- Service Detail ---
function showServiceDetail(serviceId) {
    const service = db.services.find(s => s.id === serviceId);
    if (!service) return;
    const titleEl = document.getElementById('servicio-title');
    const logoEl = document.getElementById('servicio-logo');
    const nameEl = document.getElementById('servicio-name');
    if (titleEl) titleEl.innerText = service.name;
    if (logoEl) logoEl.src = service.image;
    if (nameEl) nameEl.innerText = service.name;
    document.getElementById('servicio-ref').value = '';
    document.getElementById('servicio-amount').value = '';
    currentServiceId = serviceId;
    showScreen('servicio-detalle');
}

let currentServiceId = null;

function confirmServicePayment() {
    const ref = document.getElementById('servicio-ref').value.trim();
    const amount = parseFloat(document.getElementById('servicio-amount').value);
    if (!ref || isNaN(amount) || amount <= 0) { showToast('Completa los datos de la factura'); return; }
    if (amount > db.user.balance) { showToast('Saldo insuficiente'); return; }
    const service = db.services.find(s => s.id === currentServiceId);
    db.user.balance -= amount;
    db.movements.unshift({ type: 'send', name: `Pago ${service?.name || 'Servicio'}`, phone: `Ref: ${ref}`, amount, date: getCurrentDateTime(), timestamp: Date.now(), reference: generateReference() });
    saveDB(); updateUserData();
    showReceipt(amount, service?.name || 'Servicio', ref, 'Pago de factura', 'send');
}

// --- Préstamos ---
function renderPrestamos() {
    const el = document.getElementById('prestamo-available');
    if (el) el.innerText = `$ ${(db.loans?.available || 0).toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    const list = document.getElementById('prestamos-list');
    if (list) {
        const active = db.loans?.active || [];
        if (active.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#888;font-size:14px;">No tienes préstamos activos</div>';
        } else {
            list.innerHTML = active.map(l => `
                <div style="background:white;border-radius:10px;padding:16px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,0.04);display:flex;justify-content:space-between;align-items:center;">
                    <div><p style="font-weight:700;color:var(--nequi-purple-dark);font-size:14px;">$${l.amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</p><p style="font-size:12px;color:#888;">${l.date}</p></div>
                    <span style="font-size:12px;padding:4px 10px;border-radius:4px;background:#FFF3E0;color:#E65100;font-weight:700;">${l.status || 'Activo'}</span>
                </div>
            `).join('');
        }
    }
}

function solicitarPrestamo() {
    const available = db.loans?.available || 0;
    if (available <= 0) { showToast('No tienes préstamos disponibles en este momento.'); return; }
    const amount = Math.min(available, 500000);
    db.user.balance += amount;
    db.loans = db.loans || {};
    db.loans.available = (db.loans.available || 0) - amount;
    db.loans.active = db.loans.active || [];
    db.loans.active.push({ amount, date: getCurrentDateTime(), status: 'Activo', timestamp: Date.now() });
    db.movements.unshift({ type: 'receive', name: 'Préstamo aprobado', phone: 'Nequi Préstamos', amount, date: getCurrentDateTime(), timestamp: Date.now(), reference: generateReference() });
    saveDB(); updateUserData(); renderPrestamos();
    const toast = document.getElementById('success-toast');
    if (toast) { toast.innerText = `¡Préstamo de $${amount.toLocaleString('es-CO')} aprobado!`; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 5000); }
}

// --- Bre-B ---
function renderBreb() {
    const list = document.getElementById('breb-keys-list');
    if (!list) return;

    const phone = db.user?.phone || '300 000 0000';
    const docId = 'CC 1.023.456.789';
    const today = new Date();
    const dateStr = today.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });

    list.innerHTML = `
        <div>
            <div class="breb-card">
                <div class="breb-card-left">
                    <button class="breb-btn-activa">
                        <span class="breb-dot"></span>
                        Activa
                    </button>
                </div>
                <div class="breb-card-center">
                    <h4>${formatPhone(phone)}</h4>
                    <p>Tu Nequi</p>
                    <div class="breb-card-status">
                        <span class="breb-status-text">Registrada</span>
                        <span class="breb-status-date">${dateStr}</span>
                    </div>
                </div>
            </div>
            <div class="breb-card-actions">
                <i data-lucide="copy" onclick="copyToClipboard('${phone}')"></i>
                <i data-lucide="more-horizontal" onclick="showComingSoon()"></i>
            </div>
        </div>
        <div>
            <div class="breb-card">
                <div class="breb-card-left">
                    <button class="breb-btn-activa">
                        <span class="breb-dot"></span>
                        Activa
                    </button>
                </div>
                <div class="breb-card-center">
                    <h4>${docId}</h4>
                    <p>Documento de identidad</p>
                    <div class="breb-card-status">
                        <span class="breb-status-text">Registrada</span>
                        <span class="breb-status-date">${dateStr}</span>
                    </div>
                </div>
            </div>
            <div class="breb-card-actions">
                <i data-lucide="copy" onclick="copyToClipboard('${docId}')"></i>
                <i data-lucide="more-horizontal" onclick="showComingSoon()"></i>
            </div>
        </div>
    `;

    lucide.createIcons();
}

function switchBrebTab(tab) {
    document.querySelectorAll('.breb-tab').forEach(t => {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = '#888';
        t.style.boxShadow = 'none';
        t.style.fontWeight = '600';
    });
    const active = document.getElementById(`breb-tab-${tab}`);
    if (active) {
        active.classList.add('active');
        active.style.background = 'var(--nequi-magenta)';
        active.style.color = 'white';
        active.style.boxShadow = '0 2px 4px rgba(218,0,129,0.2)';
        active.style.fontWeight = '800';
    }
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text.replace(/\s/g, ''));
    } else {
        const ta = document.createElement('textarea');
        ta.value = text.replace(/\s/g, '');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    showToast('Copiado al portapapeles', 'success');
}

// Window exports for onclick
window.renderPerfil = renderPerfil;
window.showEditProfile = showEditProfile;
window.closeEditProfile = closeEditProfile;
window.saveProfile = saveProfile;
window.renderTarjeta = renderTarjeta;
window.toggleTarjetaStatus = toggleTarjetaStatus;
window.renderColchon = renderColchon;
window.showColchonAdd = showColchonAdd;
window.showColchonWithdraw = showColchonWithdraw;
window.closeColchonModal = closeColchonModal;
window.confirmColchonAdd = confirmColchonAdd;
window.confirmColchonWithdraw = confirmColchonWithdraw;
window.confirmTransfiya = confirmTransfiya;
window.showServiceDetail = showServiceDetail;
window.confirmServicePayment = confirmServicePayment;
window.solicitarPrestamo = solicitarPrestamo;
window.renderPrestamos = renderPrestamos;
window.renderBreb = renderBreb;
window.switchBrebTab = switchBrebTab;
window.copyToClipboard = copyToClipboard;

// Ayuda screen
function showAyuda() {
    currentScreenBeforeAyuda = currentScreen;
    showScreen('ayuda');
}

function goBackFromAyuda() {
    showScreen(currentScreenBeforeAyuda || 'dashboard');
}

window.showAyuda = showAyuda;
window.goBackFromAyuda = goBackFromAyuda;

// Recovery modal
function closeRecoveryModal() {
    document.getElementById('recovery-modal').classList.remove('active');
}

window.closeRecoveryModal = closeRecoveryModal;

// Admin: cambiar PIN (desde Perfil)
let changePinStep = 0; // 0=old, 1=new, 2=confirm

function showChangePin() {
    changePinStep = 0;
    document.getElementById('change-pin-modal').classList.add('active');
    document.getElementById('change-pin-old').value = '';
    document.getElementById('change-pin-new').value = '';
    document.getElementById('change-pin-confirm').value = '';
    document.getElementById('change-pin-new-group').style.display = 'none';
    document.getElementById('change-pin-confirm-group').style.display = 'none';
    document.getElementById('change-pin-step-label').innerText = 'Ingresa tu PIN actual';
    document.getElementById('btn-change-pin-next').innerText = 'Sigue';
    document.getElementById('change-pin-error').style.display = 'none';
}

function closeChangePin() {
    document.getElementById('change-pin-modal').classList.remove('active');
}

async function handleChangePinNext() {
    const phone = getStoredAdminPhone();
    const oldPin = document.getElementById('change-pin-old').value;
    const newPin = document.getElementById('change-pin-new').value;
    const confirmPin = document.getElementById('change-pin-confirm').value;
    const errorEl = document.getElementById('change-pin-error');

    if (changePinStep === 0) {
        if (!oldPin || oldPin.length !== 4) {
            errorEl.innerText = 'Ingresa tu PIN actual de 4 dígitos.';
            errorEl.style.display = 'block';
            return;
        }
        if (!phone || !(await verifyPin(phone, oldPin))) {
            errorEl.innerText = 'PIN actual incorrecto.';
            errorEl.style.display = 'block';
            document.getElementById('change-pin-old').value = '';
            return;
        }
        errorEl.style.display = 'none';
        changePinStep = 1;
        document.getElementById('change-pin-old').disabled = true;
        document.getElementById('change-pin-new-group').style.display = '';
        document.getElementById('change-pin-step-label').innerText = 'Ingresa tu nuevo PIN de 4 dígitos';
        document.getElementById('change-pin-new').focus();
        return;
    }

    if (changePinStep === 1) {
        if (!newPin || newPin.length !== 4) {
            errorEl.innerText = 'El nuevo PIN debe tener 4 dígitos.';
            errorEl.style.display = 'block';
            return;
        }
        if (newPin === oldPin) {
            errorEl.innerText = 'El nuevo PIN debe ser diferente al actual.';
            errorEl.style.display = 'block';
            document.getElementById('change-pin-new').value = '';
            return;
        }
        errorEl.style.display = 'none';
        changePinStep = 2;
        document.getElementById('change-pin-confirm-group').style.display = '';
        document.getElementById('change-pin-step-label').innerText = 'Confirma tu nuevo PIN';
        document.getElementById('btn-change-pin-next').innerText = 'Guardar';
        document.getElementById('change-pin-confirm').focus();
        return;
    }

    if (changePinStep === 2) {
        if (!confirmPin || confirmPin.length !== 4) {
            errorEl.innerText = 'Confirma tu nuevo PIN de 4 dígitos.';
            errorEl.style.display = 'block';
            return;
        }
        if (newPin !== confirmPin) {
            errorEl.innerText = 'Los PIN no coinciden.';
            errorEl.style.display = 'block';
            document.getElementById('change-pin-confirm').value = '';
            return;
        }
        (async () => {
            if (firebaseAuth) {
                try {
                    const ok = await updateFirebaseAuthPassword(phone, oldPin, newPin);
                    if (!ok) {
                        errorEl.innerText = 'No se pudo actualizar. Verifica tu conexión e intenta de nuevo.';
                        errorEl.style.display = 'block';
                        return;
                    }
                } catch (e) {
                    errorEl.innerText = 'Error de conexión. Intenta de nuevo más tarde.';
                    errorEl.style.display = 'block';
                    return;
                }
            }
            await setStoredPin(phone, newPin);
            closeChangePin();
            const toast = document.getElementById('success-toast');
            if (toast) { toast.innerText = 'PIN actualizado con éxito'; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
        })().catch(e => { if (DEBUG_MODE) console.error('Change PIN error:', e); });
    }
}

window.showChangePin = showChangePin;
window.closeChangePin = closeChangePin;
window.handleChangePinNext = handleChangePinNext;

// ===== PHASE 1: Missing page connections =====

// FAB: QR Code modal
function showQRCode() {
    const fab = document.getElementById('fab-overlay');
    const btn = document.getElementById('btn-open-fab');
    if (fab) fab.classList.remove('active');
    if (btn) btn.classList.remove('fab-active');
    const modal = document.getElementById('qr-modal');
    if (modal) {
        modal.classList.add('active');
        const qrContainer = document.getElementById('qr-code-display');
        if (qrContainer) {
            const qrData = `Nequi User|${db.user.name}|Phone:${db.user.phone}`;
            const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData)}&color=200020`;
            qrContainer.innerHTML = `<img src="${apiUrl}" alt="QR" style="width:180px;height:180px;" onerror="this.src='${generateQrFallbackDataUrl(qrData)}'">`;
        }
    }
    lucide.createIcons();
}

function closeQRCode() {
    document.getElementById('qr-modal').classList.remove('active');
}

// FAB: Self recharge
function goToSelfRecharge() {
    const fab = document.getElementById('fab-overlay');
    const btn = document.getElementById('btn-open-fab');
    if (fab) fab.classList.remove('active');
    if (btn) btn.classList.remove('fab-active');
    showScreen('send');
    const phoneInput = document.getElementById('input-phone');
    if (phoneInput && db.user.phone) {
        phoneInput.value = db.user.phone;
        phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

// Send options: Bancolombia, Bre-B, Other banks
function goToBancolombia() {
    closeSendOptions();
    selectBancolombiaAccountType('ahorros');
    showScreen('bancolombia');
}

function goToBreb() {
    closeSendOptions();
    renderBreb();
    showScreen('bre-b');
}

function goToOtherBanks() {
    closeSendOptions();
    showScreen('transfiya');
}

// --- Bancolombia Send ---
let bancolombiaAccountType = 'ahorros';

function selectBancolombiaAccountType(type) {
    bancolombiaAccountType = type;
    const savingsBtn = document.getElementById('btn-account-savings');
    const checkingBtn = document.getElementById('btn-account-checking');
    if (savingsBtn && checkingBtn) {
        if (type === 'ahorros') {
            savingsBtn.style.background = 'var(--nequi-magenta)';
            savingsBtn.style.color = 'white';
            savingsBtn.style.fontWeight = '700';
            checkingBtn.style.background = '#E0E0E0';
            checkingBtn.style.color = '#666';
            checkingBtn.style.fontWeight = '600';
        } else {
            checkingBtn.style.background = 'var(--nequi-magenta)';
            checkingBtn.style.color = 'white';
            checkingBtn.style.fontWeight = '700';
            savingsBtn.style.background = '#E0E0E0';
            savingsBtn.style.color = '#666';
            savingsBtn.style.fontWeight = '600';
        }
    }
}

function confirmBancolombia() {
    const account = document.getElementById('bancolombia-account').value.trim();
    const doc = document.getElementById('bancolombia-doc').value.trim();
    const amount = parseFloat(document.getElementById('bancolombia-amount').value);
    const message = document.getElementById('bancolombia-message').value.trim() || '';

    if (!account || account.length < 5) { showToast('Ingresa un número de cuenta válido.'); return; }
    if (!doc || doc.length < 5) { showToast('Ingresa el documento del titular.'); return; }
    if (isNaN(amount) || amount <= 0) { showToast('Ingresa un valor válido.'); return; }
    if (amount > db.user.balance) { showToast('Saldo insuficiente.'); return; }

    db.user.balance -= amount;
    const typeLabel = bancolombiaAccountType === 'ahorros' ? 'Ahorros' : 'Corriente';
    db.movements.unshift({
        type: 'send',
        name: `Bancolombia ${typeLabel}`,
        phone: `Cuenta: ${account}`,
        amount,
        message,
        date: getCurrentDateTime(),
        timestamp: Date.now(),
        reference: generateReference()
    });
    saveDB();
    updateUserData();
    showReceipt(amount, `Bancolombia ${typeLabel}`, account, message, 'send');
}

// --- Bre-B functions ---
function showAddBrebKey() {
    const form = document.getElementById('breb-add-key-form');
    if (form) form.style.display = 'block';
}

function closeAddBrebKey() {
    const form = document.getElementById('breb-add-key-form');
    if (form) {
        form.style.display = 'none';
        const input = document.getElementById('breb-new-key');
        if (input) input.value = '';
    }
}

function confirmAddBrebKey() {
    const input = document.getElementById('breb-new-key');
    const key = input ? input.value.trim() : '';
    if (!key) { showToast('Ingresa una llave Bre-B válida.'); return; }

    db.breb = db.breb || {};
    db.breb.keys = db.breb.keys || [];
    if (db.breb.keys.includes(key)) { showToast('Esta llave ya está registrada.'); return; }

    db.breb.keys.push(key);
    saveDB();
    renderBreb();
    closeAddBrebKey();
    const toast = document.getElementById('success-toast');
    if (toast) { toast.innerText = 'Llave Bre-B agregada'; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
}

function toggleBrebSendForm() {
    const form = document.getElementById('breb-send-form');
    if (!form) return;
    const isVisible = form.style.display !== 'none';
    form.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
        const select = document.getElementById('breb-send-key');
        if (select) {
            const phone = db.user?.phone || '3000000000';
            select.innerHTML = '<option value="">Selecciona una llave</option>';
            select.innerHTML += `<option value="${phone}">Celular: ${formatPhone(phone)}</option>`;
            select.innerHTML += '<option value="documento">Documento de identidad</option>';
            if (db.breb?.keys) {
                db.breb.keys.forEach(k => {
                    if (k !== phone) select.innerHTML += `<option value="${k}">${k}</option>`;
                });
            }
        }
    }
}

function confirmBrebSend() {
    const keySelect = document.getElementById('breb-send-key');
    const phone = normalizePhone(document.getElementById('breb-send-phone').value);
    const amount = parseFloat(document.getElementById('breb-send-amount').value);
    const message = document.getElementById('breb-send-message').value.trim() || '';
    const selectedKey = keySelect ? keySelect.value : '';

    if (!selectedKey) { showToast('Selecciona una llave Bre-B.'); return; }
    if (!phone || phone.length < 10) { showToast('Ingresa un celular válido del destinatario.'); return; }
    if (isNaN(amount) || amount <= 0) { showToast('Ingresa un valor válido.'); return; }
    if (amount > db.user.balance) { showToast('Saldo insuficiente.'); return; }

    db.user.balance -= amount;
    db.movements.unshift({
        type: 'send',
        name: 'Bre-B',
        phone: `${selectedKey} → ${formatPhone(phone)}`,
        amount,
        message,
        date: getCurrentDateTime(),
        timestamp: Date.now(),
        reference: generateReference()
    });
    saveDB();
    updateUserData();
    showReceipt(amount, `Bre-B (${selectedKey})`, phone, message, 'send');
}

// Forgot PIN
function showForgotPin() {
    showToast('Para recuperar tu clave, comunícate al WhatsApp 3214484092', 'info', 6000);
}

// Pide flow
function confirmPide() {
    const phone = normalizePhone(document.getElementById('pide-phone').value);
    const amount = parseFloat(document.getElementById('pide-amount').value);
    const message = document.getElementById('pide-message').value || '';

    if (!phone || phone.length < 10 || isNaN(amount) || amount <= 0) {
        showToast('Por favor completa los datos correctamente.');
        return;
    }

    db.movements = db.movements || [];
    db.movements.unshift({
        type: 'receive',
        name: 'Solicitud de pago',
        phone: formatPhone(phone),
        amount: amount,
        message: message,
        date: getCurrentDateTime(),
        timestamp: Date.now(),
        reference: generateReference(),
        status: 'pending'
    });
    saveDB();
    updateUserData();
    showReceipt(amount, 'Solicitud enviada', phone, message, 'pide');
}

// Pockets
function showCreatePocket() {
    document.getElementById('create-pocket-modal').classList.add('active');
    document.getElementById('pocket-name').value = '';
    document.getElementById('pocket-amount').value = '';
}

function closeCreatePocket() {
    document.getElementById('create-pocket-modal').classList.remove('active');
}

function savePocket() {
    const name = document.getElementById('pocket-name').value.trim();
    const amount = parseFloat(document.getElementById('pocket-amount').value) || 0;

    if (!name) {
        showToast('Ingresa un nombre para tu Bolsillo');
        return;
    }

    db.pockets = db.pockets || [];
    db.pockets.push({
        id: Date.now().toString(),
        name: name,
        amount: amount,
        createdAt: new Date().toISOString()
    });

    if (amount > 0 && amount <= db.user.balance) {
        db.user.balance -= amount;
    } else if (amount > db.user.balance) {
        showToast('Saldo insuficiente para apartar esa cantidad.');
        return;
    }

    saveDB();
    closeCreatePocket();
    updateUserData();
    renderPockets();

    const toast = document.getElementById('success-toast');
    if (toast) {
        toast.innerText = '¡Bolsillo creado con éxito!';
        toast.classList.add('active');
        setTimeout(() => toast.classList.remove('active'), 3000);
    }
}

function renderPockets() {
    const screen = document.getElementById('screen-pockets');
    if (!screen) return;

    const pockets = db.pockets || [];
    const emptyEl = screen.querySelector('.pockets-empty');
    const listEl = screen.querySelector('.pockets-list');

    if (pockets.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        if (listEl) listEl.style.display = 'none';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) {
        listEl.style.display = '';
        listEl.innerHTML = pockets.map(p => `
            <div class="sheet-card" style="margin-bottom:10px;">
                <div class="card-icon"><i data-lucide="wallet"></i></div>
                <div class="card-text">
                    <h4>${p.name}</h4>
                    <p>$${p.amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</p>
                </div>
                <i data-lucide="chevron-right" style="color:var(--nequi-text-gray);"></i>
            </div>
        `).join('');
        lucide.createIcons();
    }
}

// Notifications
function renderNotifications() {
    const container = document.getElementById('notifications-list');
    if (!container) return;

    const notifs = db.notifications || [];
    const recibidas = notifs.filter(n => n.type === 'recibida');
    const espera = notifs.filter(n => n.type === 'espera');

    // Update tab counts
    const tabs = document.querySelectorAll('.notif-tab');
    if (tabs.length >= 2) {
        tabs[0].innerHTML = `Recibidas (${recibidas.length})`;
        tabs[1].innerHTML = `En espera (${espera.length})`;
    }

    const activeTab = document.querySelector('.notif-tab.active');
    const filter = activeTab && activeTab.innerText.toLowerCase().includes('espera') ? 'espera' : 'recibida';
    const filtered = notifs.filter(n => n.type === filter);

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center;">
                <img src="img/notificaciones.png" alt="Sin notificaciones" style="width:180px;margin-bottom:24px;max-width:100%;">
                <p style="font-size:16px;color:#888;font-weight:600;">No tienes notificaciones</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(n => `
        <div class="notif-item" style="background:${n.read ? 'white' : '#FFF5F9'};border-radius:10px;padding:16px;margin:0 20px 10px;box-shadow:0 2px 8px rgba(0,0,0,0.04);${!n.read ? 'border-left:3px solid var(--nequi-magenta);' : ''}">
            <div style="display:flex;align-items:flex-start;gap:12px;">
                <div style="width:36px;height:36px;background:var(--nequi-magenta);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;flex-shrink:0;">
                    <i data-lucide="${n.type === 'espera' ? 'clock' : 'bell'}" style="width:16px;height:16px;"></i>
                </div>
                <div style="flex:1;">
                    <h4 style="font-size:14px;font-weight:700;color:var(--nequi-purple-dark);margin-bottom:4px;">${n.title}</h4>
                    <p style="font-size:13px;color:#666;margin-bottom:4px;">${n.message}</p>
                    <span style="font-size:11px;color:#999;">${n.time}</span>
                </div>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

// Dashboard favoritos & sugeridos actions
function showDashboardMessage(feature) {
    showConnectionError();
}

// Logout with styled modal (replaces native confirm())
function doLogout() {
    const overlay = document.getElementById('logout-confirm-overlay');
    if (overlay) {
        overlay.classList.add('active');
    } else {
        // Fallback si no existe el modal
        clearAdminSession();
        showScreen('login');
    }
}

// Show movement detail — navigates to success screen with movement data
function showMovementDetail(m) {
    if (!m) return;
    const amount = m.amount || 0;
    const name = m.name || '';
    const phone = m.phone || '';
    const message = m.message || '';
    const isPositive = m.type === 'receive' || m.type === 'recharge';
    const type = m.type || 'send';

    // Populate the receipt/voucher screen
    const receiptAmount = document.getElementById('receipt-amount');
    if (receiptAmount) receiptAmount.innerText = `$ ${amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;

    const receiptName = document.getElementById('receipt-name');
    if (receiptName) receiptName.innerText = name;

    const receiptPhone = document.getElementById('receipt-phone');
    if (receiptPhone) receiptPhone.innerText = formatPhone(phone);

    const statusBadge = document.querySelector('.status-badge');
    if (statusBadge) {
        const icon = isPositive ? 'arrow-up' : 'arrow-down';
        const text = isPositive ? 'Recibido' : 'Envío Realizado';
        statusBadge.innerHTML = `<div style="width:20px;height:20px;background:#FFEDF4;color:#D66D8C;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;"><i data-lucide="${icon}" style="width:12px;"></i></div>${text}`;
    }

    // Message row
    const msgEl = document.getElementById('receipt-message');
    if (msgEl) {
        const msgRow = msgEl.parentElement;
        const cleanMsg = (message || '').toString().trim();
        if (!cleanMsg || cleanMsg.toLowerCase() === 'nada' || cleanMsg.toLowerCase() === 'ninguna') {
            msgRow.style.display = 'none';
        } else {
            msgRow.style.display = 'block';
            msgEl.innerText = cleanMsg;
        }
    }

    // Date and reference from the movement data
    const receiptDate = document.getElementById('receipt-date');
    if (receiptDate) {
        const mDate = new Date(m.timestamp || m.date || 0);
        receiptDate.innerText = mDate.toLocaleString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    const receiptRef = document.getElementById('receipt-ref');
    if (receiptRef) receiptRef.innerText = m.reference || generateReference();

    // QR
    const ref = m.reference || generateReference();
    const qrData = `Nequi Voucher|Ref:${ref}|${isPositive ? 'De' : 'Para'}:${name}|Valor:${amount}`;
    if (typeof renderRealReceiptQr === 'function') renderRealReceiptQr(qrData);

    showScreen('success');
    lucide.createIcons();
}

// ── Dynamic Key Popover ──
function toggleDynamicKeyDrawer() {
    const popover = document.getElementById('dynamic-key-popover');
    if (!popover) return;
    if (popover.style.display === 'block') {
        hideDynamicKeyPopover();
        return;
    }
    updateDynamicCode();
    const codeEl = document.getElementById('popover-dynamic-code');
    const loginCodeEl = document.getElementById('dynamic-code');
    if (codeEl) {
        codeEl.innerText = loginCodeEl ? loginCodeEl.innerText : '000000';
    }
    const appEl = document.getElementById('app');
    if (appEl) {
        const appRect = appEl.getBoundingClientRect();
        popover.style.right = (window.innerWidth - appRect.right + 16) + 'px';
    } else {
        popover.style.right = '16px';
    }
    popover.style.position = 'fixed';
    popover.style.top = '60px';
    popover.style.zIndex = '99999';
    popover.style.display = 'block';
    popover.classList.add('dkp-show');
    lucide.createIcons();
    setTimeout(() => document.addEventListener('click', dkpOutsideClick), 0);
}
function hideDynamicKeyPopover() {
    const popover = document.getElementById('dynamic-key-popover');
    if (!popover) return;
    popover.style.display = 'none';
    popover.style.position = '';
    popover.style.top = '';
    popover.style.right = '';
    popover.style.zIndex = '';
    popover.classList.remove('dkp-show');
    document.removeEventListener('click', dkpOutsideClick);
}
function dkpOutsideClick(e) {
    const popover = document.getElementById('dynamic-key-popover');
    const trigger = document.getElementById('btn-logout-trigger');
    if (!popover) return;
    if (popover.contains(e.target)) return;
    if (trigger && trigger.contains(e.target)) return;
    hideDynamicKeyPopover();
}
function copyDynamicKey() {
    const codeEl = document.getElementById('popover-dynamic-code');
    if (!codeEl) return;
    const code = codeEl.innerText;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            showToast('Clave copiada', 'success');
        }).catch(() => fallbackCopy(code));
    } else {
        fallbackCopy(code);
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Clave copiada', 'success'); } catch (e) { showToast('No se pudo copiar'); }
    document.body.removeChild(ta);
}

// ── Tu Plata ──
function showTuPlata() {
    const balance = db.user.balance || 0;
    const colchonBalance = (db.colchon && db.colchon.balance) || 0;
    const totalAmount = balance + colchonBalance;
    const total = document.getElementById('tu-plata-total-amount');
    if (total) {
        total.innerText = `$ ${totalAmount.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    }
    const disp = document.getElementById('tu-plata-disponible');
    if (disp) {
        disp.innerText = `$ ${balance.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    }
    const col = document.getElementById('tu-plata-colchon');
    if (col) {
        col.innerText = `$ ${colchonBalance.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
    }
}

// ── Contact Picker ──
let contactPickerTarget = null;
let contactEditIndex = -1;

function showContactPicker(targetInputId) {
    contactPickerTarget = targetInputId;
    const modal = document.getElementById('contacts-modal');
    if (!modal) return;
    const searchInput = document.getElementById('contacts-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = null;
        searchInput.oninput = function () { renderContactList(); };
    }
    modal.classList.add('active');
    renderContactList();
}

function closeContactPicker() {
    const modal = document.getElementById('contacts-modal');
    if (modal) modal.classList.remove('active');
    const searchInput = document.getElementById('contacts-search');
    if (searchInput) searchInput.oninput = null;
    contactPickerTarget = null;
}

function renderContactList() {
    const list = document.getElementById('contacts-list');
    if (!list) return;
    const contacts = db.contacts || [];
    const search = (document.getElementById('contacts-search')?.value || '').toLowerCase().trim();
    if (!search) {
        list.innerHTML = '<div class="empty-contacts">Busca un contacto por nombre o número</div>';
        return;
    }
    const filtered = contacts.filter(c =>
        c.name.toLowerCase().includes(search) || c.phone.includes(search)
    );
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-contacts">Sin resultados</div>';
        return;
    }
    let html = '';
    filtered.forEach((c, idx) => {
        const originalIdx = contacts.indexOf(c);
        const initial = c.name.charAt(0).toUpperCase();
        html += `<div class="contact-item" onclick="selectContact('${escJsStr(c.phone)}', '${escJsStr(c.name)}')">
            <div class="contact-avatar">${initial}</div>
            <div class="contact-info">
                <span class="contact-name">${c.name}</span>
                <span class="contact-phone">${formatPhone(c.phone)}</span>
            </div>
            <div class="contact-actions">
                <i data-lucide="edit" onclick="event.stopPropagation();editContact(${originalIdx})"></i>
                <i data-lucide="trash-2" onclick="event.stopPropagation();deleteContact(${originalIdx})"></i>
            </div>
        </div>`;
    });
    list.innerHTML = html;
    lucide.createIcons();
}

function filterContacts() {
    renderContactList();
}

function selectContact(phone, name) {
    if (contactPickerTarget) {
        const input = document.getElementById(contactPickerTarget);
        if (input) {
            input.value = phone;
            const nameHint = document.getElementById('recipient-name');
            if (nameHint) nameHint.innerText = name;
            // Trigger validation-like visual
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    closeContactPicker();
}

function showAddContact() {
    contactEditIndex = -1;
    document.getElementById('contact-form-title').innerText = 'Nuevo contacto';
    document.getElementById('contact-form-name').value = '';
    document.getElementById('contact-form-phone').value = '';
    document.getElementById('btn-delete-contact').style.display = 'none';
    document.getElementById('contact-form-modal').classList.add('active');
}

function editContact(index) {
    contactEditIndex = index;
    const c = db.contacts[index];
    if (!c) return;
    document.getElementById('contact-form-title').innerText = 'Editar contacto';
    document.getElementById('contact-form-name').value = c.name;
    document.getElementById('contact-form-phone').value = c.phone;
    document.getElementById('btn-delete-contact').style.display = 'block';
    document.getElementById('contact-form-modal').classList.add('active');
}

function closeContactForm() {
    document.getElementById('contact-form-modal').classList.remove('active');
    contactEditIndex = -1;
}

function saveContact() {
    const name = document.getElementById('contact-form-name').value.trim();
    const phone = normalizePhone(document.getElementById('contact-form-phone').value);
    if (!name || !phone || phone.length < 10) {
        showToast('Completa nombre y celular válido.');
        return;
    }
    db.contacts = db.contacts || [];
    if (contactEditIndex >= 0 && contactEditIndex < db.contacts.length) {
        db.contacts[contactEditIndex] = { name, phone };
    } else {
        db.contacts.push({ name, phone });
    }
    saveDB();
    closeContactForm();
    renderContactList();
    showToast('Contacto guardado', 'success');
}

function deleteContact(index) {
    if (index === undefined) {
        index = contactEditIndex;
    }
    if (index < 0 || index >= (db.contacts || []).length) return;
    if (!confirm(`¿Eliminar a ${db.contacts[index].name} de tus contactos?`)) return;
    db.contacts.splice(index, 1);
    saveDB();
    closeContactForm();
    closeContactPicker();
    showToast('Contacto eliminado', 'info');
}

function escJsStr(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Edit Favorites ──
const FAVORITES_KEY = 'nequi_favorites';
const FAVORITE_ITEMS = [
    { id: 'pockets', name: 'Bolsillos', icon: 'img/logo_bolsillos.png' },
    { id: 'tarjeta', name: 'Tarjeta', icon: 'img/logo_tarjeta.png' },
    { id: 'colchon', name: 'Colchón', icon: 'img/logo_colchon.png' },
    { id: 'transfiya', name: 'Transfiya', icon: 'img/logo_transfiya.png' },
    { id: 'prestamos', name: 'Préstamos', icon: 'img/logo_creditos.png' },
    { id: 'breb', name: 'Bre-B', icon: 'img/logo_bre-b.png' },
    { id: 'negocios', name: 'Negocios', icon: 'img/logo_app_nequi_negocios.png' },
    { id: 'tullave', name: 'Maas tullave', icon: 'img/logo_tullave.png' },
    { id: 'claro', name: 'Claro', icon: 'img/logo_claro_2.png' },
    { id: 'tigo', name: 'Tigo', icon: 'img/logo_tigo.png' },
    { id: 'wom', name: 'WOM', icon: 'img/logo_wom.png' }
];
function getFavorites() {
    try {
        const stored = localStorage.getItem(FAVORITES_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) { }
    return ['pockets', 'tarjeta', 'colchon', 'transfiya'];
}
function saveFavorites(ids) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}
function renderDashboardFavorites() {
    const favIds = getFavorites();
    const container = document.getElementById('favorites-grid');
    if (!container) return;
    let html = '';
    favIds.forEach(id => {
        const item = FAVORITE_ITEMS.find(i => i.id === id);
        if (!item) return;
        const action = getFavoriteAction(id);
        html += `<div class="dashboard-action" onclick="${action}">
            <div class="action-square"><img src="${item.icon}" alt="${item.name}"></div>
            <span>${item.name}</span>
        </div>`;
    });
    if (favIds.length < 8) {
        html += `<div class="dashboard-action" onclick="showEditFavorites()">
            <div class="action-square" style="border: 2px dashed var(--nequi-gray-light); background: transparent;"><i data-lucide="plus" style="width:28px;height:28px;color:var(--nequi-text-gray);"></i></div>
            <span>Agregar</span>
        </div>`;
    }
    container.innerHTML = html;
    lucide.createIcons();
}
function getFavoriteAction(id) {
    const actions = {
        'pockets': "showScreen('pockets')",
        'tarjeta': "showScreen('tarjeta')",
        'colchon': "showScreen('colchon')",
        'transfiya': "showScreen('transfiya')",
        'prestamos': "showScreen('prestamos')",
        'breb': "showScreen('bre-b')",
        'negocios': "showScreen('negocios')",
        'tullave': "showServiceDetail('tullave')",
        'claro': "showServiceDetail('claro')",
        'tigo': "showServiceDetail('tigo')",
        'wom': "showServiceDetail('wom')"
    };
    return actions[id] || "showScreen('dashboard')";
}
function showEditFavorites() {
    const modal = document.getElementById('edit-favorites-modal');
    if (!modal) return;
    const favIds = getFavorites();
    const editGrid = document.getElementById('favorites-edit-grid');
    if (editGrid) {
        let html = '';
        favIds.forEach(id => {
            const item = FAVORITE_ITEMS.find(i => i.id === id);
            if (!item) return;
            html += `<div class="fav-edit-item">
                <div class="fav-img-wrap">
                    <img src="${item.icon}" alt="${item.name}">
                    <div class="fav-remove-btn" onclick="removeFavorite('${id}')">✕</div>
                </div>
                <span>${item.name}</span>
            </div>`;
        });
        editGrid.innerHTML = html;
    }
    const addGrid = document.getElementById('favorites-add-grid');
    if (addGrid) {
        const available = FAVORITE_ITEMS.filter(i => !favIds.includes(i.id));
        let html = '';
        available.forEach(item => {
            html += `<div class="fav-edit-item" onclick="addFavorite('${item.id}')">
                <div class="fav-add-btn"><img src="img/logo_agrega.png" style="width:24px;height:24px;"></div>
                <span>${item.name}</span>
            </div>`;
        });
        if (available.length === 0) {
            html = '<p style="color:#888;font-size:13px;width:100%;text-align:center;">Ya tienes todos los favoritos</p>';
        }
        addGrid.innerHTML = html;
    }
    modal.classList.add('active');
    lucide.createIcons();
}
function closeEditFavorites() {
    const modal = document.getElementById('edit-favorites-modal');
    if (modal) modal.classList.remove('active');
    renderDashboardFavorites();
}
function addFavorite(id) {
    const favIds = getFavorites();
    if (favIds.includes(id)) return;
    favIds.push(id);
    saveFavorites(favIds);
    showEditFavorites();
}
function removeFavorite(id) {
    let favIds = getFavorites();
    favIds = favIds.filter(i => i !== id);
    saveFavorites(favIds);
    showEditFavorites();
}

function showBannerInicio() {
    const el = document.getElementById('banner-inicio');
    if (el) el.classList.remove('banner-inicio-hidden');
}
function closeBannerInicio() {
    const el = document.getElementById('banner-inicio');
    if (el) el.classList.add('banner-inicio-hidden');
}

window.closeBannerInicio = closeBannerInicio;
window.showToast = showToast;
window.showComingSoon = showComingSoon;
window.showQRCode = showQRCode;
window.closeQRCode = closeQRCode;
window.goToSelfRecharge = goToSelfRecharge;
window.goToBancolombia = goToBancolombia;
window.goToBreb = goToBreb;
window.goToOtherBanks = goToOtherBanks;
window.selectBancolombiaAccountType = selectBancolombiaAccountType;
window.confirmBancolombia = confirmBancolombia;
window.showAddBrebKey = showAddBrebKey;
window.closeAddBrebKey = closeAddBrebKey;
window.confirmAddBrebKey = confirmAddBrebKey;
window.toggleBrebSendForm = toggleBrebSendForm;
window.confirmBrebSend = confirmBrebSend;
window.showForgotPin = showForgotPin;
window.confirmPide = confirmPide;
window.showCreatePocket = showCreatePocket;
window.closeCreatePocket = closeCreatePocket;
window.savePocket = savePocket;
window.updateBlockedContent = updateBlockedContent;
window.checkAppVersion = checkAppVersion;
window.showQROptions = showQROptions;
window.closeQROptions = closeQROptions;
window.showRechargeOptions = showRechargeOptions;
window.closeRechargeOptions = closeRechargeOptions;
window.doLogout = doLogout;
window.showMovementDetail = showMovementDetail;
window.toggleDynamicKeyDrawer = toggleDynamicKeyDrawer;
window.hideDynamicKeyPopover = hideDynamicKeyPopover;
window.copyDynamicKey = copyDynamicKey;
window.showTuPlata = showTuPlata;
window.showEditFavorites = showEditFavorites;
window.closeEditFavorites = closeEditFavorites;
window.addFavorite = addFavorite;
window.removeFavorite = removeFavorite;
window.showContactPicker = showContactPicker;
window.closeContactPicker = closeContactPicker;
window.selectContact = selectContact;
window.showAddContact = showAddContact;
window.editContact = editContact;
window.closeContactForm = closeContactForm;
window.saveContact = saveContact;
window.deleteContact = deleteContact;

// Offline mode indicator
function updateOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    banner.style.display = navigator.onLine ? 'none' : '';
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
setTimeout(updateOfflineBanner, 1000);

// Start
initApp();
