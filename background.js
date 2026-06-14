// background.js

// 存储每个标签页的禁用状态
// 也可以直接用 chrome.storage.local，但用 Map 更轻量
const disabledTabs = new Map();

// 获取指定标签页的禁用状态
function isDisabled(tabId) {
  return disabledTabs.get(tabId) === true;
}

// 设置禁用状态，并保存到 storage 中持久化
async function setDisabled(tabId, disabled) {
  disabledTabs.set(tabId, disabled);
  await chrome.storage.local.set({ [`disabled_${tabId}`]: disabled });
}

// 从 storage 恢复所有标签页状态（扩展启动时调用）
async function restoreStates() {
  const items = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith('disabled_')) {
      const tabId = parseInt(key.slice(9), 10);
      disabledTabs.set(tabId, value === true);
    }
  }
}
restoreStates();

// 监听标签页关闭，清理内存
chrome.tabs.onRemoved.addListener((tabId) => {
  disabledTabs.delete(tabId);
});

// 监听来自 popup 或 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // popup 请求当前标签页状态
  if (message.type === 'getDisabled') {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    if (tabId) {
      sendResponse({ disabled: isDisabled(tabId) });
    } else {
      sendResponse({ disabled: false });
    }
    return true;
  }

  // popup 切换状态
  if (message.type === 'toggleDisabled') {
    const tabId = message.tabId;
    if (!tabId) return;
    const newDisabled = !isDisabled(tabId);
    setDisabled(tabId, newDisabled).then(() => {
      // 通知该标签页的 content script 状态变化
      chrome.tabs.sendMessage(tabId, { action: newDisabled ? 'disable' : 'enable' })
        .catch(err => console.log('Content script not ready', err));
      sendResponse({ disabled: newDisabled });
    });
    return true; // 异步响应
  }

  // content script 请求初始状态
  if (message.type === 'getInitialState') {
    const tabId = sender.tab.id;
    sendResponse({ disabled: isDisabled(tabId) });
    return true;
  }
});