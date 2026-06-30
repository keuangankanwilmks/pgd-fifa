/**
 * Google Sheets Service
 * All read and write operations go through the server-side proxy so the
 * spreadsheet can remain private and only be shared with the service account.
 */

export interface GoogleSheetConfig {
  spreadsheetId: string;
  range: string;
}

type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';

type SheetOperation =
  | 'readData'
  | 'appendData'
  | 'updateData'
  | 'getSheetIdByName'
  | 'ensureSheet'
  | 'deleteRow'
  | 'deleteRows'
  | 'batchUpdateValues'
  | 'insertRows';

interface SheetsProxyPayload {
  operation: SheetOperation;
  spreadsheetId: string;
  range?: string;
  values?: any[][];
  valueRenderOption?: ValueRenderOption;
  sheetName?: string;
  sheetId?: number;
  rowIndex?: number;
  rowIndices?: number[];
  startIndex?: number;
  count?: number;
  data?: { range: string; values: any[][] }[];
  secret?: string;
}

export class GoogleSheetsService {
  private proxyUrl = import.meta.env.VITE_SHEETS_PROXY_URL || '/api/sheets-proxy';
  private proxySecret = import.meta.env.VITE_SHEETS_PROXY_SECRET || '';

  hasToken(): boolean {
    return true;
  }

  async authorize(): Promise<string> {
    return 'vercel-sheets-proxy';
  }

  private async call(payload: SheetsProxyPayload) {
    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.proxySecret ? { 'X-Sheets-Proxy-Secret': this.proxySecret } : {}),
      },
      body: JSON.stringify({
        ...payload,
        ...(this.proxySecret ? { secret: this.proxySecret } : {}),
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || `Gagal mengakses Google Sheets proxy (${response.status})`);
    }

    return data;
  }

  async appendData(spreadsheetId: string, range: string, values: any[][]) {
    return this.call({ operation: 'appendData', spreadsheetId, range, values });
  }

  async readData(
    spreadsheetId: string,
    range: string,
    valueRenderOption: ValueRenderOption = 'FORMATTED_VALUE',
    _forceAuthorize = false,
  ) {
    const data = await this.call({
      operation: 'readData',
      spreadsheetId,
      range,
      valueRenderOption,
    });
    return data.values || [];
  }

  async updateData(spreadsheetId: string, range: string, values: any[][]) {
    return this.call({ operation: 'updateData', spreadsheetId, range, values });
  }

  async getSheetIdByName(spreadsheetId: string, sheetName: string): Promise<number | null> {
    const data = await this.call({ operation: 'getSheetIdByName', spreadsheetId, sheetName });
    return typeof data.sheetId === 'number' ? data.sheetId : null;
  }

  async ensureSheet(spreadsheetId: string, sheetName: string): Promise<number> {
    const data = await this.call({ operation: 'ensureSheet', spreadsheetId, sheetName });
    if (typeof data.sheetId !== 'number') {
      throw new Error(`Sheet ${sheetName} berhasil dibuat, tetapi sheetId tidak ditemukan`);
    }
    return data.sheetId;
  }

  async deleteRow(spreadsheetId: string, sheetId: number, rowIndex: number) {
    return this.call({ operation: 'deleteRow', spreadsheetId, sheetId, rowIndex });
  }

  async deleteRows(spreadsheetId: string, sheetId: number, rowIndices: number[]) {
    return this.call({ operation: 'deleteRows', spreadsheetId, sheetId, rowIndices });
  }

  async batchUpdateValues(spreadsheetId: string, data: { range: string; values: any[][] }[]) {
    return this.call({ operation: 'batchUpdateValues', spreadsheetId, data });
  }

  async insertRows(spreadsheetId: string, sheetId: number, startIndex: number, count: number) {
    return this.call({ operation: 'insertRows', spreadsheetId, sheetId, startIndex, count });
  }
}

export const googleSheetsService = new GoogleSheetsService();
export default googleSheetsService;
