const db = {
  "user": {
    "name": "",
    "phone": "",
    "balance": 0
  },
  "contacts": [
    { "name": "Roberto Carlos", "phone": "3001234567" }
  ],
  "movements": [
    { "type": "receive", "name": "Roberto Carlos", "phone": "3001234567", "amount": 50000, "date": "Hoy, 10:30", "timestamp": Date.now() - 3600000, "reference": "NEQ-001", "status": "completed" },
    { "type": "send", "name": "Claro", "phone": "Pago factura", "amount": 35000, "date": "Ayer", "timestamp": Date.now() - 86400000, "reference": "NEQ-002", "status": "completed" },
    { "type": "recharge", "name": "Recarga Exitosa", "phone": "Nequi", "amount": 20000, "date": "Mar 10", "timestamp": Date.now() - 172800000, "reference": "NEQ-003", "status": "completed" },
    { "type": "send", "name": "María García", "phone": "3007654321", "amount": 25000, "date": "Mar 8", "timestamp": Date.now() - 345600000, "reference": "NEQ-004", "status": "completed" }
  ],
  "services": [
    { "id": "claro", "name": "Claro", "image": "img/logo_claro_2.png" },
    { "id": "tigo", "name": "Tigo", "image": "img/logo_tigo.png" },
    { "id": "wom", "name": "WOM", "image": "img/logo_wom.png" },
    { "id": "tullave", "name": "Maas tullave", "image": "img/logo_tullave.png" },
    { "id": "transfiya", "name": "Transfiya", "image": "img/logo_transfiya.png" },
    { "id": "breb", "name": "Bre-B", "image": "img/logo_bre-b.png" }
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
