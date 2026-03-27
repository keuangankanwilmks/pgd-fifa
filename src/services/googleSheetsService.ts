/**
 * Google Sheets Service
 * Handles OAuth2 flow and API interactions for Google Sheets.
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

export interface GoogleSheetConfig {
  spreadsheetId: string;
  range: string;
}

export class GoogleSheetsService {
  private accessToken: string | null = null;

  constructor(private clientId: string) {}

  /**
   * Checks if the service has an access token.
   */
  hasToken(): boolean {
    return !!this.accessToken;
  }

  /**
   * Initiates the OAuth2 popup flow to get an access token.
   */
  async authorize(): Promise<string> {
    if (!this.clientId) {
      throw new Error('Google Client ID belum dikonfigurasi. Silakan cek file .env');
    }

    return new Promise((resolve, reject) => {
      try {
        // @ts-ignore
        if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
          reject(new Error('Google Identity Services library tidak termuat. Pastikan script GIS ada di index.html'));
          return;
        }

        // @ts-ignore
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: SCOPES,
          callback: (response: any) => {
            if (response.error) {
              reject(response);
              return;
            }
            this.accessToken = response.access_token;
            resolve(response.access_token);
          },
        });
        client.requestAccessToken();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Saves data to a specific Google Sheet.
   */
  async appendData(spreadsheetId: string, range: string, values: any[][]) {
    if (!this.accessToken) {
      await this.authorize();
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: values,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message || 'Failed to append data to Google Sheets');
    }

    return response.json();
  }

  /**
   * Reads data from a specific Google Sheet.
   */
  async readData(spreadsheetId: string, range: string, valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA' = 'FORMATTED_VALUE', forceAuthorize = false) {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    
    // If we have an access token, use it (preferred)
    if (this.accessToken) {
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=${valueRenderOption}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.values;
      }
      
      // If unauthorized, maybe token expired, try to re-authorize or fallback to API key
      if (response.status === 401) {
        this.accessToken = null;
      } else {
        const error = await response.json();
        throw new Error(error.error.message || 'Failed to read data from Google Sheets');
      }
    }

    // Fallback to API key if spreadsheet is public
    if (apiKey) {
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=${valueRenderOption}&key=${apiKey}`,
        {
          method: 'GET',
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.values;
      }

      // If API key fails, and we don't want to force authorize, throw error
      if (!forceAuthorize) {
        const error = await response.json();
        throw new Error(error.error.message || 'Failed to read data from Google Sheets (Public Access)');
      }
    }

    // If no token and no API key (or forceAuthorize is true), we must authorize
    if (forceAuthorize || !apiKey) {
      await this.authorize();
      return this.readData(spreadsheetId, range, valueRenderOption, true);
    }

    throw new Error('Google Sheets access token not found and API Key not available or failed.');
  }

  /**
   * Updates data in a specific range.
   */
  async updateData(spreadsheetId: string, range: string, values: any[][]) {
    if (!this.accessToken) {
      await this.authorize();
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: values,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message || 'Failed to update data in Google Sheets');
    }

    return response.json();
  }

  /**
   * Gets the sheet ID for a given sheet name.
   */
  async getSheetIdByName(spreadsheetId: string, sheetName: string): Promise<number | null> {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;

    const fetchMetadata = async (useToken: boolean) => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties${!useToken && apiKey ? `&key=${apiKey}` : ''}`;
      const headers: any = {};
      if (useToken && this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) return null;
      return response.json();
    };

    let data = null;
    if (this.accessToken) {
      data = await fetchMetadata(true);
    }

    if (!data && apiKey) {
      data = await fetchMetadata(false);
    }

    if (!data) {
      await this.authorize();
      data = await fetchMetadata(true);
    }

    if (!data) {
      throw new Error('Failed to fetch spreadsheet metadata');
    }

    const sheet = data.sheets.find((s: any) => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : null;
  }

  /**
   * Deletes a row using batchUpdate.
   */
  async deleteRow(spreadsheetId: string, sheetId: number, rowIndex: number) {
    if (!this.accessToken) {
      await this.authorize();
    }

    const performDelete = async () => {
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1,
                  },
                },
              },
            ],
          }),
        }
      );

      if (response.status === 401) {
        this.accessToken = null;
        return null; // Signal retry
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error.message || 'Failed to delete row in Google Sheets');
      }

      return response.json();
    };

    let result = await performDelete();
    
    // Retry once if 401
    if (result === null) {
      await this.authorize();
      result = await performDelete();
      if (result === null) {
        throw new Error('Unauthorized after retry. Please reconnect your Google account.');
      }
    }

    return result;
  }

  /**
   * Deletes multiple rows using batchUpdate.
   */
  async deleteRows(spreadsheetId: string, sheetId: number, rowIndices: number[]) {
    if (!this.accessToken) {
      await this.authorize();
    }

    // Sort row indices in descending order to avoid index shifting issues
    const sortedIndices = [...rowIndices].sort((a, b) => b - a);

    const requests = sortedIndices.map(index => ({
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: 'ROWS',
          startIndex: index,
          endIndex: index + 1,
        },
      },
    }));

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: requests,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message || 'Failed to delete rows in Google Sheets');
    }

    return response.json();
  }

  /**
   * Updates multiple ranges in a single request.
   */
  async batchUpdateValues(spreadsheetId: string, data: { range: string, values: any[][] }[]) {
    if (!this.accessToken) {
      await this.authorize();
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: data,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message || 'Failed to batch update data in Google Sheets');
    }

    return response.json();
  }

  /**
   * Inserts rows using batchUpdate.
   */
  async insertRows(spreadsheetId: string, sheetId: number, startIndex: number, count: number) {
    if (!this.accessToken) {
      await this.authorize();
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: 'ROWS',
                  startIndex: startIndex,
                  endIndex: startIndex + count,
                },
                inheritFromBefore: true,
              },
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message || 'Failed to insert rows in Google Sheets');
    }

    return response.json();
  }
}

export const googleSheetsService = new GoogleSheetsService(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
export default googleSheetsService;
