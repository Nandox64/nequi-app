// Nequi Premium App Logic

// 🔧 DEBUG MODE: false = producción (persiste datos entre sesiones)
// Cambia a true solo para desarrollo/testing
const DEBUG_MODE = false;

// 📦 Versión de la base de datos local
// Cambia este número cada vez que hagas cambios en db.js
// Esto fuerza un reset limpio de localStorage automáticamente
const DB_VERSION = '2026050602'; // Incremented to force data reset
const DEFAULT_DB_STATE = JSON.parse(JSON.stringify(db));
const ADMIN_ACCESS_COLLECTION = 'users_access';
const AUTH_EMAIL_DOMAIN = 'phone.nequi.co';

let currentScreen = 'dashboard';
let isBalanceVisible = true;
let accessStatusUnsubscribe = null;
let currentScreenBeforeAyuda = 'dashboard';

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

function getDeviceId() {
    let deviceId = localStorage.getItem('nequi_device_id');
    if (!deviceId) {
        deviceId = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem('nequi_device_id', deviceId);
    }
    return deviceId;
}

function getServerTimestamp() {
    return typeof firebase !== 'undefined' && firebase.firestore
        ? firebase.firestore.FieldValue.serverTimestamp()
        : new Date().toISOString();
}

function getUserAccessRef(phoneNumber) {
    return dbFirestore.collection(ADMIN_ACCESS_COLLECTION).doc(normalizeColombianMobile(phoneNumber));
}

function isAccessBlocked(data) {
    return data && (data.is_blocked === true || data.status === 'blocked');
}

function getDBStorageKey(phoneNumber = getStoredAdminPhone()) {
    const phone = normalizeColombianMobile(phoneNumber);
    return phone ? `nequi_db_v2_${phone}` : 'nequi_db_v2';
}

function getDBVersionKey(phoneNumber = getStoredAdminPhone()) {
    const phone = normalizeColombianMobile(phoneNumber);
    return phone ? `nequi_db_version_${phone}` : 'nequi_db_version';
}

function resetRuntimeDB() {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_DB_STATE));
    Object.keys(db).forEach(key => delete db[key]);
    Object.assign(db, fresh);
}

function setAdminSession({ phoneNumber, uid, authEmail }) {
    const phone = normalizeColombianMobile(phoneNumber);
    localStorage.setItem('admin_access_granted', 'true');
    localStorage.setItem('admin_phone', phone);
    localStorage.setItem('admin_uid', uid || '');
    localStorage.setItem('admin_auth_email', authEmail || buildAuthEmailFromPhone(phone));
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
        console.warn('No se pudo leer el mapeo de celular antes del login:', error);
    }

    return fallbackEmail;
}

async function recordAccessHistory(phoneNumber, eventType, user) {
    if (!dbFirestore) return;

    try {
        await getUserAccessRef(phoneNumber).collection('access_history').add({
            eventType,
            phoneNumber: normalizeColombianMobile(phoneNumber),
            uid: user ? user.uid : localStorage.getItem('admin_uid') || null,
            deviceId: getDeviceId(),
            createdAt: getServerTimestamp()
        });
    } catch (error) {
        console.warn('No se pudo escribir historial de acceso:', error);
    }
}

