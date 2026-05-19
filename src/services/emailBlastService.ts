export interface BlastEmailMessage {
  to: string;
  subject: string;
  plainBody: string;
  htmlBody: string;
  cabang: string;
  tanggal: string;
  totalNominal: number;
  totalTransaksi: number;
}

export interface EmailQuotaInfo {
  remainingDailyQuota: number | null;
  sentToday: number;
}

const getEndpoint = () => import.meta.env.VITE_EMAIL_BLAST_WEB_APP_URL || '';

const postToAppsScript = async (payload: Record<string, any>) => {
  const endpoint = getEndpoint();
  if (!endpoint) {
    throw new Error('VITE_EMAIL_BLAST_WEB_APP_URL belum dikonfigurasi');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || 'Gagal menghubungi Google Apps Script');
  }

  return data;
};

export const emailBlastService = {
  async getQuota(): Promise<EmailQuotaInfo> {
    const data = await postToAppsScript({ action: 'quota' });
    return {
      remainingDailyQuota: typeof data.remainingDailyQuota === 'number' ? data.remainingDailyQuota : null,
      sentToday: Number(data.sentToday || 0),
    };
  },

  async sendEmails(messages: BlastEmailMessage[]) {
    return postToAppsScript({
      action: 'send',
      senderName: 'Keuangan Kanwil VI',
      messages,
    });
  },
};
