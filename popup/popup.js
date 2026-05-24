/*

CONNECT DIRECTLY TO THE FASTAPI BACKEND

const ws = new WebSocket("ws://localhost:8000/ws/extension-client");

ws.onmessage = (event) => {
    document.getElementById('messages').innerText += event.data + '\n';
};

document.getElementById('sendBtn').addEventListener('click', () => {
    const input = document.getElementById('inputBox').value;
    ws.send(input);
});

*/



console.log('[UC] popup: loaded');

const btn = document.getElementById('toggle-btn');
let isCapturing = false;

// Restore persisted state so the button reflects reality if the popup is re-opened
chrome.storage.local.get('capturing', ({ capturing }) => {
  console.log('[UC] popup: restored state', { capturing });
  isCapturing = !!capturing;
  syncButton();
});

btn.addEventListener('click', async () => {
  console.log('[UC] popup: button clicked, isCapturing =', isCapturing);
  btn.disabled = true; // prevent double-clicks while the service worker responds

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[UC] popup: active tab', tab?.id, tab?.url);

  if (!isCapturing) {
    console.log('[UC] popup: sending action=start for tabId', tab.id);
    chrome.runtime.sendMessage({ action: 'start', tabId: tab.id }, (response) => {
      console.log('[UC] popup: start response', response);
      if (response?.ok) {
        isCapturing = true;
        chrome.storage.local.set({ capturing: true });
        syncButton();
      } else {
        console.error('[UC] popup: start failed', response?.error);
        btn.disabled = false;
      }
    });
  } else {
    console.log('[UC] popup: sending action=stop');
    chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
      console.log('[UC] popup: stop response', response);
      isCapturing = false;
      chrome.storage.local.set({ capturing: false });
      syncButton();
    });
  }
});

function syncButton() {
  btn.disabled    = false;
  btn.textContent = isCapturing ? 'Stop Captions' : 'Start Captions';
  btn.classList.toggle('active', isCapturing);
  console.log('[UC] popup: syncButton() →', btn.textContent);
}