async function ensureUserAccessDoc(phoneNumber, user, eventType, authEmail) {
    if (!dbFirestore || !user) return { data: { is_blocked: false, status: 'active' } };

    const phone = normalizeColombianMobile(phoneNumber);
    const ref = getUserAccessRef(phone);
    const snapshot = await ref.get();
    const currentData = snapshot.exists ? snapshot.data() : {};
    const timestamp = getServerTimestamp();
    const payload = {
        phoneNumber: phone,
        identifier: phone,
        uid: user.uid,
        authEmail: authEmail || currentData.authEmail || buildAuthEmailFromPhone(phone),
        loginProvider: 'phone-password',
        deviceId: getDeviceId(),
        historyPath: `${ADMIN_ACCESS_COLLECTION}/${phone}/access_history`,
        updatedAt: timestamp,
        lastLoginAt: timestamp
    };

    if (!snapshot.exists) {
        payload.is_blocked = false;
        payload.status = 'active';
        payload.createdAt = timestamp;
    } else {
        if (typeof currentData.is_blocked === 'undefined') payload.is_blocked = false;
        if (!currentData.status) payload.status = 'active';
    }

    await ref.set(payload, { merge: true });
    await recordAccessHistory(phone, eventType, user);

    const freshDoc = await ref.get();
    return { id: phone, data: freshDoc.exists ? freshDoc.data() : payload };
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
let firebaseApp, firebaseAuth, dbFirestore;
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
                console.warn('No se pudo fijar persistencia local de Auth:', error);
            });
        }
    }
} catch(e) {
    console.warn("Firebase no está configurado aún o hubo un error:", e);
}

// Access Control Logic
function checkAccessControl() {
    const isAdminGranted = localStorage.getItem('admin_access_granted') === 'true';
    const adminPhone = getStoredAdminPhone();
    
    if (!isAdminGranted || !isValidColombianMobile(adminPhone)) {
        // Primer lanzamiento: requiere login administrativo por celular
        history.replaceState({ screenId: 'admin-login' }, null, "");
        showScreen('admin-login', false);
    } else {
        // Ya está logueado localmente, verifica estado en silencio y muestra login normal
        history.replaceState({ screenId: 'login' }, null, "");
        showScreen('login', false);
        verifyStatusSilently(adminPhone);
    }
}

function verifyStatusSilently(phoneNumber) {
    const phone = normalizeColombianMobile(phoneNumber);
    if (!dbFirestore || !isValidColombianMobile(phone)) return;
    
    if (accessStatusUnsubscribe) accessStatusUnsubscribe();
    
    // Escucha el documento usando el celular como ID único para bloqueos individuales
    accessStatusUnsubscribe = getUserAccessRef(phone).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            if (isAccessBlocked(data)) {
                // Bloqueo individual detectado
                history.replaceState({ screenId: 'blocked' }, null, "");
                showScreen('blocked', false);
            } else if (currentScreen === 'blocked') {
                showScreen('login');
            }
        }
    }, (error) => {
        console.error("Error validando estado por celular:", error);
    });
}

async function completeAdminSession(phoneNumber, userCredential, accessDoc, authEmail) {
    const phone = normalizeColombianMobile(phoneNumber);
    setAdminSession({
        phoneNumber: phone,
        uid: userCredential.user.uid,
        authEmail
    });

    await loadDB(phone);
    db.user.phone = phone;
    saveDB(phone);
    updateUserData();
    verifyStatusSilently(phone);

    if (isAccessBlocked(accessDoc && accessDoc.data)) {
        history.replaceState({ screenId: 'blocked' }, null, "");
        showScreen('blocked', false);
    } else {
        history.replaceState({ screenId: 'login' }, null, "");
        showScreen('login', false);
    }
}

