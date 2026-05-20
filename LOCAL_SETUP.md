# Local Development Setup Guide

## Overview
This app requires your own Google OAuth credentials for local development. This is by design - the developer's credentials are not included in the repo for security reasons.

## Steps to Set Up Locally

### 1. Get Your Google Credentials

Follow this guide: https://developers.google.com/workspace/guides/create-credentials

When creating a new OAuth 2.0 Client:
- **Application Type**: Select "Web application"
- **Name**: Something like "WhatsApp Contact Sync - Local Dev"
  
After creation, you'll see:
- **Client ID** (copy this)
- **Client Secret** (copy this)
- **API Key** (create one in the Credentials page if you don't have it)

### 2. Register Localhost Origins

In your OAuth 2.0 Client settings, add these **Authorized JavaScript origins**:
```
http://localhost:3000
http://localhost:4000
http://localhost:4001
http://localhost:8080
```

### 3. Set Environment Variables

#### Backend (`server/.env`)
Create the file `server/.env`:
```
GOOGLE_CLIENT_ID=your_client_id_from_step_1
GOOGLE_CLIENT_SECRET=your_client_secret_from_step_1
```

#### Frontend (`web/.env.local`)
Create the file `web/.env.local`:
```
VITE_GOOGLE_CLIENT_ID=your_client_id_from_step_1
VITE_GOOGLE_API_KEY=your_api_key_from_step_1
```

### 4. Start the App

```bash
./manage.sh start
```

Then open: http://localhost:4000

### 5. Test the Flow

1. Click "Get Started"
2. Scan QR code with WhatsApp
3. Click "Authorize Google"
4. You should now be able to authorize without the "origin_mismatch" error

## Troubleshooting

**Still getting "origin_mismatch" error?**
- Make sure you've added `http://localhost:4000` to your OAuth 2.0 Client's "Authorized JavaScript origins" in Google Cloud Console
- Wait a few minutes for the changes to propagate
- Clear browser cache and try again

**Backend won't authenticate?**
- Verify `.env` file exists in `server/` directory
- Check that `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` match your Google Cloud Console credentials
- Restart the app: `./manage.sh restart`

**Port already in use?**
- The manage.sh script automatically kills processes on port 4000
- For other ports, find and kill manually: `lsof -ti:PORT_NUMBER | xargs kill -9`

