import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { mataAnggaranSeed, type MataAnggaranMaster } from '../data/mataAnggaranSeed';

const normalize = (value: unknown) => String(value ?? '').trim();

export const mataAnggaranService = {
  async getAll(): Promise<MataAnggaranMaster[]> {
    try {
      const snapshot = await getDocs(collection(db, 'mata_anggaran'));
      const firebaseRows = snapshot.docs
        .map(item => ({
          id: item.id,
          mataAnggaran: normalize(item.data().mataAnggaran),
          kodeActivity: normalize(item.data().kodeActivity),
        }))
        .filter(item => item.mataAnggaran && item.kodeActivity);

      return (firebaseRows.length ? firebaseRows : mataAnggaranSeed)
        .sort((a, b) => a.mataAnggaran.localeCompare(b.mataAnggaran) || a.kodeActivity.localeCompare(b.kodeActivity));
    } catch (error) {
      console.warn('Firebase mata_anggaran belum dapat diakses, menggunakan data awal.', error);
      return [...mataAnggaranSeed];
    }
  },
};