async function handleAdminAuth(mode) {
    const btnAdminLogin = document.getElementById('btn-admin-login');
    const btnAdminRegister = document.getElementById('btn-admin-register');
    const activeButton = mode === 'register' ? btnAdminRegister : btnAdminLogin;
    const phoneInput = document.getElementById('admin-phone');
    const passwordInput = document.getElementById('admin-password');
    const phone = normalizeColombianMobile(phoneInput ? phoneInput.value : '');
    const password = passwordInput ? passwordInput.value : '';

    if (!isValidColombianMobile(phone)) {
        showToast("Ingresa un celular colombiano válido de 10 dígitos.");
        return;
    }

    if (!password || password.length < 6) {
        showToast("La contraseña debe tener al menos 6 caracteres.");
        return;
    }

    if (!firebaseAuth) {
        showToast("Firebase no está configurado correctamente.");
        return;
    }

    const originalText = activeButton ? activeButton.innerText : '';
    if (btnAdminLogin) btnAdminLogin.disabled = true;
    if (btnAdminRegister) btnAdminRegister.disabled = true;
    if (activeButton) activeButton.innerText = mode === 'register' ? 'Creando...' : 'Verificando...';

    try {
        const authEmail = buildAuthEmailFromPhone(phone);
        let userCredential;

        if (mode === 'register') {
            // 1. Verificar si ya existe en Firebase Auth
            try {
                const methods = await firebaseAuth.fetchSignInMethodsForEmail(authEmail);
                if (methods && methods.length > 0) {
                    throw new Error("Ya existe una cuenta asociada a este celular. Usa 'Iniciar Sesión'.");
                }
            } catch (error) {
                if (error.message && error.message.includes('Ya existe una cuenta')) throw error;
                // fetchSignInMethodsForEmail puede fallar si el email es inválido, lo ignoramos
            }

            // 2. Verificar si ya existe documento en Firestore (dato auxiliar)
            if (dbFirestore) {
                try {
                    const existingDoc = await getUserAccessRef(phone).get();
                    if (existingDoc.exists) {
                        console.warn('Documento Firestore huérfano sin Auth para', phone);
                    }
                } catch (_) {}
            }

            userCredential = await firebaseAuth.createUserWithEmailAndPassword(authEmail, password);
        } else {
            userCredential = await firebaseAuth.signInWithEmailAndPassword(authEmail, password);
        }

        const accessDoc = await ensureUserAccessDoc(phone, userCredential.user, mode, authEmail);
        await completeAdminSession(phone, userCredential, accessDoc, authEmail);
    } catch (error) {
        const code = error && error.code;
        const message = code === 'auth/email-already-in-use'
            ? 'Ya existe una cuenta asociada a este celular. Usa "Iniciar Sesión" en vez de "Crear cuenta".'
            : code === 'auth/user-not-found'
                ? 'No existe una cuenta para este celular. Crea la cuenta primero.'
                : code === 'auth/wrong-password' || code === 'auth/invalid-credential'
                    ? 'Contraseña incorrecta. Vuelve a intentarlo o comunícate al WhatsApp 3214484092.'
                    : code === 'auth/too-many-requests'
                        ? 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentar.'
                        : code === 'auth/user-disabled'
                            ? 'Esta cuenta ha sido bloqueada. Comunícate al WhatsApp 3214484092.'
                            : code === 'auth/invalid-email'
                                ? 'El formato del correo no es válido.'
                                : code === 'auth/operation-not-allowed'
                                    ? 'El inicio de sesión no está habilitado. Contacta a soporte.'
                                    : (error.message || 'No se pudo completar la autenticación.');
        showToast(message, 'error');
    } finally {
        if (btnAdminLogin) btnAdminLogin.disabled = false;
        if (btnAdminRegister) btnAdminRegister.disabled = false;
        if (activeButton) activeButton.innerText = originalText;
    }
}

// Admin Login Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnAdminLogin = document.getElementById('btn-admin-login');
    if (btnAdminLogin) {
        btnAdminLogin.addEventListener('click', () => handleAdminAuth('login'));
    }

    const btnAdminRegister = document.getElementById('btn-admin-register');
    if (btnAdminRegister) {
        btnAdminRegister.addEventListener('click', () => handleAdminAuth('register'));
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

        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            regs.forEach(r => r.unregister());
        }

        console.log('🔥 LIMPIEZA TOTAL COMPLETA');
    } catch (e) {
        console.error('Error en clearAllStorage:', e);
    }
}

// Elements
const screens = document.querySelectorAll('.screen');
const fabOverlay = document.getElementById('fab-overlay');
const btnOpenFab = document.getElementById('btn-open-fab');
const servicesGrid = document.getElementById('services-grid');
const navItems = document.querySelectorAll('.bottom-nav .nav-item');

