import { google, sheets_v4 } from 'googleapis';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local', override: false });
loadDotenv({ override: false });

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
  values?: unknown[][];
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  sheetName?: string;
  sheetId?: number;
  rowIndex?: number;
  rowIndices?: number[];
  startIndex?: number;
  count?: number;
  data?: { range: string; values: unknown[][] }[];
  secret?: string;
}

const allowedSpreadsheetId = process.env.REKON_SPREADSHEET_ID || process.env.VITE_REKON_SPREADSHEET_ID;

const parseServiceAccount = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

  if (base64) {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  }

  if (raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }
    return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
  }

  throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON belum dikonfigurasi di environment server');
};

const getSheetsClient = () => {
  const credentials = parseServiceAccount();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: String(credentials.private_key || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
};

const assertString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} wajib diisi`);
  }
  return value;
};

const assertNumber = (value: unknown, field: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} wajib berupa number`);
  }
  return value;
};

const assertValues = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new Error('values wajib berupa array');
  }
  return value as unknown[][];
};

const getSheetIdByName = async (
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
) => {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const sheet = metadata.data.sheets?.find(item => item.properties?.title === sheetName);
  return typeof sheet?.properties?.sheetId === 'number' ? sheet.properties.sheetId : null;
};

const sendError = (res: any, status: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return res.status(status).json({ success: false, error: message });
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const payload = req.body as SheetsProxyPayload;
    const configuredSecret = process.env.SHEETS_PROXY_SECRET;

    if (configuredSecret && payload.secret !== configuredSecret && req.headers['x-sheets-proxy-secret'] !== configuredSecret) {
      return res.status(401).json({ success: false, error: 'Unauthorized sheets proxy request' });
    }

    const operation = assertString(payload.operation, 'operation') as SheetOperation;
    const spreadsheetId = assertString(payload.spreadsheetId, 'spreadsheetId');

    if (allowedSpreadsheetId && spreadsheetId !== allowedSpreadsheetId) {
      return res.status(403).json({ success: false, error: 'Spreadsheet ID tidak diizinkan untuk aplikasi FIFA' });
    }

    const sheets = getSheetsClient();

    switch (operation) {
      case 'readData': {
        const range = assertString(payload.range, 'range');
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
          valueRenderOption: payload.valueRenderOption || 'FORMATTED_VALUE',
        });
        return res.status(200).json({ success: true, values: response.data.values || [] });
      }

      case 'appendData': {
        const range = assertString(payload.range, 'range');
        const values = assertValues(payload.values);
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values },
        });
        return res.status(200).json({ success: true, ...response.data });
      }

      case 'updateData': {
        const range = assertString(payload.range, 'range');
        const values = assertValues(payload.values);
        const response = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values },
        });
        return res.status(200).json({ success: true, ...response.data });
      }

      case 'getSheetIdByName': {
        const sheetName = assertString(payload.sheetName, 'sheetName');
        return res.status(200).json({ success: true, sheetId: await getSheetIdByName(sheets, spreadsheetId, sheetName) });
      }

      case 'ensureSheet': {
        const sheetName = assertString(payload.sheetName, 'sheetName');
        const existingSheetId = await getSheetIdByName(sheets, spreadsheetId, sheetName);
        if (existingSheetId !== null) {
          return res.status(200).json({ success: true, sheetId: existingSheetId });
        }

        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        });
        const createdSheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
        if (typeof createdSheetId !== 'number') {
          throw new Error(`Sheet ${sheetName} berhasil dibuat, tetapi sheetId tidak ditemukan`);
        }
        return res.status(200).json({ success: true, sheetId: createdSheetId });
      }

      case 'deleteRow': {
        const sheetId = assertNumber(payload.sheetId, 'sheetId');
        const rowIndex = assertNumber(payload.rowIndex, 'rowIndex');
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
              },
            }],
          },
        });
        return res.status(200).json({ success: true, ...response.data });
      }

      case 'deleteRows': {
        const sheetId = assertNumber(payload.sheetId, 'sheetId');
        if (!Array.isArray(payload.rowIndices)) {
          throw new Error('rowIndices wajib berupa array');
        }
        const requests: sheets_v4.Schema$Request[] = [...payload.rowIndices]
          .sort((a, b) => b - a)
          .map(index => ({
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 },
            },
          }));
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests },
        });
        return res.status(200).json({ success: true, ...response.data });
      }

      case 'batchUpdateValues': {
        if (!Array.isArray(payload.data)) {
          throw new Error('data wajib berupa array');
        }
        const response = await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: payload.data,
          },
        });
        return res.status(200).json({ success: true, ...response.data });
      }

      case 'insertRows': {
        const sheetId = assertNumber(payload.sheetId, 'sheetId');
        const startIndex = assertNumber(payload.startIndex, 'startIndex');
        const count = assertNumber(payload.count, 'count');
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              insertDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex,
                  endIndex: startIndex + count,
                },
                inheritFromBefore: true,
              },
            }],
          },
        });
        return res.status(200).json({ success: true, ...response.data });
      }

      default:
        return res.status(400).json({ success: false, error: `Operation ${operation} tidak didukung` });
    }
  } catch (error) {
    return sendError(res, 500, error);
  }
}
