import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';

export interface Cabang {
  id: string;
  nama: string;
}

const DEFAULT_CABANG = [
  'Makassar',
  'Gowa',
  'Maros',
  'Pangkep',
  'Parepare',
  'Palopo',
  'Ambon',
  'Kendari',
  'Kolaka',
  'Mamuju',
  'Majene',
  'Polewali',
  'Bau-Bau',
  'Raha',
  'Tual',
  'Masohi'
];

export const cabangService = {
  async getAll(): Promise<Cabang[]> {
    const path = 'cabang';
    try {
      const snapshot = await getDocs(collection(db, path));
      if (snapshot.empty) {
        await this.seed();
        return this.getAll();
      }
      return snapshot.docs.map(doc => ({ id: doc.id, nama: doc.data().nama }));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async seed() {
    for (const nama of DEFAULT_CABANG) {
      const id = nama.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await setDoc(doc(db, 'cabang', id), { nama });
    }
  }
};
