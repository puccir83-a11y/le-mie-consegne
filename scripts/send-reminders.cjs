
const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'le-mie-consegne'
});

const db = admin.firestore();
const zone = 'Europe/Rome';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short'
}).formatToParts(new Date());

const get = k => parts.find(p => p.type === k).value;

const nowDate =
  `${get('year')}-${get('month')}-${get('day')}`;

const minutes =
  Number(get('hour')) * 60 + Number(get('minute'));

const weekdays = [
  'Sun', 'Mon', 'Tue', 'Wed',
  'Thu', 'Fri', 'Sat'
];

const deliveryDay =
  (weekdays.indexOf(get('weekday')) + 1) % 7;

const dayNames = [
  'domenica', 'lunedì', 'martedì',
  'mercoledì', 'giovedì',
  'venerdì', 'sabato'
];

function eligible(c) {
  if (
    c.season === 'yes' &&
    c.reopen &&
    c.reopen > nowDate
  ) return false;

  if (
    !Array.isArray(c.days) ||
    !c.days.map(Number).includes(deliveryDay)
  ) return false;

  const time =
    /^([01]\d|2[0-3]):[0-5]\d$/.test(c.sendTime || '')
      ? c.sendTime
      : '10:00';

  const [h, m] = time.split(':').map(Number);

  return minutes >= h * 60 + m;
}

async function sendReminder(userRef, customer, devices) {
  const c = customer.data();

  const key =
    `${nowDate}_${customer.id}_${deliveryDay}`;

  const receiptRef = userRef
    .collection('notificationReceipts')
    .doc(key);

  const title = 'Promemoria consegna';

  const body =
    `${c.name || 'Cliente'}: consegna ` +
    `${dayNames[deliveryDay]}` +
    `${c.city ? ' a ' + c.city : ''}.`;

  for (const device of devices.docs) {
    const token = device.get('token');

    if (!token) continue;

    const deliveryRef = receiptRef
      .collection('deliveries')
      .doc(device.id);

    const attemptId = `${Date.now()}-${Math.random()}`;

    let acquired = false;

    await db.runTransaction(async tx => {
      const snapshot = await tx.get(deliveryRef);
      const state = snapshot.exists ? snapshot.data() : {};

      if (state.status === 'sent') return;

      if (
        state.status === 'sending' &&
        state.lockUntil &&
        state.lockUntil > Date.now()
      ) return;

      tx.set(deliveryRef, {
        status: 'sending',
        attemptId,
        lockUntil: Date.now() + 5 * 60 * 1000,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      acquired = true;
    });

    if (!acquired) continue;

    try {
      await admin.messaging().send({
        token,
        data: {
          title,
          body,
          url: 'https://puccir83-a11y.github.io/le-mie-consegne/'
        },
        webpush: {
          headers: {
            TTL: '86400'
          }
        }
      });

      await deliveryRef.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        lockUntil: 0,
        error: admin.firestore.FieldValue.delete()
      });

      console.log(
        `Notifica inviata: ${customer.id} / ${device.id}`
      );

    } catch (e) {
      const code = String(e.code || '');
      const permanent = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token'
      ].includes(code);

      await deliveryRef.update({
        status: permanent ? 'invalid-token' : 'failed',
        error: String(e.message || e),
        lockUntil: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.error(
        `Invio non riuscito: ${customer.id} / ${device.id}`,
        e.message
      );
    }
  }
}

async function main() {
  const users = await db.collection('users').get();

  for (const user of users.docs) {
    const devices = await user.ref
      .collection('devices')
      .get();

    if (devices.empty) continue;

    const customers = await user.ref
      .collection('clients')
      .get();

    for (const customer of customers.docs) {
      if (!eligible(customer.data())) continue;

      await sendReminder(
        user.ref,
        customer,
        devices
      );
    }
  }

  console.log('Controllo promemoria completato.');
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
