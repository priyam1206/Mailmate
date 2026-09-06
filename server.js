const express = require('express');
const cors = require('cors');
const oauth2Client = require('./config/google');
const { fetchUserEmails } = require('./services/gmailService');
const { analyzeEmailsWithAI } = require('./services/aiService');
require('dotenv').config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

let userTokens = null; // Session storage for hackathon testing

// Route 1: Redirect user to Google OAuth page
app.get('/auth/google', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  res.redirect(url);
});

// Route 2: OAuth Callback
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    userTokens = tokens;
    res.redirect(`${process.env.FRONTEND_URL}?connected=true`);
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Authentication failed');
  }
});

// Route 3: Dashboard API Endpoint for Frontend
app.get('/api/dashboard/overview', async (req, res) => {
  if (!userTokens) {
    return res.status(401).json({ error: 'User not authenticated with Gmail' });
  }

  try {
    const rawEmails = await fetchUserEmails(userTokens);
    const aiAnalysis = await analyzeEmailsWithAI(rawEmails);

    res.json({
      metrics: {
        emails: aiAnalysis?.total_emails || rawEmails.length,
        important: aiAnalysis?.important_count || 0,
        actions: aiAnalysis?.action_items_count || 0
      },
      needs_attention: aiAnalysis?.needs_attention || [],
      ai_insight: aiAnalysis?.ai_insight || "No urgent emails found."
    });
  } catch (error) {
    console.error('Dashboard Endpoint Error:', error);
    res.status(500).json({ error: 'Failed to process email insights.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});