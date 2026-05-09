// Script para cambiar contraseña de cualquier usuario Nequi
// Uso: node reset-password.js 3016646271
// El script busca el email 3016646271@phone.nequi.co en Firebase Auth y actualiza su contraseña

const admin = require('firebase-admin');
const path = require('path');
const readline = require('readline');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account-key.json');

function askPassword() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        const stdin = process.stdin;
        const stdout = process.stdout;

        rl.question('Nueva contraseña: ', (pw) => {
            if (pw.length < 6) {
                console.log('ERROR: La contraseña debe tener al menos 6 caracteres.');
                rl.close();
                resolve(null);
                return;
            }

            rl.question('Confirmar contraseña: ', (confirm) => {
                rl.close();
                if (pw !== confirm) {
                    console.log('ERROR: Las contraseñas no coinciden.');
                    resolve(null);
                } else {
                    resolve(pw);
                }
            });
        });
    });
}

async function main() {
    const phone = process.argv[2];

    if (!phone) {
        console.log('Uso: node reset-password.js TELEFONO');
        console.log('Ejemplo: node reset-password.js 3016646271');
        process.exit(1);
    }

    const newPassword = await askPassword();
    if (!newPassword) process.exit(1);

    const email = `${phone.replace(/\D/g, '')}@phone.nequi.co`;

    try {
        const serviceAccount = require(SERVICE_ACCOUNT_PATH);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
        console.log('ERROR: No se pudo cargar el archivo de servicio.');
        console.log('1. Ve a https://console.firebase.google.com/project/nequi-col/settings/serviceaccounts/adminsdk');
        console.log('2. Haz clic en "Generar nueva clave privada"');
        console.log('3. Guarda el archivo como "service-account-key.json" en la misma carpeta que este script\n');
        console.log('Detalles:', e.message);
        process.exit(1);
    }

    try {
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(user.uid, { password: newPassword });
        console.log(`CONTRASEÑA CAMBIADA con éxito para ${email}`);
        console.log('Ahora puedes iniciar sesión en la app con ese celular y la nueva contraseña.');
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            console.log(`ERROR: No existe un usuario con el email ${email}`);
        } else {
            console.log('ERROR:', e.message);
        }
    }

    admin.app().delete();
}

main();
