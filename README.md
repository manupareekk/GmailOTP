# Gmail OTP Magic ✨

A smart Chrome Extension that automatically detects One-Time Passwords (OTPs) from your Gmail and offers to paste them directly into your current tab.

## Features 🚀

*   **Smart Detection**: Identifies OTPs using heuristics (checks for "Code:", "Verification:", etc.) and ignores years/phone numbers.
*   **Alphanumeric Support**: Works with 6-digit codes, 4-digit pins, and alphanumeric codes (e.g. `G-123456`).
*   **Freshness Check**: Only suggests codes that arrived *after* (or just before) you clicked the input field. No more old stale codes!
*   **Brand Filtering**: Intelligent logic to ignore uppercase brand names (e.g. "KAYAK") unless explicitly identified as a code.
*   **Auto-Paste**: One-click paste using simulated user input events for maximum compatibility.

## Installation 🛠️

### 1. Clone the Repo
```bash
git clone https://github.com/yourusername/gmail-otp-magic.git
```

### 2. Google Cloud Setup (Required)
Because this extension reads your Gmail, you must generate your *own* Client ID. This keeps your data private and secure (only YOU have access).

1.  Go to [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a Project name "GmailOTP".
3.  Enable **Gmail API**.
4.  Configure **OAuth Consent Screen** (Select 'External' -> Add 'userinfo.email' scope -> Add yourself as Test User).
5.  Create **Credentials** -> **OAuth Client ID** -> **Chrome Extension**.
6.  Need the Extension ID?
    *   Load this extension in Chrome first (see below).
    *   Copy the ID (e.g., `abcdef...`) from `chrome://extensions`.
    *   Paste it into the Google Cloud "Item ID" field.

### 3. Configure the Extension
1.  Open `manifest.json` in this folder.
2.  Replace `"YOUR_CLIENT_ID_HERE.apps.googleusercontent.com"` with the Client ID you just generated.
3.  Save the file.

### 4. Load in Chrome
1.  Go to `chrome://extensions`.
2.  Enable **Developer Mode** (top right).
3.  Click **Load Unpacked**.
4.  Select this folder.
5.  Click the extension icon and **Sign In**.

## Privacy 🔒
This extension runs entirely in your browser.
*   No data is sent to any external server (other than Google's official Gmail API).
*   Your emails are processed locally to find the OTPs.

## License
MIT
