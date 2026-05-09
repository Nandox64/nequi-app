// Script para cambiar contraseña de cualquier usuario Nequi
// Uso: node reset-password.js 3016646271 nuevaClave123
// El script busca el email 3016646271@phone.nequi.co en Firebase Auth y actualiza su contraseña

const admin = require('firebase-admin');
const path = require('path');

// === PASO 1: Configura la ruta a tu archivo JSON de servicio ===
// Descárgalo desde: Firebase Console > Configuración del proyecto > Cuentas de servicio > SDK de Firebase Admin > Generar nueva clave privada
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account-key.json');

const phone = process.argv[2];
const newPassword = process.argv[3];

if (!phone || !newPassword) {
    console.log('Uso: node reset-password.js TELEFONO NUEVA_CONTRASENA');
    console.log('Ejemplo: node reset-password.js 3016646271 MiNuevaClave2024');
    process.exit(1);
}

if (newPassword.length < 6) {
    console.log('ERROR: La contraseña debe tener al menos 6 caracteres.');
    process.exit(1);
}

const email = `${phone.replace(/\D/g, '')}@phone.nequi.co`;

async function resetPassword() {
    try {
        const serviceAccount = require(SERVICE_ACCOUNT_PATH);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
        console.log('ERROR: No se pudo cargar el archivo de servicio.');
        console.log('1. Ve a https://console.firebase.google.com/project/nequi-col/settings/serviceaccounts/adminsdk');
        console.log('2. Haz clic en "Generar nueva clave privada"');
        console.log('3. Guarda el archivo como "service-account-key.json" en la misma carpeta que este script');
        console.log('4. Vuelve a ejecutar este comando\n');
        console.log('Detalles del error:', e.message);
        process.exit(1);
    }

    try {
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(user.uid, { password: newPassword });
        console.log(`CONTRASEÑA CAMBIADA con éxito para ${email}`);
        console.log(`Nueva contraseña: ${newPassword}`);
        console.log('');
        console.log('Ahora puedes iniciar sesión en la app con ese celular y la nueva contraseña.');
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            console.log(`ERROR: No existe un usuario con el email ${email}`);
            console.log('Verifica que el número de celular sea correcto y que el usuario ya esté registrado.');
        } else {
            console.log('ERROR:', e.message);
        }
    }

    admin.app().delete();
}

resetPassword();
