
importScripts("https://www.gstatic.com/firebasejs/12.4.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.4.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD9i4wqwmmhGCto_RluvX1QVqs376Wg9zc",
  authDomain: "le-mie-consegne.firebaseapp.com",
  projectId: "le-mie-consegne",
  storageBucket: "le-mie-consegne.firebasestorage.app",
  messagingSenderId: "290180690792",
  appId: "1:290180690792:web:a192301b5a701155f4dcdd"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;

  self.registration.showNotification(
    payload.data?.title || "Le mie consegne",
    {
      body: payload.data?.body || "Hai un promemoria per una consegna.",
      icon: "./icon-192.png",
      data: {
        url: "./"
      }
    }
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(
      event.notification.data?.url || "./"
    )
  );
});
