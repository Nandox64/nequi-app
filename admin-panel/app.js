const DEBUG_MODE = false;

// === Firebase Config (misma app) ===
const firebaseConfig = {
    apiKey: "AIzaSyCeP4cdfmm2fNroihv18oVBFevScIrfAZ0",
    authDomain: "nequi-col.firebaseapp.com",
    projectId: "nequi-col",
    storageBucket: "nequi-col.firebasestorage.app",
    messagingSenderId: "14367352191",
    appId: "1:14367352191:web:3e695db9beec64353be64a"
};

let auth = null;
let db = null;
let unsubscribeUsers = null;
let unsubscribeUserData = null;

try {
    if (typeof firebase === 'undefined') {
        document.getElementById('login-error').textContent = 'Firebase SDK no cargó. Revisa tu conexión.';
    } else {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        document.getElementById('login-error').textContent = '✓ Firebase OK';
        document.getElementById('login-error').style.color = '#2E7D32';
        setTimeout(() => {
            const el = document.getElementById('login-error');
            if (el) { el.textContent = ''; el.style.color = ''; }
        }, 2000);
    }
} catch (e) {
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.textContent = 'Error al inicializar: ' + e.message;
}

const USERS_COLLECTION = 'users_access';
const USER_DATA_COLLECTION = 'users_data';
const HISTORY_SUB = 'access_history';

// Notification server config
const NOTIFY_SERVER_URL = localStorage.getItem('notify_server_url') || 'http://localhost:4001';

// === Auth State ===
if (auth) {
    auth.onAuthStateChanged(user => {
        DEBUG_MODE && console.debug('onAuthStateChanged called, user:', user ? user.email : null);
        updateAuthDebug(user);
        if (user) {
            DEBUG_MODE && console.debug('Showing dashboard...');
            showScreen('dashboard');
            DEBUG_MODE && console.debug('Loading users...');
            loadUsers();
        } else {
            DEBUG_MODE && console.debug('No user, showing login screen');
            if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
            if (unsubscribeUserData) { unsubscribeUserData(); unsubscribeUserData = null; }
            showScreen('login');
        }
    });
}

function updateAuthDebug(user) {
    let el = document.getElementById('auth-debug');
    if (!el) {
        el = document.createElement('div');
        el.id = 'auth-debug';
        el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#333;color:#fff;font:12px monospace;padding:4px 8px;z-index:9999;text-align:center';
        document.body.appendChild(el);
    }
    if (user) {
        el.textContent = '✓ Autenticado: ' + user.email;
        el.style.background = '#2E7D32';
    } else {
        el.textContent = '○ No autenticado';
        el.style.background = '#666';
    }
}

// === Login ===
window.handleLogin = async function () {
    const email = document.getElementById('admin-email');
    const password = document.getElementById('admin-password');
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');

    if (!email || !password || !errorEl || !btn) {
        alert('Error interno: elementos del formulario no encontrados.');
        return;
    }

    const emailVal = email.value.trim();
    const passVal = password.value;

    errorEl.textContent = '';
    if (!emailVal || !passVal) {
        errorEl.textContent = 'Ingresa email y contraseña.';
        return;
    }

    if (!auth) {
        errorEl.textContent = 'Firebase no inicializado. Recarga la página.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Ingresando...';
    DEBUG_MODE && console.debug('Attempting Firebase sign in...');
    try {
        await auth.signInWithEmailAndPassword(emailVal, passVal);
        DEBUG_MODE && console.debug('Sign in succeeded!');
    } catch (e) {
        DEBUG_MODE && console.debug('Sign in failed:', e.code, e.message);
        if (e.code === 'auth/user-not-found') {
            errorEl.textContent = 'Credenciales inválidas.';
        } else if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
            errorEl.textContent = 'Credenciales inválidas.';
        } else if (e.code === 'auth/too-many-requests') {
            errorEl.textContent = 'Demasiados intentos. Intenta más tarde.';
        } else {
            errorEl.textContent = 'Error: ' + (e.message || 'Error de conexión.');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
    }
};

// Enter key on password field
document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('screen-login').classList.contains('active')) {
        window.handleLogin();
    }
});

