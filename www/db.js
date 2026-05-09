const db = {
  "user": {
    "name": "Usuario",
    "phone": "3003332211",
    "balance": 1240000.40
  },
  "contacts": [
    { "name": "Roberto Carlos", "phone": "3001234567" },
    { "name": "Alejandra Arteaga", "phone": "3006646271" },
    { "name": "Paula del Castillo", "phone": "3223334455" },
    { "name": "Carmen Padilla", "phone": "3213212121" }
  ],
  "movements": [],
  "services": [
    { "id": "claro", "name": "Claro", "image": "logo_claro.png" },
    { "id": "tigo", "name": "Tigo", "image": "logo_tigo.png" },
    { "id": "wom", "name": "WOM", "image": "logo_wom.png" },
    { "id": "tullave", "name": "Maas tullave", "image": "logo_tullave.png" },
    { "id": "transfiya", "name": "Transfiya", "image": "logo_transfiya.png" },
    { "id": "breb", "name": "Bre-B", "image": "logo_bre-b.png" }
  ],
  "notifications": [
    { "id": 1, "type": "recibida", "title": "Recibiste dinero", "message": "Has recibido $50.000 de Roberto Carlos", "time": "Hace 2 horas", "read": false },
    { "id": 2, "type": "recibida", "title": "Pago exitoso", "message": "Tu pago a Claro por $35.000 fue exitoso", "time": "Hace 1 día", "read": true },
    { "id": 3, "type": "recibida", "title": "Bolsillo creado", "message": "Tu Bolsillo 'Ahorro' se creó correctamente", "time": "Hace 3 días", "read": true },
    { "id": 4, "type": "espera", "title": "Solicitud de pago", "message": "Juan Pérez te solicita $25.000", "time": "Hace 30 min", "read": false }
  ],
  "pockets": [],
  "colchon": { "balance": 250000 },
  "tarjeta": { "status": "active", "number": "**** **** **** 8942", "franchise": "Visa", "balance": 500000, "digital": true },
  "loans": { "available": 5000000, "active": [] },
  "breb": { "keys": ["3003332211@breb"] },
  "tarjetaRequests": []
};
