import { googleSheetsService } from './googleSheetsService';
import { glBankService, type GLBankMapping } from './glBankService';

export interface SaldoHarianUpsertInput {
  tanggal: string;
  bank: string;
  saldoBank?: number | null;
  saldoSistem?: number | null;
  keterangan?: string;
}

export interface SaldoHarianRow {
  rowIndex: number;
  tanggal: string;
  noRekening: string;
  bank: string;
  nomorGL: string;
  saldoBank: number;
  saldoSistem: number;
  selisih: number;
  pic: string;
  keterangan: string;
}

const SHEET_NAME = 'SaldoHarian';
const HEADERS = [
  'Tanggal',
  'No Rekening',
  'Bank',
  'Nomor GL',
  'Saldo Bank',
  'Saldo Sistem',
  'Selisih',
  'PIC',
  'Keterangan',
];

const normalizeBank = (bank: string) => String(bank || '').trim().toUpperCase();

const parseAmount = (value: any) => {
  if (typeof value === 'number') return value;
  let text = String(value ?? '').trim();
  if (!text) return 0;

  text = text.replace(/[^\d.,-]/g, '');
  if (text.includes('.') && text.includes(',')) {
    text = text.lastIndexOf('.') < text.lastIndexOf(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    const parts = text.split(',');
    text = parts.length > 2 || (parts.length === 2 && parts[1].length === 3)
      ? text.replace(/,/g, '')
      : text.replace(',', '.');
  } else if (text.includes('.')) {
    const parts = text.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      text = text.replace(/\./g, '');
    }
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getNoRekening = (mapping: GLBankMapping | null, existing?: any[]) => (
  String(mapping?.noRekening || mapping?.nomorRekening || mapping?.rekening || existing?.[1] || '').trim()
);

const getNomorGL = (mapping: GLBankMapping | null, existing?: any[]) => (
  String(mapping?.nomorGL || mapping?.gl || existing?.[3] || '').trim()
);

const getPIC = (mapping: GLBankMapping | null, existing?: any[]) => (
  String(mapping?.pic || mapping?.PIC || existing?.[7] || '').trim()
);

const getBankLabel = (mapping: GLBankMapping | null, bank: string, existing?: any[]) => (
  String(mapping?.bank || existing?.[2] || bank).trim()
);

export const saldoHarianService = {
  async ensureSheet(spreadsheetId: string) {
    await googleSheetsService.ensureSheet(spreadsheetId, SHEET_NAME);
    let rows = await googleSheetsService.readData(spreadsheetId, `${SHEET_NAME}!A:I`, 'FORMATTED_VALUE', true);

    if (!rows || rows.length === 0) {
      await googleSheetsService.updateData(spreadsheetId, `${SHEET_NAME}!A1:I1`, [HEADERS]);
      rows = await googleSheetsService.readData(spreadsheetId, `${SHEET_NAME}!A:I`, 'FORMATTED_VALUE', true);
    }

    return rows || [HEADERS];
  },

  mapRows(values: any[][] = []): SaldoHarianRow[] {
    return values.map((row, index) => {
      const saldoBank = parseAmount(row[4]);
      const saldoSistem = parseAmount(row[5]);
      return {
        rowIndex: index + 2,
        tanggal: String(row[0] || ''),
        noRekening: String(row[1] || ''),
        bank: String(row[2] || ''),
        nomorGL: String(row[3] || ''),
        saldoBank,
        saldoSistem,
        selisih: row[6] === undefined || row[6] === '' ? saldoBank - saldoSistem : parseAmount(row[6]),
        pic: String(row[7] || ''),
        keterangan: String(row[8] || ''),
      };
    });
  },

  async readRows(spreadsheetId: string) {
    const values = await googleSheetsService.readData(spreadsheetId, `${SHEET_NAME}!A2:I`, 'FORMATTED_VALUE');
    return this.mapRows(values || []);
  },

  async upsert(spreadsheetId: string, input: SaldoHarianUpsertInput) {
    const tanggal = String(input.tanggal || '').trim();
    const bank = normalizeBank(input.bank);

    if (!tanggal || !bank) {
      throw new Error('Tanggal dan Bank wajib tersedia untuk menyimpan Saldo Harian');
    }

    const rows = await this.ensureSheet(spreadsheetId);
    const existingIndex = rows.findIndex((row: any[], index: number) => (
      index > 0 &&
      String(row?.[0] || '').trim() === tanggal &&
      normalizeBank(row?.[2]) === bank
    ));
    const existingRow = existingIndex > -1 ? rows[existingIndex] : undefined;
    const rowIndex = existingIndex > -1 ? existingIndex + 1 : rows.length + 1;
    const glBank = await glBankService.getByBank(bank).catch(error => {
      console.warn('Gagal memuat master GL Bank:', error);
      return null;
    });

    const saldoBank = input.saldoBank ?? parseAmount(existingRow?.[4]);
    const saldoSistem = input.saldoSistem ?? parseAmount(existingRow?.[5]);
    const nextRow = [[
      tanggal,
      getNoRekening(glBank, existingRow),
      getBankLabel(glBank, bank, existingRow),
      getNomorGL(glBank, existingRow),
      saldoBank,
      saldoSistem,
      `=E${rowIndex}-F${rowIndex}`,
      getPIC(glBank, existingRow),
      input.keterangan ?? String(existingRow?.[8] || ''),
    ]];

    if (existingIndex > -1) {
      await googleSheetsService.updateData(spreadsheetId, `${SHEET_NAME}!A${rowIndex}:I${rowIndex}`, nextRow);
      return { action: 'updated' as const, rowIndex };
    }

    await googleSheetsService.appendData(spreadsheetId, `${SHEET_NAME}!A1`, nextRow);
    return { action: 'appended' as const, rowIndex };
  },

  async upsertMany(spreadsheetId: string, inputs: SaldoHarianUpsertInput[]) {
    const results = [];
    for (const input of inputs) {
      results.push(await this.upsert(spreadsheetId, input));
    }
    return results;
  },
};

export default saldoHarianService;
