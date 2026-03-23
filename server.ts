import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase config
let firebaseConfig;
if (process.env.FIREBASE_CONFIG) {
  firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8'));
}

// Initialize Firebase Admin SDK
// This uses the default service account of the Cloud Run container
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

// Use the specific database ID if provided
const db = getFirestore(firebaseConfig.firestoreDatabaseId || '(default)');

// Gmail Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'kristofferhjorth@gmail.com';
const APP_URL = process.env.APP_URL || 'https://ais-dev-noj7fewly2jzi2zw3u2jvj-173387605973.europe-west3.run.app';

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.post('/api/notify-admin', async (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

    try {
      // Admin SDK bypasses security rules
      const bookingDoc = await db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });

      const booking = bookingDoc.data()!;
      
      const approveUrl = `${APP_URL}/api/bookings/${bookingId}/approve`;
      const rejectUrl = `${APP_URL}/api/bookings/${bookingId}/reject`;

      await transporter.sendMail({
        from: `"Booking System" <${process.env.GMAIL_USER}>`,
        to: ADMIN_EMAIL,
        subject: `Ny bookinganmodning: ${booking.serviceName}`,
        html: `
          <h1>Ny bookinganmodning</h1>
          <p><strong>Kunde:</strong> ${booking.customerName}</p>
          <p><strong>Behandling:</strong> ${booking.serviceName}</p>
          <p><strong>Dato:</strong> ${booking.date}</p>
          <p><strong>Tid:</strong> ${booking.time}</p>
          <p><strong>Email:</strong> ${booking.customerEmail}</p>
          <p><strong>Note:</strong> ${booking.customerNote || 'Ingen'}</p>
          <div style="margin-top: 20px;">
            <a href="${approveUrl}" style="background: black; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">Godkend</a>
            <a href="${rejectUrl}" style="background: #ef4444; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Afvis</a>
          </div>
        `,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error notifying admin:', error);
      res.status(500).json({ error: 'Failed to notify admin' });
    }
  });

  app.get('/api/bookings/:id/approve', async (req, res) => {
    const { id } = req.params;
    try {
      const bookingRef = db.collection('bookings').doc(id);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).send('Booking ikke fundet');

      const booking = bookingDoc.data()!;
      await bookingRef.update({ status: 'approved' });

      // Check user preferences
      let shouldSendEmail = true;
      if (booking.userId) {
        const prefDoc = await db.collection('users').doc(booking.userId).collection('preferences').doc('settings').get();
        if (prefDoc.exists) {
          const prefs = prefDoc.data()!;
          shouldSendEmail = prefs.emailConfirmations !== false;
          if (prefs.pushConfirmations) {
            console.log(`[PUSH] Sending confirmation to user ${booking.userId}: Din booking er bekræftet!`);
          }
        }
      }

      if (shouldSendEmail) {
        // Send email to customer
        await transporter.sendMail({
          from: `"Massage Klinik" <${process.env.GMAIL_USER}>`,
          to: booking.customerEmail,
          subject: 'Din booking er bekræftet!',
          html: `
            <h1>Din booking er bekræftet</h1>
            <p>Hej ${booking.customerName},</p>
            <p>Vi glæder os til at se dig til din ${booking.serviceName} d. ${booking.date} kl. ${booking.time}.</p>
            <p>Venlig hilsen,<br/>Massage Klinikken</p>
          `,
        });
      }

      res.send('<h1>Booking godkendt!</h1><p>Kunden har fået besked.</p>');
    } catch (error) {
      console.error('Error approving booking:', error);
      res.status(500).send('Der opstod en fejl');
    }
  });

  app.get('/api/bookings/:id/reject', async (req, res) => {
    const { id } = req.params;
    try {
      const bookingRef = db.collection('bookings').doc(id);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).send('Booking ikke fundet');

      const booking = bookingDoc.data()!;
      await bookingRef.update({ status: 'rejected' });

      // Check user preferences
      let shouldSendEmail = true;
      if (booking.userId) {
        const prefDoc = await db.collection('users').doc(booking.userId).collection('preferences').doc('settings').get();
        if (prefDoc.exists) {
          const prefs = prefDoc.data()!;
          shouldSendEmail = prefs.emailConfirmations !== false;
          if (prefs.pushConfirmations) {
            console.log(`[PUSH] Sending rejection to user ${booking.userId}: Din booking kunne desværre ikke bekræftes.`);
          }
        }
      }

      if (shouldSendEmail) {
        // Send email to customer
        await transporter.sendMail({
          from: `"Massage Klinik" <${process.env.GMAIL_USER}>`,
          to: booking.customerEmail,
          subject: 'Opdatering vedrørende din booking',
          html: `
            <h1>Din booking kunne desværre ikke bekræftes</h1>
            <p>Hej ${booking.customerName},</p>
            <p>Vi har desværre ikke mulighed for at tage imod din booking d. ${booking.date} kl. ${booking.time}.</p>
            <p>Du er velkommen til at prøve at booke en anden tid.</p>
            <p>Venlig hilsen,<br/>Massage Klinikken</p>
          `,
        });
      }

      res.send('<h1>Booking afvist</h1><p>Kunden har fået besked.</p>');
    } catch (error) {
      console.error('Error rejecting booking:', error);
      res.status(500).send('Der opstod en fejl');
    }
  });

  app.post('/api/reminders/run', async (req, res) => {
    console.log('[REMINDERS] Manual trigger received...');
    await runReminders();
    res.json({ success: true });
  });

  // Background task for reminders (runs every hour in persistent environments)
  const runReminders = async () => {
    console.log('[REMINDERS] Checking for upcoming bookings...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    try {
      const bookingsSnap = await db.collection('bookings')
        .where('status', '==', 'approved')
        .where('date', '>=', `${tomorrowStr}T00:00:00`)
        .where('date', '<=', `${tomorrowStr}T23:59:59`)
        .where('reminderSent', '==', false)
        .get();

      for (const doc of bookingsSnap.docs) {
        const booking = doc.data();
        
        let sendEmail = true;
        let sendPush = false;

        if (booking.userId) {
          const prefDoc = await db.collection('users').doc(booking.userId).collection('preferences').doc('settings').get();
          if (prefDoc.exists) {
            const prefs = prefDoc.data()!;
            sendEmail = prefs.emailReminders !== false;
            sendPush = prefs.pushReminders === true;
          }
        }

        if (sendEmail) {
          await transporter.sendMail({
            from: `"Massage Klinik" <${process.env.GMAIL_USER}>`,
            to: booking.customerEmail,
            subject: 'Påmindelse: Din tid i morgen',
            html: `
              <h1>Påmindelse om din tid</h1>
              <p>Hej ${booking.customerName},</p>
              <p>Dette er en venlig påmindelse om din tid til ${booking.serviceName} i morgen d. ${booking.date} kl. ${booking.time}.</p>
              <p>Vi glæder os til at se dig!</p>
              <p>Venlig hilsen,<br/>Massage Klinikken</p>
            `,
          });
        }

        if (sendPush && booking.userId) {
          console.log(`[PUSH] Sending reminder to user ${booking.userId}: Husk din tid i morgen kl. ${booking.time}!`);
        }

        await doc.ref.update({ reminderSent: true });
      }
    } catch (error) {
      console.error('Error in reminder task:', error);
    }
  };

  if (process.env.NODE_ENV !== 'production') {
    setInterval(runReminders, 1000 * 60 * 60); // Every hour
  }

  app.post('/api/notify-admin-cancellation', async (req, res) => {
    const { bookingId } = req.body;
    try {
      const bookingDoc = await db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });

      const booking = bookingDoc.data()!;

      await transporter.sendMail({
        from: `"Booking System" <${process.env.GMAIL_USER}>`,
        to: ADMIN_EMAIL,
        subject: `Booking annulleret af kunde: ${booking.customerName}`,
        html: `
          <h1>Booking annulleret</h1>
          <p><strong>Kunde:</strong> ${booking.customerName}</p>
          <p><strong>Behandling:</strong> ${booking.serviceName}</p>
          <p><strong>Dato:</strong> ${booking.date}</p>
          <p><strong>Tid:</strong> ${booking.time}</p>
          <p>Kunden har selv annulleret denne booking via deres profil.</p>
        `,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error notifying cancellation:', error);
      res.status(500).json({ error: 'Failed to notify' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  return app;
}

export default startServer();
