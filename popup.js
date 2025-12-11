// popup.js
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadCodes();

    document.getElementById('auth-btn').addEventListener('click', () => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
                updateStatus("Error: " + chrome.runtime.lastError.message, true);
            } else {
                updateStatus("Connected & Protecting!", false);
                // Trigger a manual check
                // chrome.runtime.sendMessage({ action: "manual_check" });
            }
        });
    });
});

function updateStatus(msg, isError) {
    const el = document.getElementById('status');
    el.innerText = msg;
    el.className = isError ? 'status error' : 'status';
    document.getElementById('auth-btn').style.display = isError || msg.includes("Checking") ? 'block' : 'none';
}

function checkAuth() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
            updateStatus("Not Connected. Please Sign In.", true);
        } else {
            updateStatus("Active", false);
        }
    });
}

function loadCodes() {
    chrome.storage.local.get("recentCodes", (data) => {
        const list = document.getElementById('code-list');
        list.innerHTML = "";
        const codes = data.recentCodes || [];

        if (codes.length === 0) {
            list.innerHTML = "<li style='color:#999'>No recent codes detected.</li>";
            return;
        }

        codes.slice(0, 5).forEach(c => {
            const li = document.createElement('li');
            const time = new Date(c.timestamp).toLocaleTimeString();
            li.innerHTML = `<span><strong>${c.code}</strong></span> <span>${time}</span>`;
            list.appendChild(li);
        });
    });
}