// === Screen Management ===
function showScreen(screenId) {
    DEBUG_MODE && console.debug('showScreen:', screenId);
    const target = document.getElementById(`screen-${screenId}`);
    DEBUG_MODE && console.debug('target element:', target);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (target) {
        target.classList.add('active');
        DEBUG_MODE && console.debug('Screen', screenId, 'activated');
    } else {
        console.error('Screen element not found: screen-' + screenId);
    }
}

// === Logout ===
window.logout = function () {
    if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
    if (unsubscribeUserData) { unsubscribeUserData(); unsubscribeUserData = null; }
    auth.signOut();
};

// === Load Users ===
async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    DEBUG_MODE && console.debug('loadUsers called');
    if (!db) {
        console.error('db is null');
        tbody.innerHTML = '<tr><td colspan="9" class="loading">Firestore no disponible</td></tr>';
        return;
    }
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Cargando...</td></tr>';

    if (unsubscribeUsers) unsubscribeUsers();
    if (unsubscribeUserData) { unsubscribeUserData(); unsubscribeUserData = null; }

    // Also listen to users_data for balances
    let userDataMap = {};
    let lastSnapshot = null;
    unsubscribeUserData = db.collection(USER_DATA_COLLECTION).onSnapshot(ds => {
        userDataMap = {};
        ds.forEach(d => { userDataMap[d.id] = d.data(); });
        if (lastSnapshot) renderUsersTable(lastSnapshot);
    }, e => console.warn('users_data snapshot error:', e));

    function renderUsersTable(snapshot) {
        const count = snapshot.size;
        document.getElementById('user-count').textContent = count;

        if (count === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading">Sin usuarios registrados</td></tr>';
            return;
        }

        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const phone = doc.id;
            const deviceName = (data.deviceName && data.deviceName !== data.displayName ? data.deviceName : null) || (data.boundDeviceId ? `dev_${data.boundDeviceId.slice(4, 12)}...` : '—');
            const status = data.status || 'pending';
            const isBlocked = data.is_blocked;
            const blockCount = data.blockCount || 0;
            const lastLogin = data.lastLoginAt
                ? formatDate(data.lastLoginAt.toDate ? data.lastLoginAt.toDate() : new Date(data.lastLoginAt))
                : '—';

            const ud = userDataMap[phone] || {};
            const displayName = ud.name || data.displayName || '—';
            const balance = typeof ud.balance === 'number' ? '$ ' + ud.balance.toLocaleString('es-CO') : '—';

            const statusLabel = { pending: 'Pendiente', active: 'Activo', suspended: 'Suspendido' }[status] || status;
            const checked = isBlocked === true ? 'checked' : '';

            html += `<tr>
                <td><strong>${phone}</strong></td>
                <td>${escHtml(displayName)}</td>
                <td>${balance}</td>
                <td>${escHtml(deviceName)}</td>
                <td><span class="status-badge status-${status}">${statusLabel}</span></td>
                <td>
                    <label class="toggle">
                        <input type="checkbox" ${checked} data-phone="${phone}" onchange="toggleBlock(this)">
                        <span class="slider"></span>
                    </label>
                </td>
                <td>${blockCount}</td>
                <td>${lastLogin}</td>
                <td class="actions-cell">
                    <button class="btn-sm btn-info" onclick="showHistory('${phone}')">Historial</button>
                    <button class="btn-sm btn-warning" onclick="showUserData('${phone}')">Datos</button>
                    <button class="btn-sm btn-warning" onclick="clearDevice('${phone}')">Limpiar device</button>
                    <button class="btn-sm btn-danger" onclick="deleteUser('${phone}')">Eliminar</button>
                </td>
            </tr>`;
        });
        tbody.innerHTML = html;
    }

    try {
        unsubscribeUsers = db.collection(USERS_COLLECTION)
            .orderBy('createdAt', 'desc')
            .onSnapshot(snapshot => {
                DEBUG_MODE && console.debug('Snapshot received, size:', snapshot.size);
                lastSnapshot = snapshot;
                renderUsersTable(snapshot);
            }, error => {
                console.error('Snapshot error:', error);
                tbody.innerHTML = `<tr><td colspan="9" class="loading">Error al cargar: ${error.message}</td></tr>`;
            });
        DEBUG_MODE && console.debug('onSnapshot setup complete');
    } catch (e) {
        console.error('loadUsers error:', e);
        tbody.innerHTML = `<tr><td colspan="9" class="loading">Error: ${e.message}</td></tr>`;
    }
}

