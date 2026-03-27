import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, setDoc, doc } from 'firebase/firestore';

export interface Cabang {
  id: string;
  nama: string;
  area: string;
  passionCode?: string;
  sapCode?: string;
}

const CABANG_DATA = [
  // AREA AMBON
  { nama: "CP AMBON", area: "AREA AMBON", passionCode: "11169", sapCode: "PKF050100" },
  { nama: "CP NUSANIWE", area: "AREA AMBON", passionCode: "11319", sapCode: "PKF050200" },
  { nama: "CP TUAL", area: "AREA AMBON", passionCode: "11336", sapCode: "PKF050300" },
  { nama: "CP MASOHI", area: "AREA AMBON", passionCode: "11495", sapCode: "PKF050400" },
  { nama: "CP PASSO", area: "AREA AMBON", passionCode: "11498", sapCode: "PKF050500" },
  { nama: "CPS AMBON", area: "AREA AMBON", passionCode: "60315", sapCode: "PSF050100" },
  
  // AREA BANTAENG
  { nama: "CP BANTAENG", area: "AREA BANTAENG", passionCode: "11162", sapCode: "PKF070100" },
  { nama: "CP WATAMPONE", area: "AREA BANTAENG", passionCode: "11190", sapCode: "PKF070200" },
  { nama: "CP BULUKUMBA", area: "AREA BANTAENG", passionCode: "11248", sapCode: "PKF070300" },
  { nama: "CP BONTOBAHARI", area: "AREA BANTAENG", passionCode: "11250", sapCode: "PKF070400" },
  { nama: "CP SINJAI", area: "AREA BANTAENG", passionCode: "11289", sapCode: "PKF070500" },
  { nama: "CP SELAYAR", area: "AREA BANTAENG", passionCode: "11295", sapCode: "PKF070600" },
  { nama: "CP JENEPONTO", area: "AREA BANTAENG", passionCode: "11393", sapCode: "PKF070700" },
  { nama: "CPS UJUNG BULU", area: "AREA BANTAENG", passionCode: "60289", sapCode: "PSF070100" },
  
  // AREA KENDARI
  { nama: "CP KENDARI", area: "AREA KENDARI", passionCode: "11204", sapCode: "PKF040100" },
  { nama: "CP WUA WUA", area: "AREA KENDARI", passionCode: "11404", sapCode: "PKF040700" },
  { nama: "CP BAUBAU", area: "AREA KENDARI", passionCode: "11258", sapCode: "PKF040200" },
  { nama: "CP KOLAKA", area: "AREA KENDARI", passionCode: "11278", sapCode: "PKF040300" },
  { nama: "CP POMALAA", area: "AREA KENDARI", passionCode: "11279", sapCode: "PKF040400" },
  { nama: "CP RAHA", area: "AREA KENDARI", passionCode: "11373", sapCode: "PKF040500" },
  { nama: "CP UNAAHA", area: "AREA KENDARI", passionCode: "11386", sapCode: "PKF040600" },
  { nama: "CP MANDONGA", area: "AREA KENDARI", passionCode: "11433", sapCode: "PKF040800" },
  { nama: "CPS KENDARI", area: "AREA KENDARI", passionCode: "60274", sapCode: "PSF040100" },
  
  // AREA MAKASAR 1
  { nama: "CP PASAR BUTUNG", area: "AREA MAKASAR 1", passionCode: "11156", sapCode: "PKF010100" },
  { nama: "CP VETERAN", area: "AREA MAKASAR 1", passionCode: "11491", sapCode: "PKF011200" },
  { nama: "CP BONTOALA", area: "AREA MAKASAR 1", passionCode: "11227", sapCode: "PKF010200" },
  { nama: "CP PANGKEP", area: "AREA MAKASAR 1", passionCode: "11264", sapCode: "PKF010300" },
  { nama: "CP MALIMONGAN BARU", area: "AREA MAKASAR 1", passionCode: "11272", sapCode: "PKF010400" },
  { nama: "CP PELITA", area: "AREA MAKASAR 1", passionCode: "11409", sapCode: "PKF011000" },
  { nama: "CP MAROS", area: "AREA MAKASAR 1", passionCode: "11315", sapCode: "PKF010500" },
  { nama: "CP BARRU", area: "AREA MAKASAR 1", passionCode: "11339", sapCode: "PKF010600" },
  { nama: "CP DAYA", area: "AREA MAKASAR 1", passionCode: "11359", sapCode: "PKF010700" },
  { nama: "CP SUDIANG", area: "AREA MAKASAR 1", passionCode: "11360", sapCode: "PKF010800" },
  { nama: "CP ANTANG", area: "AREA MAKASAR 1", passionCode: "11382", sapCode: "PKF010900" },
  { nama: "CP TAMALANREA", area: "AREA MAKASAR 1", passionCode: "11443", sapCode: "PKF011100" },
  { nama: "CPS CENTRAL", area: "AREA MAKASAR 1", passionCode: "60267", sapCode: "PSF010100" },
  { nama: "CPS PANGKEP", area: "AREA MAKASAR 1", passionCode: "60305", sapCode: "PSF010200" },
  
  // AREA MAKASAR 2
  { nama: "CP MAKASSAR", area: "AREA MAKASAR 2", passionCode: "11150", sapCode: "PKF020100" },
  { nama: "CP MARISO", area: "AREA MAKASAR 2", passionCode: "11346", sapCode: "PKF020600" },
  { nama: "CP SUNGGUMINASA", area: "AREA MAKASAR 2", passionCode: "11179", sapCode: "PKF020200" },
  { nama: "CP TAKALAR", area: "AREA MAKASAR 2", passionCode: "11239", sapCode: "PKF020300" },
  { nama: "CP BANGKALA", area: "AREA MAKASAR 2", passionCode: "11240", sapCode: "PKF020400" },
  { nama: "CP PANAKKUKANG", area: "AREA MAKASAR 2", passionCode: "11302", sapCode: "PKF020500" },
  { nama: "CP PABAENGBAENG", area: "AREA MAKASAR 2", passionCode: "11353", sapCode: "PKF020700" },
  { nama: "CP TALASALAPANG", area: "AREA MAKASAR 2", passionCode: "11415", sapCode: "PKF020800" },
  { nama: "CP PARANGTAMBUNG", area: "AREA MAKASAR 2", passionCode: "11419", sapCode: "PKF020900" },
  { nama: "CP LIMBUNG", area: "AREA MAKASAR 2", passionCode: "11429", sapCode: "PKF021000" },
  { nama: "CP PALLANGGA", area: "AREA MAKASAR 2", passionCode: "11465", sapCode: "PKF021100" },
  { nama: "CP HERTASNING", area: "AREA MAKASAR 2", passionCode: "11487", sapCode: "PKF021200" },
  { nama: "CPS HASANUDDIN", area: "AREA MAKASAR 2", passionCode: "60281", sapCode: "PSF020100" },
  
  // AREA PALOPO
  { nama: "CP PALOPO", area: "AREA PALOPO", passionCode: "11186", sapCode: "PKF060100" },
  { nama: "CP PASAR SENTRAL PALOPO", area: "AREA PALOPO", passionCode: "11474", sapCode: "PKF060600" },
  { nama: "CP RANTEPAO", area: "AREA PALOPO", passionCode: "11200", sapCode: "PKF060200" },
  { nama: "CP SENGKANG", area: "AREA PALOPO", passionCode: "11232", sapCode: "PKF060300" },
  { nama: "CP MASAMBA", area: "AREA PALOPO", passionCode: "11377", sapCode: "PKF060400" },
  { nama: "CP BELOPA", area: "AREA PALOPO", passionCode: "11452", sapCode: "PKF060500" },
  { nama: "CP PASAR MINI", area: "AREA PALOPO", passionCode: "11481", sapCode: "PKF060700" },
  { nama: "CP MALILI", area: "AREA PALOPO", passionCode: "11505", sapCode: "PKF060800" },
  { nama: "CPS L U W U", area: "AREA PALOPO", passionCode: "60863", sapCode: "PSF060100" },
  
  // AREA PARE-PARE
  { nama: "CP PARE PARE", area: "AREA PARE-PARE", passionCode: "11175", sapCode: "PKF030100" },
  { nama: "CP WATANSOPPENG", area: "AREA PARE-PARE", passionCode: "11209", sapCode: "PKF030200" },
  { nama: "CP CABENGE", area: "AREA PARE-PARE", passionCode: "11477", sapCode: "PKF031100" },
  { nama: "CP SIDRAP", area: "AREA PARE-PARE", passionCode: "11307", sapCode: "PKF030500" },
  { nama: "CP PINRANG", area: "AREA PARE-PARE", passionCode: "11219", sapCode: "PKF030300" },
  { nama: "CP WONOMULYO", area: "AREA PARE-PARE", passionCode: "11284", sapCode: "PKF030400" },
  { nama: "CP MAMUJU", area: "AREA PARE-PARE", passionCode: "11325", sapCode: "PKF030600" },
  { nama: "CP RAPPANG", area: "AREA PARE-PARE", passionCode: "11389", sapCode: "PKF030800" },
  { nama: "CP MAJENE", area: "AREA PARE-PARE", passionCode: "11368", sapCode: "PKF030700" },
  { nama: "CP DUA PITUE", area: "AREA PARE-PARE", passionCode: "11424", sapCode: "PKF030900" },
  { nama: "CP POLEWALI", area: "AREA PARE-PARE", passionCode: "11449", sapCode: "PKF031000" },
  { nama: "CPS PANGKAJENE", area: "AREA PARE-PARE", passionCode: "60862", sapCode: "PSF030100" }
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
      return snapshot.docs.map(doc => ({ 
        id: doc.id, 
        nama: doc.data().nama,
        area: doc.data().area,
        passionCode: doc.data().passionCode,
        sapCode: doc.data().sapCode
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
      return [];
    }
  },

  async seed() {
    for (const item of CABANG_DATA) {
      const id = item.sapCode || item.nama.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await setDoc(doc(db, 'cabang', id), item);
    }
  }
};
