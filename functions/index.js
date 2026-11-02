
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();

exports.sendDeliveryReminders = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "Europe/Rome",
    region: "europe-west1",
    maxInstances: 1
  },
  async () => {
    const now = new Date();

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      })
        .formatToParts(now)
        .map(p => [p.type, p.value])
    );

    const today =
      `${parts.year}-${parts.month}-${parts.day}`;

    const currentMinutes =
      Number(parts.hour) * 60 + Number(parts.minute);

    const weekday = new Date(
      `${today}T12:00:00Z`
    ).getUTCDay();

    const tomorrow = (weekday + 1) % 7;

    const users = await db.collection("users").get();

    for (const user of users.docs) {
      const uid = user.id;

      const clients = await db
        .collection("users")
        .doc(uid)
        .collection("clients")
        .get();

      const devices = await db
        .collection("users")
        .doc(uid)
        .collection("devices")
        .get();

      const tokens = [
        ...new Set(
          devices.docs
            .map(d => d.data().token)
            .filter(Boolean)
        )
      ];

      if (!tokens.length) continue;

      for (const client of clients.docs) {
        const c = client.data();

        if (
          !Array.isArray(c.days) ||
          !c.days.map(Number).includes(tomorrow)
        ) {
          continue;
        }

        if (
          c.season === "yes" &&
          c.reopen &&
          c.reopen > today
        ) {
          continue;
        }

        const time =
          /^([01]\d|2[0-3]):[0-5]\d$/.test(c.sendTime || "")
            ? c.sendTime
            : "10:00";

        const [hour, minute] = time
          .split(":")
          .map(Number);

        const scheduledMinutes = hour * 60 + minute;

        // Controllo ogni ora:
        // invia dal primo controllo utile
        // successivo all'orario scelto.
        if (
          currentMinutes < scheduledMinutes ||
          currentMinutes >= scheduledMinutes + 60
        ) {
          continue;
        }

        const reminderId = `${today}_${client.id}`;

        const reminderRef = db
          .collection("users")
          .doc(uid)
          .collection("sentReminders")
          .doc(reminderId);

        let reserved = false;

        await db.runTransaction(async tx => {
          const existing = await tx.get(reminderRef);

          if (existing.exists) return;

          tx.create(reminderRef, {
            clientId: client.id,
            date: today,
            status: "processing",
            createdAt: FieldValue.serverTimestamp()
          });

          reserved = true;
        });

        if (!reserved) continue;

        try {
          const result =
            await getMessaging().sendEachForMulticast({
              tokens,
              data: {
                title: "Le mie consegne",
                body:
                  `Domani consegna per ` +
                  `${c.name || "cliente"} a ` +
                  `${c.city || "destinazione"}`,
                clientId: client.id
              },
              android: {
                priority: "high"
              },
              webpush: {
                headers: {
                  Urgency: "high"
                }
              }
            });

          await reminderRef.update({
            status:
              result.successCount > 0
                ? "sent"
                : "failed",
            successCount: result.successCount,
            failureCount: result.failureCount,
            completedAt: FieldValue.serverTimestamp()
          });

        } catch (error) {
          console.error("Errore notifica:", error);

          await reminderRef.update({
            status: "failed",
            error: String(error.message || error)
          });
        }
      }
    }
  }
);
