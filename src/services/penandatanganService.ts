import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface InputDroppingSigners {
  disetujuiOleh: string;
  diperiksaOleh: string;
  dibuatOleh: string;
}

export const defaultInputDroppingSigners: InputDroppingSigners = {
  disetujuiOleh: '',
  diperiksaOleh: '',
  dibuatOleh: '',
};

const normalize = (value: unknown) => String(value ?? '').trim();

export const penandatanganService = {
  async getInputDropping(): Promise<InputDroppingSigners> {
    try {
      const snapshot = await getDoc(doc(db, 'penandatangan', 'input_dropping'));
      if (!snapshot.exists()) return defaultInputDroppingSigners;
      const data = snapshot.data();
      return {
        disetujuiOleh: normalize(data.disetujuiOleh),
        diperiksaOleh: normalize(data.diperiksaOleh),
        dibuatOleh: normalize(data.dibuatOleh),
      };
    } catch (error) {
      console.warn('Firebase penandatangan belum dapat diakses.', error);
      return defaultInputDroppingSigners;
    }
  },
};