// Data Loading
async function initApp() {
    // Splash screen logic
    const splash = document.getElementById('splash-screen');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.display = 'none';
            }, 600); // Wait for fade out
        }, 3000); // 3.0s matching the inner loading dance
    }

    await loadDB(); // Load persisted data first (async — waits for cleanup in DEBUG_MODE)
    
    // Initial history state
    checkAccessControl();

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
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            if(confirm("¿Quieres cerrar sesión?")) {
                showScreen('login');
            }
        });
    }

    const btnNotifications = document.getElementById('btn-notifications');
    if (btnNotifications) {
        btnNotifications.addEventListener('click', () => {
            showScreen('notifications');
        });
    }

    const btnPockets = document.getElementById('btn-pockets');
    if (btnPockets) {
        btnPockets.addEventListener('click', () => {
            showScreen('pockets');
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
    document.getElementById('user-name').innerText = db.user.name;
    const realBalance = db.user.balance.toLocaleString('es-CO', { minimumFractionDigits: 2 });
    const formattedBalance = isBalanceVisible ? realBalance : '*****';
    
    if (document.getElementById('user-balance')) {
        document.getElementById('user-balance').innerText = formattedBalance;
    }

    if (document.getElementById('total-balance-dashboard')) {
        document.getElementById('total-balance-dashboard').innerText = formattedBalance;
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
            document.getElementById('login-phone').value = `${p.slice(0,3)} ${p.slice(3,6)} ${p.slice(6)}`;
        } else {
            document.getElementById('login-phone').value = p;
        }
    }

    // saveDB() removed from render — only persist on explicit user actions
}

function saveDB(phoneNumber = getStoredAdminPhone()) {
    localStorage.setItem(getDBStorageKey(phoneNumber), JSON.stringify(db));
    localStorage.setItem(getDBVersionKey(phoneNumber), DB_VERSION);
}

function validateMovements() {
    // ... (lógica existente) ...
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
        return; // No carga localStorage — usa defaults de db.js
    }

    try {
        // ✅ Verificación de versión — si cambió el código, resetea localStorage
        const storageKey = getDBStorageKey(phoneNumber);
        const versionKey = getDBVersionKey(phoneNumber);
        const storedVersion = localStorage.getItem(versionKey);
        if (storedVersion !== DB_VERSION) {
            console.log(`🔄 Versión de DB cambió (${storedVersion} → ${DB_VERSION}). Reseteando datos...`);
            localStorage.removeItem(storageKey);
            localStorage.setItem(versionKey, DB_VERSION);
            if (isValidColombianMobile(phoneNumber)) {
                db.user.phone = normalizeColombianMobile(phoneNumber);
                saveDB(phoneNumber);
            }
            updateUserData(); // Forzar actualización visual tras reset
            return; 
        }

        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Deep merge user data
            if (parsed.user) Object.assign(db.user, parsed.user);
            // Replace contacts if they exist in storage
            if (parsed.contacts) db.contacts = parsed.contacts;
            if (parsed.movements) db.movements = parsed.movements;
            
            // Limpieza de movimientos de hoy (según solicitud del usuario)
            const todayStart = new Date().setHours(0, 0, 0, 0);
            db.movements = db.movements.filter(m => m.timestamp < todayStart);
            
            validateMovements();
            seedDemoMovements();
        }
    } catch (e) {
        console.error('Error loading DB from localStorage', e);
        localStorage.removeItem(getDBStorageKey(phoneNumber));
        localStorage.removeItem(getDBVersionKey(phoneNumber));
    }
}

