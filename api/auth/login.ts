import { sendApiError } from '../_lib/api-response';
import { getRequestIp, enforceRateLimit } from '../_lib/rate-limit';
import { getServerAuth, getServerFirestore } from '../_lib/google-server';

const invalidLogin = () => Object.assign(new Error('NIK atau password tidak valid'), { statusCode: 401 });

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method tidak diizinkan' });

  try {
    enforceRateLimit(`login:${getRequestIp(req)}`);
    const nik = String(req.body?.nik || '').trim();
    const password = String(req.body?.password || '');
    if (!nik || !password || nik.length > 64 || password.length > 256) throw invalidLogin();

    const snapshot = await getServerFirestore().collection('users').where('nik', '==', nik).limit(1).get();
    if (snapshot.empty) throw invalidLogin();
    const userDocument = snapshot.docs[0];
    const user = userDocument.data() || {};
    if (user.status !== 'active') throw invalidLogin();

    const email = String(user.email || `${nik}@fifa.local`).trim();
    const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!apiKey) throw new Error('Firebase API Key belum dikonfigurasi di server');

    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const authData = await authResponse.json().catch(() => null);
    if (!authResponse.ok || !authData?.localId) throw invalidLogin();

    const uid = String(user.uid || userDocument.id);
    if (uid !== String(authData.localId)) throw invalidLogin();
    const customToken = await getServerAuth().createCustomToken(uid);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      customToken,
      user: {
        uid,
        nik: String(user.nik || nik),
        name: String(user.name || nik),
        role: String(user.role || ''),
        status: 'active',
        email,
      },
    });
  } catch (error) {
    return sendApiError(res, error, 'Gagal masuk ke FIFA');
  }
}
