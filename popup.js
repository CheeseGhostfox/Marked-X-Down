// popup.js

async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

async function updateUI() {
  const tabId = await getCurrentTabId();
  // 向 background 查询当前标签页的禁用状态
  const response = await chrome.runtime.sendMessage({ type: 'getDisabled', tabId });
  const disabled = response.disabled;
  const btn = document.getElementById('toggleBtn');
  const statusDiv = document.getElementById('status');
  if (disabled) {
    btn.textContent = 'Enable on this page';
    statusDiv.textContent = 'Parsing is OFF';
  } else {
    btn.textContent = 'Disable on this page';
    statusDiv.textContent = 'Parsing is ON';
  }
}

document.getElementById('toggleBtn').addEventListener('click', async () => {
  const tabId = await getCurrentTabId();
  const response = await chrome.runtime.sendMessage({ type: 'toggleDisabled', tabId });
  const newDisabled = response.disabled;
  const btn = document.getElementById('toggleBtn');
  const statusDiv = document.getElementById('status');
  if (newDisabled) {
    btn.textContent = 'Enable on this page';
    statusDiv.textContent = 'Parsing is OFF';
  } else {
    btn.textContent = 'Disable on this page';
    statusDiv.textContent = 'Parsing is ON';
  }
});

// 初始化 UI
updateUI();