function renderServices() {
    if (!servicesGrid) return;
    servicesGrid.innerHTML = '';
    db.services.forEach(service => {
        const item = document.createElement('div');
        item.className = 'service-item';
        item.style.animation = 'fadeIn 0.5s ease-out forwards';
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => showServiceDetail(service.id));
        item.innerHTML = `
            <div class="service-logo">
                <img src="${service.image}" alt="${service.name}">
            </div>
            <div class="service-copy">
                <h3>${service.name}</h3>
                <p>Disponible para pagos y recargas</p>
            </div>
        `;
        servicesGrid.appendChild(item);
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
                <img src="sin_movimientos.png" alt="Sin movimientos" style="width: 180px; margin-bottom: 24px; max-width: 100%;">
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

        list.innerHTML += `
            <div class="mov-item" style="background: white; border-radius: 12px; margin-bottom: 10px; padding: 16px; box-shadow: 0 4px 10px -2px rgba(0,0,0,0.08);">
                <div class="mov-icon" style="background: white; color: ${amountColor}; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid ${amountColor};">
                    <i data-lucide="${iconName}" style="width: 18px; height: 18px;"></i>
                </div>
                <div class="mov-details" style="flex: 1; padding: 0 14px; display: flex; flex-direction: column; justify-content: center;">
                    <h4 style="font-size: 13px; font-weight: 700; color: var(--nequi-purple-dark); text-transform: uppercase;">${m.name}</h4>
                    <p style="font-size: 12px; color: #888; font-weight: 500;">${isPositive ? 'De' : 'Para'} ${m.phone || ''}</p>
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

    const darkStatusScreens = ['dashboard', 'login', 'pin', 'withdraw-code'];
    const color = darkStatusScreens.includes(screenId) ? '#200020' : '#F7F5FA';
    themeMeta.setAttribute('content', color);
}

function showScreen(screenId, pushToHistory = true) {
    const screenElement = document.getElementById(`screen-${screenId}`);
    if (!screenElement) return;

    screens.forEach(s => s.classList.remove('active'));
    screenElement.classList.add('active');
    currentScreen = screenId;
    fabOverlay.classList.remove('active');
    setStatusBarTheme(screenId);
    
    if (screenId === 'login' || screenId === 'admin-login' || screenId === 'blocked' || screenId === 'pin' || screenId === 'change-phone' || screenId === 'success' || screenId === 'confirm-send' || screenId === 'available-detail' || screenId === 'send' || screenId === 'withdraw-channel' || screenId === 'withdraw-source' || screenId === 'withdraw-code' || screenId === 'pide' || screenId === 'perfil' || screenId === 'tarjeta' || screenId === 'colchon' || screenId === 'bancolombia' || screenId === 'transfiya' || screenId === 'servicio-detalle' || screenId === 'prestamos' || screenId === 'bre-b' || screenId === 'negocios' || screenId === 'ayuda') {
        document.body.classList.add('hide-nav');
    } else {
        document.body.classList.remove('hide-nav');
    }

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
    
    // Logic for PIN screen
    if (screenId === 'pin') {
        closeModal();
        resetPinInput();
    }

    // History API Support
    if (pushToHistory) {
        history.pushState({ screenId }, null, "");
    }

    // Refresh Lucide icons for new screens
    lucide.createIcons();
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
const DEFAULT_PIN = '0424';
let enteredPin = '';
let failedAttempts = 0;
let pinErrorTimeout;
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
    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.remove('active');
            showScreen('dashboard');
        }, 3000);
    } else {
        showScreen('dashboard');
    }
}

function submitPin() {
    if (enteredPin === DEFAULT_PIN) {
        failedAttempts = 0;
        if (pinError) {
            pinError.classList.remove('active');
        }
        finishPinLogin();
        return;
    }

    failedAttempts++;
    const remaining = 3 - failedAttempts;
    
    if (remaining > 0) {
        showPinError(`¡Ups! esa no es tu clave, tranqui tienes ${remaining} intentos más`);
    } else {
        showPinError('Has superado el límite de intentos.');
        failedAttempts = 0; // reset for this demo
    }
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
            setTimeout(submitPin, 120);
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

// Funcionalidad de Compartir Voucher (Captura de imagen + Share Nativo)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-share-receipt');
    if (btn) {
        e.preventDefault();
        e.stopPropagation();

        const receiptCard = document.querySelector('.receipt-card');
        if (!receiptCard) return;

        showToast('Generando imagen del voucher...', 'info');

        html2canvas(receiptCard, {
            scale: 3,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#FFFFFF',
            logging: false,
        }).then((canvas) => {
            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob falló'));
                }, 'image/png');
            });
        }).then((blob) => {
            const file = new File([blob], 'voucher-nequi.png', { type: 'image/png' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({
                    title: 'Comprobante Nequi',
                    text: 'Aquí está mi comprobante de Nequi',
                    files: [file],
                }).catch(() => {});
            } else if (navigator.share) {
                navigator.share({
                    title: 'Comprobante Nequi',
                    text: 'Aquí está mi comprobante de Nequi',
                }).catch(() => {});
            } else {
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]).then(() => {
                    showToast('¡Imagen del voucher copiada al portapapeles!', 'success');
                }).catch(() => {
                    // Fallback texto
                    const name = document.getElementById('receipt-name').innerText;
                    const amount = document.getElementById('receipt-amount').innerText;
                    const date = document.getElementById('receipt-date').innerText;
                    const ref = document.getElementById('receipt-ref').innerText;
                    const shareText = `💸 Nequi: Envío Exitoso\n✅ Para: ${name}\n💰 Monto: ${amount}\n📅 Fecha: ${date}\n🆔 Ref: ${ref}`;
                    navigator.clipboard.writeText(shareText).then(() => {
                        showToast('¡Comprobante copiado al portapapeles!', 'success');
                    });
                });
            }
        }).catch(() => {
            // Fallback si html2canvas falla
            const name = document.getElementById('receipt-name').innerText;
            const amount = document.getElementById('receipt-amount').innerText;
            const date = document.getElementById('receipt-date').innerText;
            const ref = document.getElementById('receipt-ref').innerText;
            const shareText = `💸 Nequi: Envío Exitoso\n✅ Para: ${name}\n💰 Monto: ${amount}\n📅 Fecha: ${date}\n🆔 Ref: ${ref}`;
            if (navigator.share) {
                navigator.share({ title: 'Comprobante Nequi', text: shareText }).catch(() => {});
            } else {
                navigator.clipboard.writeText(shareText).then(() => {
                    showToast('¡Comprobante copiado al portapapeles!', 'success');
                });
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
        return `${phone.slice(0,3)} ${phone.slice(3,6)} ${phone.slice(6)}`;
    }
    return phone;
}

function generateReference() {
    const randomNum = Math.floor(10000000 + Math.random() * 90000000);
    return `M0${randomNum}`;
}

function renderRealReceiptQr(text) {
    const qrContainer = document.getElementById('receipt-random-qr');
    if (!qrContainer) return;

    // Usamos api.qrserver.com para generar un QR real sin librerías locales
    const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(text)}&color=200020`;
    qrContainer.innerHTML = `
        <img src="${apiUrl}" alt="QR Code" class="qr-main-img">
        <img src="logo_n.png" alt="N" class="qr-center-logo">
    `;
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

// Toggle password visibility (eye icon)
function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input || !icon) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    lucide.createIcons();
}

