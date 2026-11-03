
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

const nowDate = `${get('year')}-${get('month')}-${get('day')}`;
const minutes = Number(get('hour')) * 60 + Number(get('minute'));

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const deliveryDay = (weekdays.indexOf(get('weekday')) + 1) % 7;

const dayNames = [
  'domenica', 'lunedì', 'martedì',
  'mercoledì', 'giovedì', 'venerdì', 'sabato'
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

  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(c.sendTime || '')
    ? c.sendTime
    : '10:00';

  const [h, m] = time.split(':').map(Number);

  return minutes >= h * 60 + m;
}

async function main() {
  const users = await db.collection('users').get();

  for (const u of users.docs) {
    const devices = await u.ref.collection('devices').get();

    const tokens = [
      ...new Set(
        devices.docs
          .map(d => d.get('token'))
          .filter(Boolean)
      )
    ];

    if (!tokens.length) continue;

    const customers = await u.ref.collection('clients').get();

    for (const customer of customers.docs) {
      const c = customer.data();

      if (!eligible(c)) continue;

      const key = `${nowDate}_${customer.id}_${deliveryDay}`;
      const receipt = u.ref
        .collection('notificationReceipts')
        .doc(key);

      try {
        await receipt.create({
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          clientId: customer.id
        });
      } catch (e) {
        if (
          e.code === 6 ||
          e.code === 'already-exists'
        ) continue;

        throw e;
      }

      const title = 'Promemoria consegna';
      const body =
        `${c.name || 'Cliente'}: consegna ` +
        `${dayNames[deliveryDay]}` +
        `${c.city ? ' a ' + c.city : ''}.`;

      try {
        const result = await admin.messaging().sendEachForMulticast({
          tokens,
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

        console.log(
          `${u.id}/${customer.id}: ` +
          `${result.successCount} inviate, ` +
          `${result.failureCount} non riuscite`
        );

        await receipt.update({
          successCount: result.successCount,
          failureCount: result.failureCount
        });

      } catch (e) {
        console.error('Errore invio:', e.message);

        await receipt.update({
          error: String(e.message)
        });
      }
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
