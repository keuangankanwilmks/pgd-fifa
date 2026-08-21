import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { config as loadDotenv } from 'dotenv';
import { google } from 'googleapis';

// Vercel injects production secrets into process.env. These calls provide the
// same behavior for local API execution without overriding injected values.
loadDotenv({ path: '.env.local', override: false });
loadDotenv({ override: false });

const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID
  || 'ai-studio-a4f3ceec-4fe2-4bb5-860f-0282bf6bc9ef';

const parseServiceAccount = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!raw && !base64) throw new Error('Google Service Account belum dikonfigurasi');

  const value = base64 || raw || '';
  const trimmed = value.trim();
  const credentials = trimmed.startsWith('{')
    ? JSON.parse(trimmed)
    : JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));

  return {
    ...credentials,
    private_key: String(credentials.private_key || '').replace(/\\n/g, '\n'),
  };
};

let serverApp: App | undefined;

export const getServerApp = () => {
  if (serverApp) return serverApp;
  const existing = getApps().find(app => app.name === 'fifa-server');
  serverApp = existing || initializeApp({ credential: cert(parseServiceAccount()) }, 'fifa-server');
  return serverApp;
};

export const getServerAuth = () => getAuth(getServerApp());
export const getServerFirestore = () => getFirestore(getServerApp(), FIRESTORE_DATABASE_ID);

const getGoogleAuth = () => {
  const credentials = parseServiceAccount();
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
};

export const getGoogleDrive = () => google.drive({ version: 'v3', auth: getGoogleAuth() });
export const getGoogleSheets = () => google.sheets({ version: 'v4', auth: getGoogleAuth() });
