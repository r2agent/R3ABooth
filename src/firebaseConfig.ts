/* ============================================================
   FIREBASE CONFIG — koneksi ke Firebase Realtime Database
   ============================================================ */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
      throw new Error(
        'Firebase config tidak lengkap. Cek .env.local — pastikan VITE_FIREBASE_API_KEY dan VITE_FIREBASE_DATABASE_URL terisi.',
      );
    }
    app = initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseDb(): Database {
  if (!db) {
    db = getDatabase(getFirebaseApp());
  }
  return db;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);
}