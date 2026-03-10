// ── Firebase Messaging Service Worker ──────────────────────────
// Este archivo DEBE estar en la raíz del proyecto (carpeta public/)

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyCsmzGN3-0K1kW9G1TLaApz-U",
  authDomain:        "romulo-fc.firebaseapp.com",
  projectId:         "romulo-fc",
  storageBucket:     "romulo-fc.firebasestorage.app",
  messagingSenderId: "849856996590",
  appId:             "1:849856996590:web:39b3900e7715",
  measurementId:     "G-WSM1G7GNN3"
});

const messaging = firebase.messaging();

// Notificaciones cuando la app está en SEGUNDO PLANO o CERRADA
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || "Rómulo FC", {
    body:  body  || "",
    icon:  icon  || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [200, 100, 200],
    data: payload.data || {}
  });
});
