import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';

export interface PlafonData {
  id: string;
  namaCabang: string;
  nominal: number;
}

const PLAFON_INITIAL_DATA: Record<string, number> = {
  "CP AMBON": 200000000,
  "CP ANTANG": 100000000,
  "CP BANTAENG": 150000000,
  "CP BARRU": 150000000,
  "CP BAUBAU": 200000000,
  "CP BELOPA": 150000000,
  "CP BONTOALA": 150000000,
  "CP BULUKUMBA": 200000000,
  "CP CABENGE": 100000000,
  "CP DAYA": 200000000,
  "CP DUA PITUE": 200000000,
  "CP HERTASNING": 150000000,
  "CP JENEPONTO": 200000000,
  "CP KENDARI": 150000000,
  "CP KOLAKA": 200000000,
  "CP LIMBUNG": 100000000,
  "CP MAJENE": 100000000,
  "CP MAKASSAR": 250000000,
  "CP MALILI": 150000000,
  "CP MALIMONGAN BARU": 200000000,
  "CP MAMUJU": 200000000,
  "CP MANDONGA": 150000000,
  "CP MARISO": 200000000,
  "CP MAROS": 150000000,
  "CP MASAMBA": 100000000,
  "CP MASOHI": 50000000,
  "CP NUSANIWE": 150000000,
  "CP PABAENGBAENG": 150000000,
  "CP PALLANGGA": 100000000,
  "CP PALOPO": 100000000,
  "CP PANAKKUKANG": 200000000,
  "CP PANGKEP": 200000000,
  "CP PARANGTAMBUNG": 150000000,
  "CP PARE PARE": 150000000,
  "CP PASAR MINI": 100000000,
  "CP PASSO": 150000000,
  "CP PELITA": 150000000,
  "CP PINRANG": 200000000,
  "CP POLEWALI": 100000000,
  "CP POMALAA": 100000000,
  "CP PASAR SENTRAL PALOPO": 100000000,
  "CP PASAR BUTUNG": 150000000,
  "CP RAHA": 100000000,
  "CP RANTEPAO": 200000000,
  "CP RAPPANG": 200000000,
  "CP SELAYAR": 100000000,
  "CP SENGKANG": 200000000,
  "CP SIDRAP": 250000000,
  "CP SINJAI": 150000000,
  "CP SUDIANG": 100000000,
  "CP SUNGGUMINASA": 200000000,
  "CP TAKALAR": 250000000,
  "CP TALASALAPANG": 100000000,
  "CP TAMALANREA": 150000000,
  "CP TUAL": 100000000,
  "CP UNAAHA": 100000000,
  "CP VETERAN": 100000000,
  "CP WATAMPONE": 200000000,
  "CP WATANSOPPENG": 200000000,
  "CP WONOMULYO": 150000000,
  "CP WUA WUA": 100000000
};

export const plafonService = {
  async getAll(): Promise<Record<string, number>> {
    const path = 'plafon';
    try {
      const snapshot = await getDocs(collection(db, path));
      if (snapshot.empty) {
        try {
          await this.seed();
          return PLAFON_INITIAL_DATA;
        } catch (seedError) {
          console.warn('Failed to seed plafon data, falling back to local data:', seedError);
          return PLAFON_INITIAL_DATA;
        }
      }
      
      const result: Record<string, number> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        result[data.namaCabang] = data.nominal;
      });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
      console.error('Error fetching plafon data:', error);
      return PLAFON_INITIAL_DATA;
    }
  },

  async seed() {
    const path = 'plafon';
    try {
      for (const [namaCabang, nominal] of Object.entries(PLAFON_INITIAL_DATA)) {
        const id = namaCabang.toLowerCase().replace(/[^a-z0-9]/g, '_');
        await setDoc(doc(db, path, id), {
          namaCabang,
          nominal
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
};
