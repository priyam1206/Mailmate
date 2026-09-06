const { google } = require('googleapis');
const { createOAuthClient } = require('../config/google');

function decodeBody(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractMessageBody(payload) {
  if (!payload) return '';
  const parts = payload.parts || [];
  const plainPart = parts.find(part => part.mimeType === 'text/plain' && part.body?.data);
  if (plainPart) return decodeBody(plainPart.body.data).trim();

  for (const part of parts) {
    const nested = extractMessageBody(part);
    if (nested) return nested;
  }

  if (payload.body?.data) {
    const decoded = decodeBody(payload.body.data);
    if (payload.mimeType === 'text/html') {
      return decoded
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
    }
    return decoded.trim();
  }

  return '';
}

async function fetchUserEmails(tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const maxResults = Number(process.env.GMAIL_FETCH_LIMIT || 20);

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: process.env.GMAIL_QUERY || 'newer_than:30d'
    });

    const messages = response.data.messages || [];
    
    if (messages.length === 0) {
      return [];
    }

    // Fetch full details for each message
    const detailedEmails = await Promise.all(
      messages.map(async (msg) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          });
          
          const headers = detail.data.payload?.headers || [];
          const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
          const sender = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
          const receiver = headers.find(h => h.name.toLowerCase() === 'to')?.value || '';
          const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
          const snippet = detail.data.snippet || '';
          const body = extractMessageBody(detail.data.payload) || snippet;

          return {
            id: msg.id,
            threadId: detail.data.threadId,
            sender,
            receiver,
            subject,
            date,
            snippet,
            body,
            labels: detail.data.labelIds || [],
            is_read: !(detail.data.labelIds || []).includes('UNREAD'),
            is_starred: (detail.data.labelIds || []).includes('STARRED')
          };
        } catch (err) {
          console.warn(`Failed to fetch message ID ${msg.id}:`, err.message);
          return null;
        }
      })
    );

    // Filter out any null responses from failed message fetches
    return detailedEmails.filter(email => email !== null);
  } catch (error) {
    console.error('Error inside gmailService:', error.message || error);
    throw error;
  }
}

module.exports = { fetchUserEmails };
