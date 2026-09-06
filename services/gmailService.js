const { google } = require('googleapis');
const oauth2Client = require('../config/google');

async function fetchUserEmails(tokens) {
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 100 // Adjust this limit to control how many total emails are retrieved
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
          const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
          const snippet = detail.data.snippet || '';

          return {
            id: msg.id,
            threadId: detail.data.threadId,
            sender,
            subject,
            date,
            snippet
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