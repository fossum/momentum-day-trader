import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

if (!getApps().length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    initializeApp({
      credential: cert(serviceAccount)
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({
      credential: applicationDefault()
    });
  } else {
    // Attempt application default without explicit env variable, 
    // or log a warning if it fails.
    try {
      initializeApp({
        credential: applicationDefault()
      });
    } catch (e) {
      console.error(
        "ERROR: Could not initialize Firebase Admin. " +
        "Please set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS in your .env file."
      );
      process.exit(1);
    }
  }
}

export const adminDb = getFirestore();
export const adminAuth = getAuth();