// === Toggle Block ===
window.toggleBlock = async function (checkbox) {
    const phone = checkbox.dataset.phone;
    const isBlocked = checkbox.checked;

    try {
        const updates = {
            is_blocked: isBlocked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (!isBlocked) updates.status = 'active';
        await db.collection(USERS_COLLECTION).doc(phone).update(updates);
        showToast(isBlocked ? 'Cuenta bloqueada' : 'Cuenta desbloqueada', 'success');
    } catch (e) {
        showToast('Error al actualizar: ' + e.message, 'error');
        checkbox.checked = !isBlocked;
    }
};

// === Clear Device ===
window.clearDevice = async function (phone) {
    if (!confirm(`¿Limpiar dispositivo vinculado de ${phone}?\nEl usuario podrá iniciar desde cualquier equipo.`)) return;

    try {
        await db.collection(USERS_COLLECTION).doc(phone).update({
            boundDeviceId: firebase.firestore.FieldValue.delete(),
            deviceName: firebase.firestore.FieldValue.delete(),
            is_blocked: false,
            status: 'active',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Dispositivo liberado para ' + phone, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
};

// === Delete User ===
window.deleteUser = async function (phone) {
    if (!confirm(`¿Eliminar completamente al usuario ${phone}?\nSe borrarán todos sus datos (acceso, datos de usuario). Esta acción no se puede deshacer.`)) return;

    try {
        await db.collection(USER_DATA_COLLECTION).doc(phone).delete();
        await db.collection(USERS_COLLECTION).doc(phone).delete();
        showToast('Usuario ' + phone + ' eliminado', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
};

// === Show History ===
window.showHistory = async function (phone) {
    const modal = document.getElementById('history-modal');
    const title = document.getElementById('history-title');
    const body = document.getElementById('history-body');

    modal.classList.add('active');
    title.textContent = `Historial — ${phone}`;
    body.innerHTML = '<p class="loading">Cargando...</p>';

    try {
        const snap = await db.collection(USERS_COLLECTION).doc(phone)
            .collection(HISTORY_SUB)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        if (snap.empty) {
            body.innerHTML = '<p class="loading">Sin historial de accesos.</p>';
            return;
        }

        let html = '';
        snap.forEach(doc => {
            const d = doc.data();
            const event = d.eventType || d.event || d.type || 'login';
            const ts = d.createdAt
                ? formatDate(d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt))
                : '—';
            const device = d.deviceId ? d.deviceId.slice(0, 8) + '...' : '';
            html += `<div class="history-item">
                <span class="history-event">${escHtml(event)}</span>
                <span class="history-date">${ts} ${device ? '· ' + device : ''}</span>
            </div>`;
        });
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p class="loading">Error: ${e.message}</p>`;
    }
};

window.closeHistory = function () {
    document.getElementById('history-modal').classList.remove('active');
};

// === Show User Data ===
window.showUserData = async function (phone) {
    const modal = document.getElementById('userdata-modal');
    const title = document.getElementById('userdata-title');
    const body = document.getElementById('userdata-body');

    modal.classList.add('active');
    title.textContent = `Datos — ${phone}`;
    body.innerHTML = '<p class="loading">Cargando...</p>';

    try {
        const snap = await db.collection(USER_DATA_COLLECTION).doc(phone).get();
        if (!snap.exists) {
            body.innerHTML = '<p class="loading">Sin datos de usuario.</p>';
            return;
        }

        const data = snap.data();
        const balance = typeof data.balance === 'number'
            ? '$ ' + data.balance.toLocaleString('es-CO', { minimumFractionDigits: 2 })
            : '$ 0,00';
        const name = data.name || '—';
        const movements = data.movements || [];
        const contacts = data.contacts || [];

        let html = `
            <div class="data-summary">
                <div class="data-field"><strong>Nombre:</strong> ${escHtml(name)}</div>
                <div class="data-field"><strong>Saldo:</strong> ${balance}</div>
                <div class="data-field"><strong>Contactos:</strong> ${contacts.length}</div>
                <div class="data-field"><strong>Movimientos:</strong> ${movements.length}</div>
            </div>
            <h4 style="margin:20px 0 10px;color:var(--nequi-purple-dark);">Últimos movimientos</h4>
            <div class="movements-list">`;

        if (movements.length === 0) {
            html += '<p class="loading">Sin movimientos.</p>';
        } else {
            movements.slice(-20).reverse().forEach(m => {
                const typeLabel = { send: 'Enviado', receive: 'Recibido', withdraw: 'Retiro', recharge: 'Recarga', colchon_add: 'Colchón +', colchon_withdraw: 'Colchón -' }[m.type] || m.type;
                const amount = typeof m.amount === 'number'
                    ? '$ ' + m.amount.toLocaleString('es-CO', { minimumFractionDigits: 2 })
                    : '—';
                html += `<div class="movement-item">
                    <span class="movement-type">${escHtml(typeLabel)}</span>
                    <span class="movement-name">${escHtml(m.name || '')}</span>
                    <span class="movement-amount">${amount}</span>
                    <span class="movement-date">${escHtml(m.date || '')}</span>
                </div>`;
            });
        }

        html += `</div>
            <h4 style="margin:20px 0 10px;color:var(--nequi-purple-dark);">Contactos</h4>
            <div class="contacts-list">`;

        if (contacts.length === 0) {
            html += '<p class="loading">Sin contactos.</p>';
        } else {
            contacts.forEach(c => {
                html += `<div class="contact-item">
                    <span class="contact-name">${escHtml(c.name || '')}</span>
                    <span class="contact-phone">${escHtml(c.phone || '')}</span>
                </div>`;
            });
        }

        html += '</div>';
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p class="loading">Error: ${e.message}</p>`;
    }
};

window.closeUserData = function () {
    document.getElementById('userdata-modal').classList.remove('active');
};

// === Toast ===
function showToast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 3000);
}

// === Helpers ===
function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-CO', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// === Notification Modal ===
let notifyServerUrl = NOTIFY_SERVER_URL;

window.showNotifyModal = function () {
    document.getElementById('notify-modal').classList.add('active');
    document.getElementById('notify-result').textContent = '';
    document.getElementById('notify-title').value = '';
    document.getElementById('notify-message').value = '';
    document.getElementById('notify-phone').value = '';
    document.getElementById('btn-send-notify').disabled = false;
    document.getElementById('btn-send-notify').textContent = 'Enviar notificación';
    toggleNotifyPhone();
};

window.closeNotifyModal = function () {
    document.getElementById('notify-modal').classList.remove('active');
};

window.toggleNotifyPhone = function () {
    const target = document.getElementById('notify-target').value;
    document.getElementById('notify-phone-group').style.display = target === 'specific' ? 'block' : 'none';
};

window.sendNotification = async function () {
    const target = document.getElementById('notify-target').value;
    const phone = document.getElementById('notify-phone').value.trim();
    const title = document.getElementById('notify-title').value.trim();
    const message = document.getElementById('notify-message').value.trim();
    const resultEl = document.getElementById('notify-result');
    const btn = document.getElementById('btn-send-notify');

    if (!title || !message) {
        resultEl.textContent = 'Completa título y mensaje';
        return;
    }

    if (target === 'specific' && !phone) {
        resultEl.textContent = 'Ingresa el teléfono del usuario';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando...';
    resultEl.textContent = '';

    try {
        if (!auth || !auth.currentUser) {
            resultEl.textContent = 'No hay sesión activa. Inicia sesión nuevamente.';
            btn.disabled = false;
            btn.textContent = 'Enviar notificación';
            return;
        }
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch(`${notifyServerUrl}/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, target, phone, title, message })
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Error del servidor');
        }

        if (data.sentCount > 0) {
            showToast(`✅ Notificación enviada a ${data.sentCount} dispositivo(s)`, 'success');
        } else {
            showToast('⚠️ No hay dispositivos registrados para ese destino', 'error');
        }
        closeNotifyModal();
    } catch (e) {
        resultEl.textContent = 'Error: ' + e.message + '. ¿El servidor de notificaciones está corriendo? (npm run notify)';
        btn.disabled = false;
        btn.textContent = 'Reintentar';
    }
};
