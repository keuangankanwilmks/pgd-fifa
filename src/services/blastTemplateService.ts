import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const templateDocRef = () => doc(db, 'app_settings', 'blast_email_template');
const whatsappTemplateDocRef = () => doc(db, 'app_settings', 'blast_whatsapp_template');

export const defaultBlastEmailTemplate = `
<div style="font-family: Arial, sans-serif; color: #1f2937; background: #f3f7f5; padding: 24px;">
  <div style="max-width: 760px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #dbe7e2;">
    <div style="background: #005245; color: #ffffff; padding: 22px 26px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1.6px; color: #b7f3d2;">FIFA - Hutang Operasional Lain</div>
      <h1 style="margin: 8px 0 0; font-size: 22px;">Notifikasi Transaksi Cabang</h1>
    </div>
    <div style="padding: 24px 26px;">
      <p style="margin: 0 0 14px;">Yth. Pimpinan/Tim Cabang <strong>{{cabang}}</strong>,</p>
      <p style="margin: 0 0 18px; line-height: 1.6;">Berikut kami sampaikan informasi Hutang Operasional Lain berstatus <strong>Belum</strong> untuk tanggal <strong>{{tanggal}}</strong>.</p>
      <div style="display: table; width: 100%; margin: 18px 0; border-collapse: separate; border-spacing: 10px 0;">
        <div style="display: table-cell; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px;">
          <div style="font-size: 11px; color: #047857; text-transform: uppercase; font-weight: 700;">Jumlah Transaksi</div>
          <div style="font-size: 22px; font-weight: 800; margin-top: 4px;">{{jumlahTransaksi}}</div>
        </div>
        <div style="display: table-cell; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 14px;">
          <div style="font-size: 11px; color: #1d4ed8; text-transform: uppercase; font-weight: 700;">Total Nominal</div>
          <div style="font-size: 22px; font-weight: 800; margin-top: 4px;">{{totalNominal}}</div>
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px;">
        <thead>
          <tr style="background: #005245; color: #ffffff;">
            <th style="padding: 10px; text-align: left;">No</th>
            <th style="padding: 10px; text-align: left;">AKUN (Db)</th>
            <th style="padding: 10px; text-align: right;">Nominal</th>
            <th style="padding: 10px; text-align: left;">Keterangan</th>
          </tr>
        </thead>
        <tbody>{{detailRows}}</tbody>
      </table>
      <p style="margin: 22px 0 0; line-height: 1.6;">Mohon dilakukan pengecekan dan tindak lanjut sesuai ketentuan yang berlaku.</p>
      <p style="margin: 18px 0 0;">Terima kasih.</p>
      <p style="margin: 18px 0 0;"><strong>Tim Keuangan Kanwil VI</strong><br/>keuangan.kanwilmks@gmail.com</p>
    </div>
  </div>
</div>
`.trim();

export const defaultBlastWhatsAppTemplate = `
Yth. {{1}},
Terdapat transaksi Hutang Operasional Lain tanggal {{2}}.

Jumlah transaksi: {{3}}
Total nominal: {{4}}

Rincian transaksi:
{{5}}

Mohon dilakukan pengecekan dan tindak lanjut sesuai ketentuan. Terima kasih.
By Keuangan
`.trim();

export const blastTemplateService = {
  async getTemplate() {
    const snapshot = await getDoc(templateDocRef());
    const html = snapshot.exists() ? snapshot.data().html : '';
    return typeof html === 'string' && html.trim() ? html : defaultBlastEmailTemplate;
  },

  async saveTemplate(html: string) {
    await setDoc(templateDocRef(), {
      html,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  },

  async getWhatsAppTemplate() {
    const snapshot = await getDoc(whatsappTemplateDocRef());
    const text = snapshot.exists() ? snapshot.data().text : '';
    return typeof text === 'string' && text.trim() ? text : defaultBlastWhatsAppTemplate;
  },

  async saveWhatsAppTemplate(text: string) {
    await setDoc(whatsappTemplateDocRef(), {
      text,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  },
};
