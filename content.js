// content.js
console.log("Gmail OTP Magic: Content script loaded.");

let currentInput = null;
let pollInterval = null;

// Listen for focus on input fields
document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (isPotentialOTPInput(target)) {
        currentInput = target;
        currentInput.dataset.focusTime = Date.now(); // Mark when we started looking

        // Notify background to start high-freq polling
        try {
            chrome.runtime.sendMessage({ action: "start_polling" });
        } catch (e) {
            console.log("Extension context invalidated (likely reloaded). Please refresh the page.");
        }

        // Show bubble if we already have a code or just the 'waiting' state
        showBubble(target);
    }
}, true);

document.addEventListener('focusout', (e) => {
    // Optional cleanup
}, true);

// Listen for OTPs from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "otp_detected") {
        console.log("OTP Received:", request.code, "Time:", request.timestamp);

        if (currentInput) {
            // Freshness Check:
            // The OTP email timestamp (request.timestamp) must be AFTER or barely before
            // the time we focused the input (currentInput.dataset.focusTime).
            // User requirement: "not from a time stamp that is like over 15 secs or sm before the current OTP box even comes up"

            const focusTime = parseInt(currentInput.dataset.focusTime || 0);
            const emailTime = parseInt(request.timestamp);

            // Allow a 15-second grace period (e.g. email arrived 10s before you clicked the box)
            // But block emails that arrived 2 mins ago.
            const cutoff = focusTime - 15000;

            if (emailTime < cutoff) {
                console.warn("Skipping old OTP. Email Time:", new Date(emailTime), "Focus Time:", new Date(focusTime));
                return;
            }

            updateBubbleWithCode(request.code);
            pulseBubble();
        }
    }
});

function isPotentialOTPInput(input) {
    if (input.tagName !== 'INPUT') return false;
    const type = input.type;
    const ignoredTypes = ['submit', 'button', 'checkbox', 'radio', 'file', 'hidden', 'image', 'color', 'range'];
    if (ignoredTypes.includes(type)) return false;

    // Heuristics: Check name, id, placeholder, label
    const attributes = [input.name, input.id, input.placeholder, input.className].join(' ').toLowerCase();
    const keywords = ['code', 'otp', 'verification', '2fa', 'token', 'passcode'];

    // Also strict number inputs often used for OTP
    if (type === 'number' || type === 'tel') return true;

    return keywords.some(k => attributes.includes(k));
}

let bubbleElement = null;

function showBubble(input) {
    if (bubbleElement) bubbleElement.remove();

    bubbleElement = document.createElement('div');
    bubbleElement.id = 'gmail-otp-bubble';
    bubbleElement.className = 'gmail-otp-bubble-enter';

    // Initial State: "Waiting for code..." or just a logo?
    // User wants "Magic". Let's show "Listening for Gmail..." 
    bubbleElement.innerHTML = `
        <div class="otp-status">
            <span class="otp-icon">✉️</span> 
            <span class="otp-text">Listening for OTP...</span>
        </div>
        <div class="otp-actions">
           <button id="otp-history-btn" title="Recent Codes">🕒</button>
        </div>
    `;

    document.body.appendChild(bubbleElement);
    positionBubble(input);

    // Initial check for recent codes
    chrome.runtime.sendMessage({ action: "get_recent_codes" }, (response) => {
        if (response && response.codes && response.codes.length > 0) {
            // If the latest code is very fresh (<2 mins), suggest it immediately
            const latest = response.codes[0];
            const age = (Date.now() - latest.id) / 1000; // seconds
            if (age < 120) {
                updateBubbleWithCode(latest.code);
            }
        }
    });

    // Bind History Button
    document.getElementById('otp-history-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        showHistoryModal();
    });
}

function updateBubbleWithCode(code) {
    if (!bubbleElement) return;

    const statusDiv = bubbleElement.querySelector('.otp-status');
    statusDiv.innerHTML = `
        <span class="otp-icon">✨</span> 
        <span class="otp-text">Paste: <b>${code}</b></span>
    `;
    statusDiv.classList.add('otp-clickable');

    // Remove old listeners to avoid dupes
    const content = statusDiv.cloneNode(true);
    statusDiv.parentNode.replaceChild(content, statusDiv);

    content.addEventListener('click', () => {
        fillInput(currentInput, code);
    });
}

function fillInput(input, code) {
    if (!input) return;

    // 1. Focus the input first
    input.focus();

    // 2. Try the modern 'insertText' command (most reliable for mimic-ing user typing)
    const success = document.execCommand('insertText', false, code);

    // 3. Fallback for React/Angular/Vue if execCommand didn't work or wasn't enough
    if (!success || input.value !== code) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeInputValueSetter.call(input, code);

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // UI Feedback
    if (bubbleElement) {
        bubbleElement.innerHTML = `<span class="otp-success">✓ Pasted!</span>`;
        setTimeout(() => bubbleElement.remove(), 1000);
    }
}

function positionBubble(input) {
    if (!bubbleElement) return;
    const rect = input.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // Position above the input, aligned left
    bubbleElement.style.top = `${rect.top + scrollTop - 50}px`;
    bubbleElement.style.left = `${rect.left}px`;
}

function pulseBubble() {
    if (bubbleElement) {
        bubbleElement.classList.remove('otp-pulse');
        void bubbleElement.offsetWidth; // trigger reflow
        bubbleElement.classList.add('otp-pulse');
    }
}

function showHistoryModal() {
    chrome.runtime.sendMessage({ action: "get_recent_codes" }, (response) => {
        const codes = response.codes || [];
        // Create modal UI
        const modal = document.createElement('div');
        modal.id = 'otp-history-modal';

        let listHtml = codes.slice(0, 3).map(c => {
            const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `<div class="otp-history-item" data-code="${c.code}">
                <span class="otp-hist-code">${c.code}</span>
                <span class="otp-hist-time">${time}</span>
            </div>`;
        }).join('');

        if (codes.length === 0) listHtml = '<div class="otp-empty">No recent codes found.</div>';

        modal.innerHTML = `
            <div class="otp-modal-content">
                <h3>Recent Codes</h3>
                <div class="otp-list">${listHtml}</div>
                <button id="otp-close-modal">Close</button>
            </div>
        `;

        document.body.appendChild(modal);

        // Listeners
        modal.querySelectorAll('.otp-history-item').forEach(item => {
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                fillInput(currentInput, code);
                modal.remove();
            });
        });

        document.getElementById('otp-close-modal').addEventListener('click', () => modal.remove());
    });
}