// WhatsApp Sharing (Placeholder for future update)
// Redesigned UI uses a share icon in the header.

// Send Options Menu
function showSendOptions() {
    document.getElementById('send-options-modal').classList.add('active');
    document.getElementById('fab-overlay').classList.remove('active'); // Close FAB menu
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
// document.addEventListener('click', (e) => {
//     const target = e.target.closest('.service-item');
//     if (target && !target.onclick && !target.getAttribute('onclick')) {
//         showConnectionError();
//     }
// });

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
    // Deduct balance (using a fixed amount for demo or full balance? User objective says "descontar saldo real")
    // Since amount selection isn't in this specific requested flow, we'll use a placeholder amount like 50,000
    // OR we could just register the "intent" of withdrawal. 
    // To satisfy "descontar saldo real", let's use a standard withdrawal amount or prompt? 
    // The user flow says selection -> origin -> splash -> code.
    // Let's assume a withdrawal of 50.000 for this demo purpose as it's common.
    const amount = 50000;
    
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
        phoneEl.innerText = p.length === 10 ? `${p.slice(0,3)} ${p.slice(3,6)} ${p.slice(6)}` : p;
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
    const keySelect = document.getElementById('breb-send-key');
    if (!list) return;
    const keys = db.breb?.keys || [];
    if (keys.length === 0) {
        list.innerHTML = '<p style="color:#888;font-size:14px;padding:10px 0;">No tienes llaves Bre-B</p>';
        if (keySelect) keySelect.innerHTML = '<option value="">Sin llaves</option>';
    } else {
        list.innerHTML = keys.map(k => `
            <div class="sheet-card" style="margin-bottom:8px;">
                <div class="card-icon"><i data-lucide="key"></i></div>
                <div class="card-text"><h4>${k}</h4><p>Llave Bre-B</p></div>
            </div>
        `).join('');
        if (keySelect) {
            keySelect.innerHTML = keys.map(k => `<option value="${k}">${k}</option>`).join('');
        }
        lucide.createIcons();
    }
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

// Admin password recovery
function showForgotAdminPassword() {
    document.getElementById('recovery-modal').classList.add('active');
}

function closeRecoveryModal() {
    document.getElementById('recovery-modal').classList.remove('active');
}

window.showForgotAdminPassword = showForgotAdminPassword;
window.closeRecoveryModal = closeRecoveryModal;

// Admin: cambiar propia contraseña (desde Perfil)
function showChangePassword() {
    document.getElementById('change-password-modal').classList.add('active');
    document.getElementById('new-password').value = '';
}

function closeChangePassword() {
    document.getElementById('change-password-modal').classList.remove('active');
}

async function saveNewPassword() {
    const newPass = document.getElementById('new-password').value;
    if (!newPass || newPass.length < 6) {
        showToast('La contraseña debe tener al menos 6 caracteres.');
        return;
    }

    if (!firebaseAuth || !firebaseAuth.currentUser) {
        showToast('No hay sesión activa. Inicia sesión primero.');
        return;
    }

    try {
        await firebaseAuth.currentUser.updatePassword(newPass);
        closeChangePassword();
        const toast = document.getElementById('success-toast');
        if (toast) { toast.innerText = 'Contraseña actualizada'; toast.classList.add('active'); setTimeout(() => toast.classList.remove('active'), 3000); }
    } catch (error) {
        const msg = error.code === 'auth/requires-recent-login'
            ? 'Por seguridad, cierra sesión y vuelve a iniciar para cambiar la contraseña.'
            : (error.message || 'Error al cambiar la contraseña');
        showToast(msg);
    }
}

window.showChangePassword = showChangePassword;
window.closeChangePassword = closeChangePassword;
window.saveNewPassword = saveNewPassword;

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
            qrContainer.innerHTML = `<img src="${apiUrl}" alt="QR" style="width:180px;height:180px;">`;
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
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
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
                <img src="notificaciones.png" alt="Sin notificaciones" style="width:180px;margin-bottom:24px;max-width:100%;">
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

window.showToast = showToast;
window.showComingSoon = showComingSoon;
window.togglePasswordVisibility = togglePasswordVisibility;
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

// Start
initApp();

// PWA Service Worker Registration — DISABLED during development
// clearAllStorage() in DEBUG_MODE handles unregistering any old SWs
// Re-enable with a network-first strategy for production
// if ('serviceWorker' in navigator) {
//     window.addEventListener('load', () => {
//         navigator.serviceWorker.register('sw.js');
//     });
// }
