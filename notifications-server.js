const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

// --- Firebase Admin SDK ---
const serviceAccountPath = path.join(__dirname, 'service-account-key.json');

let serviceAccount;
try {
    serviceAccount = require(serviceAccountPath);
} catch (e) {
    console.error('No se encontró service-account-key.json');
    console.error('Descárgalo desde Firebase Console → Project Settings → Service Accounts');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'nequi-col'
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware: verify Firebase Auth ID token
async function verifyAdminToken(req, res, next) {
    try {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(401).json({ error: 'Token de autenticación requerido' });
        }
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.adminUser = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

// Send notification
app.post('/send-notification', verifyAdminToken, async (req, res) => {
    try {
        const { target, phone, title, message } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'title y message son requeridos' });
        }

        if (target === 'specific' && !phone) {
            return res.status(400).json({ error: 'phone es requerido para target specific' });
        }

        let tokens = [];

        if (target === 'all') {
            const snapshot = await db.collection('users_access').get();
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.fcmTokens && Array.isArray(data.fcmTokens)) {
                    tokens.push(...data.fcmTokens);
                }
            });
        } else if (target === 'specific') {
            const normalizedPhone = phone.replace(/\s+/g, '');
            const doc = await db.collection('users_access').doc(normalizedPhone).get();
            if (doc.exists) {
                const data = doc.data();
                if (data.fcmTokens && Array.isArray(data.fcmTokens)) {
                    tokens.push(...data.fcmTokens);
                }
            }
        } else {
            return res.status(400).json({ error: 'target debe ser "all" o "specific"' });
        }

        if (tokens.length === 0) {
            return res.json({ success: true, sentCount: 0, message: 'No hay tokens registrados' });
        }

        const messagePayload = {
            notification: { title, body: message },
            data: { clickAction: '/' }
        };

        let response;
        if (tokens.length === 1) {
            response = await admin.messaging().send({
                token: tokens[0],
                ...messagePayload
            });
            console.log(`Notificación enviada a 1 dispositivo: ${response}`);
            return res.json({ success: true, sentCount: 1 });
        } else {
            response = await admin.messaging().sendEachForMulticast({
                tokens,
                ...messagePayload
            });
            const successCount = response.successCount;
            const failureCount = response.failureCount;
            console.log(`Notificaciones: ${successCount} enviadas, ${failureCount} fallaron`);

            // Clean up invalid tokens
            if (failureCount > 0) {
                response.responses.forEach(async (resp, idx) => {
                    if (resp.error && (resp.error.code === 'messaging/invalid-registration-token' ||
                        resp.error.code === 'messaging/registration-token-not-registered')) {
                        const invalidToken = tokens[idx];
                        // Find user doc containing this token
                        const snapshot = await db.collection('users_access')
                            .where('fcmTokens', 'array-contains', invalidToken)
                            .get();
                        if (!snapshot.empty) {
                            snapshot.forEach(doc => {
                                const data = doc.data();
                                const updatedTokens = (data.fcmTokens || []).filter(t => t !== invalidToken);
                                doc.ref.update({ fcmTokens: updatedTokens });
                                console.log(`Token inválido removido de ${doc.id}`);
                            });
                        } else {
                            console.log(`Token inválido no encontrado en Firestore (índice ${idx})`);
                        }
                    }
                });
            }

            return res.json({ success: true, sentCount: successCount, failedCount: failureCount });
        }
    } catch (e) {
        console.error('Error sending notification:', e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor de notificaciones corriendo en puerto ${PORT}`);
    console.log(`   Endpoint: POST http://localhost:${PORT}/send-notification`);
    console.log(`   Health:   GET  http://localhost:${PORT}/health`);
});
