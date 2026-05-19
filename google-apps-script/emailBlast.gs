/**
 * Deploy this file as a Google Apps Script Web App from
 * keuangan.kanwilmks@gmail.com.
 *
 * Deployment:
 * 1. Apps Script > Deploy > New deployment > Web app.
 * 2. Execute as: Me.
 * 3. Who has access: Anyone with the link, or your organization.
 * 4. Copy the Web App URL into VITE_EMAIL_BLAST_WEB_APP_URL.
 */

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (payload.action === 'quota') {
      return jsonResponse({
        success: true,
        remainingDailyQuota: MailApp.getRemainingDailyQuota(),
        sentToday: getSentToday()
      });
    }

    if (payload.action === 'send') {
      var messages = Array.isArray(payload.messages) ? payload.messages : [];
      var sent = 0;
      var failed = [];

      messages.forEach(function(message) {
        try {
          GmailApp.sendEmail(
            message.to,
            message.subject,
            message.plainBody || stripHtml(message.htmlBody || ''),
            {
              htmlBody: message.htmlBody || '',
              name: payload.senderName || 'Keuangan Kanwil VI'
            }
          );
          sent += 1;
        } catch (err) {
          failed.push({
            to: message.to,
            cabang: message.cabang,
            message: String(err && err.message ? err.message : err)
          });
        }
      });

      incrementSentToday(sent);

      return jsonResponse({
        success: failed.length === 0,
        sent: sent,
        failed: failed,
        remainingDailyQuota: MailApp.getRemainingDailyQuota(),
        sentToday: getSentToday()
      });
    }

    return jsonResponse({ success: false, message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({
      success: false,
      message: String(err && err.message ? err.message : err)
    });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSentTodayKey() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return 'sent:' + today;
}

function getSentToday() {
  var props = PropertiesService.getScriptProperties();
  return Number(props.getProperty(getSentTodayKey()) || '0');
}

function incrementSentToday(count) {
  if (!count) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = getSentTodayKey();
    var current = Number(props.getProperty(key) || '0');
    props.setProperty(key, String(current + count));
  } finally {
    lock.releaseLock();
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
