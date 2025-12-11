// background.js

let pollingIntervalId = null;
const HIGH_FREQ_POLL = 5000; // 5 seconds

// We will load processed IDs from storage to persist across service worker restarts
let processedMessageIds = new Set();

chrome.runtime.onInstalled.addListener(() => {
    console.log("Gmail OTP Magic: Installed");
    chrome.storage.local.set({ recentCodes: [] });
});

// Load processed IDs on startup
chrome.storage.local.get("processedIds", (data) => {
    if (data.processedIds) {
        processedMessageIds = new Set(data.processedIds);
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_polling") {
        // console.log("High frequency polling started");
        startPolling(HIGH_FREQ_POLL);
    } else if (request.action === "stop_polling") {
        // console.log("Stopping polling.");
        stopPolling();
    } else if (request.action === "get_recent_codes") {
        chrome.storage.local.get("recentCodes", (data) => {
            sendResponse({ codes: data.recentCodes || [] });
        });
        return true;
    } else if (request.action === "manual_check") {
        checkEmails();
    }
});

function startPolling(interval) {
    if (pollingIntervalId) clearInterval(pollingIntervalId);
    checkEmails(); // Check immediately
    pollingIntervalId = setInterval(checkEmails, interval);
}

function stopPolling() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

async function checkEmails() {
    try {
        const token = await getAuthToken();
        if (!token) return;

        const messages = await listMessages(token);
        if (!messages || messages.length === 0) return;

        let newCodesFound = false;

        for (const msg of messages) {
            if (processedMessageIds.has(msg.id)) continue;

            processedMessageIds.add(msg.id);
            newCodesFound = true;

            const details = await getMessageDetails(token, msg.id);
            const subject = details.payload.headers.find(h => h.name === 'Subject')?.value || '';
            const bodySnippet = details.snippet || '';
            const fullText = subject + " " + bodySnippet;

            const otp = extractOTP(fullText);

            if (otp) {
                console.log("OTP Found:", otp);
                saveOTP(otp, details.internalDate, msg.id);
                broadcastOTP(otp, details.internalDate);
            }
        }

        // Update storage with new processed IDs
        if (newCodesFound) {
            if (processedMessageIds.size > 200) {
                const arr = Array.from(processedMessageIds);
                processedMessageIds = new Set(arr.slice(arr.length - 100));
            }
            chrome.storage.local.set({ processedIds: Array.from(processedMessageIds) });
        }

    } catch (error) {
        console.error("Error checking emails:", error);
        if (error.message && error.message.includes("401")) {
            chrome.identity.removeCachedAuthToken({ token: await getAuthToken() }, () => { });
        }
    }
}

function getAuthToken() {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            } else {
                resolve(token);
            }
        });
    });
}

async function listMessages(token) {
    // Look back 5 minutes
    const fiveMinutesAgo = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);

    // Broad search for potential OTP emails
    const q = `after:${fiveMinutesAgo} (code OR verification OR otp OR password OR login OR pin OR secret)`;

    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=10`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) throw new Error("401 Unauthorized");

    const data = await response.json();
    return data.messages || [];
}

async function getMessageDetails(token, messageId) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return await response.json();
}

/**
 * Smart Heuristic Parsing for OTPs (Alphanumeric Support)
 */
function extractOTP(text) {
    if (!text) return null;

    const cleanText = text.replace(/\s+/g, ' ');

    // Regex for Alphanumeric codes (e.g. A123, 12AB45, G-123456)
    // - Must be 4-8 chars
    // - Must contain at least one digit (usually)
    // - Allow hyphens but strip them later?
    // Let's look for uppercase alphanumeric strings of length 4-8.
    // Exclude common words by ensuring mixed digits or context.

    // Simple robust approach: Look for standalone uppercase/digit strings
    const matches = cleanText.matchAll(/\b([A-Z0-9]{4,8})\b/g);
    const candidates = [];

    for (const match of matches) {
        const val = match[1];
        // Heuristic: Pure strings like "CODE" or "VERIFY" are bad candidates.
        // Good candidate has >1 digit OR is widely mixed.
        // Let's be permissive and filter by score.
        candidates.push({
            value: val,
            index: match.index,
            score: 0
        });
    }

    if (candidates.length === 0) return null;

    candidates.forEach(c => {
        const val = c.value;
        const prevText = cleanText.substring(Math.max(0, c.index - 30), c.index).toLowerCase();

        // 1. Context Boost
        if (/code|otp|pin|verification|password|secret/.test(prevText)) c.score += 10;
        if (/is|:|is\:/.test(prevText)) c.score += 5;

        // 2. Format Boost
        // Contains digits?
        if (/\d/.test(val)) c.score += 5;
        // Contains letters?
        if (/[A-Z]/.test(val)) c.score += 2;

        // 3. Year Penalty
        const currentYear = new Date().getFullYear();
        if (val === currentYear.toString() || val === (currentYear + 1).toString()) c.score -= 20;

        // 4. Word Penalty (if it's just letters and a real word like "VOID")
        // "KAYAK" bug fix: If it has NO digits, we penalty HEAVILY unless context is explicit "Code is: APPL"
        if (!/\d/.test(val)) {
            // If completely uppercase letters, it's likely a brand name (KAYAK, GOOGLE)
            // Only allow if preceeded by "code:" or "otp"
            if (/code|otp|pin|passcode/.test(prevText)) {
                c.score -= 2; // Slight penalty
            } else {
                c.score -= 50; // Kill it. Brand names shouldn't be OTPs.
            }
        }

        // 5. Repetition Penalty
        if (/^([A-Z0-9])\1+$/.test(val)) c.score -= 2;
    });

    candidates.sort((a, b) => b.score - a.score);
    const bestCandidate = candidates[0];

    // Threshold: Score > 0 implies it has at least some numeric content or massive context
    if (bestCandidate.score > 0) {
        return bestCandidate.value;
    }

    return null;
}

function saveOTP(code, timestamp, messageId) {
    chrome.storage.local.get("recentCodes", (data) => {
        let codes = data.recentCodes || [];
        if (codes.some(c => c.messageId === messageId)) return;

        codes.unshift({
            code,
            timestamp: parseInt(timestamp),
            messageId,
            id: Date.now()
        });

        codes.sort((a, b) => b.timestamp - a.timestamp);
        if (codes.length > 10) codes = codes.slice(0, 10);

        chrome.storage.local.set({ recentCodes: codes });
    });
}

function broadcastOTP(code, timestamp) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "otp_detected",
                code,
                timestamp: timestamp // Pass email timestamp to content script
            });
        }
    });
}
