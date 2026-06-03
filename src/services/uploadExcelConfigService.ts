import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface UploadExcelConfigItem {
  id: string;
  label: string;
  group: 'Proses Moker' | 'Proses Rekon';
  firstDataRow: number;
  columns: Record<string, number>;
}

export type UploadExcelConfigMap = Record<string, UploadExcelConfigItem>;

export const DEFAULT_UPLOAD_EXCEL_CONFIGS: UploadExcelConfigMap = {
  'moker-sistem': {
    id: 'moker-sistem',
    label: 'Proses Moker - Sistem',
    group: 'Proses Moker',
    firstDataRow: 12,
    columns: { tanggal: 0, docNumber: 5, textUtama: 4, longText: 11, kredit: 8, balance: 9 },
  },
  'moker-bni-cms': {
    id: 'moker-bni-cms',
    label: 'Proses Moker - CMS BNI',
    group: 'Proses Moker',
    firstDataRow: 12,
    columns: { tanggal: 7, keterangan: 12, amount: 21, dc: 23, balance: 24 },
  },
  'moker-bri-cms': {
    id: 'moker-bri-cms',
    label: 'Proses Moker - CMS BRI',
    group: 'Proses Moker',
    firstDataRow: 18,
    columns: { tanggal: 2, keterangan: 6, debit: 22, kredit: 31, balance: 38 },
  },
  'moker-bsi-cms': {
    id: 'moker-bsi-cms',
    label: 'Proses Moker - CMS BSI',
    group: 'Proses Moker',
    firstDataRow: 12,
    columns: { tanggal: 0, keterangan: 2, amount: 4, db: 5, cr: 6, balance: 7 },
  },
  'rekon-sistem': {
    id: 'rekon-sistem',
    label: 'Proses Rekon - Sistem',
    group: 'Proses Rekon',
    firstDataRow: 12,
    columns: { tanggal: 0, textUtama: 4, longText: 11, debit: 7, kredit: 8, balance: 9 },
  },
  'rekon-bni-cms': {
    id: 'rekon-bni-cms',
    label: 'Proses Rekon - CMS BNI',
    group: 'Proses Rekon',
    firstDataRow: 12,
    columns: { tanggal: 7, keterangan: 12, amount: 21, dc: 23, balance: 24 },
  },
  'rekon-bri-cms': {
    id: 'rekon-bri-cms',
    label: 'Proses Rekon - CMS BRI',
    group: 'Proses Rekon',
    firstDataRow: 18,
    columns: { tanggal: 2, keterangan: 6, debit: 22, kredit: 31, balance: 38 },
  },
  'rekon-bsi-cms': {
    id: 'rekon-bsi-cms',
    label: 'Proses Rekon - CMS BSI',
    group: 'Proses Rekon',
    firstDataRow: 12,
    columns: { tanggal: 0, keterangan: 2, amount: 4, db: 5, cr: 6, balance: 7 },
  },
};

const configDocRef = () => doc(db, 'app_settings', 'upload_excel_config');

const mergeConfigs = (raw: any): UploadExcelConfigMap => {
  const saved = raw?.configs || {};
  return Object.values(DEFAULT_UPLOAD_EXCEL_CONFIGS).reduce<UploadExcelConfigMap>((acc, item) => {
    const savedItem = saved[item.id] || {};
    acc[item.id] = {
      ...item,
      ...savedItem,
      columns: { ...item.columns, ...(savedItem.columns || {}) },
    };
    return acc;
  }, {});
};

export const uploadExcelConfigService = {
  async getConfigs(): Promise<UploadExcelConfigMap> {
    const snapshot = await getDoc(configDocRef());
    return mergeConfigs(snapshot.exists() ? snapshot.data() : {});
  },

  async saveConfigs(configs: UploadExcelConfigMap) {
    await setDoc(configDocRef(), {
      configs,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  },
};

export default uploadExcelConfigService;
