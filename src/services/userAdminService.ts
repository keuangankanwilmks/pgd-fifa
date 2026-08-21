import { auth } from '../firebase';

const call = async (path: string, body?: Record<string, unknown>, method = 'POST') => {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login diperlukan');
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `Permintaan user gagal (${response.status})`);
  }
  return data;
};

export const userAdminService = {
  list: () => call('/api/users/list', undefined, 'GET'),
  create: (body: Record<string, unknown>) => call('/api/users/create', body),
  update: (body: Record<string, unknown>) => call('/api/users/update', body),
  delete: (uid: string) => call('/api/users/delete', { uid }),
  updateProfile: (body: Record<string, unknown>) => call('/api/users/profile', body),
  purgeLegacyPasswords: () => call('/api/users/purge-legacy-passwords', {}),
};
