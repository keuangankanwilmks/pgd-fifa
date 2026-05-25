import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export interface GLBankMapping {
  id?: string;
  bank: string;
  noRekening?: string;
  nomorGL: string;
  pic: string;
  [key: string]: any;
}

export const glBankService = {
  async getAll(): Promise<GLBankMapping[]> {
    const snapshot = await getDocs(collection(db, 'gl_bank'));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() as any }));
  },

  async getByBank(bank: string): Promise<GLBankMapping | null> {
    const normalizedBank = String(bank || '').trim().toUpperCase();
    const rows = await this.getAll();
    return rows.find(item => String(item.bank || '').trim().toUpperCase() === normalizedBank) || null;
  },
};
