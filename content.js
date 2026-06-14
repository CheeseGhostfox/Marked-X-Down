// content.js

// ==================== 新增：禁用/启用控制 ====================
let enabled = true;                 // 当前页面解析是否启用
let observer = null;               // MutationObserver 实例
let isReversionRunning = false;    // 防止 revertAll 递归调用

// 恢复所有已解析的内容，还原原始 tweet
function revertAll() {
  if (isReversionRunning) return;
  isReversionRunning = true;

  // 查找所有被我们替换的 tweet
  const containers = document.querySelectorAll('.x-md-container');
  containers.forEach(container => {
    // 找到原始 tweet 节点（隐藏的那个）
    const originalTweet = container.previousElementSibling;
    if (originalTweet && originalTweet.getAttribute && originalTweet.getAttribute('data-testid') === 'tweetText') {
      // 恢复显示原始节点
      originalTweet.style.display = '';
      // 移除我们添加的容器
      container.remove();
      // 清除已处理标记，以便重新启用时可以重新解析
      delete originalTweet.dataset.markdownProcessed;
    }
  });

  isReversionRunning = false;
}

// 重新解析当前页面所有未处理的 tweet（当启用时）
function reparseAll() {
  if (!enabled) return;
  document.querySelectorAll('[data-testid="tweetText"]').forEach(tweetNode => {
    // 如果 tweet 节点没有被处理过（没有标记，且没有相邻的 .x-md-container）
    const nextSibling = tweetNode.nextElementSibling;
    const alreadyProcessed = tweetNode.dataset.markdownProcessed === 'true' ||
                             (nextSibling && nextSibling.classList && nextSibling.classList.contains('x-md-container'));
    if (!alreadyProcessed) {
      processTweet(tweetNode);
    }
  });
}

// 初始化状态：向 background 查询当前标签页的禁用设置
async function initState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getInitialState' });
    const disabled = response.disabled;
    enabled = !disabled;
    if (!enabled) {
      // 如果初始状态是禁用，则立即恢复所有已解析的内容
      revertAll();
    } else {
      // 确保启用状态下重新解析可能遗漏的 tweet
      reparseAll();
    }
  } catch (err) {
    console.error('Failed to get initial state:', err);
  }
}

// 监听来自 background 的切换消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'disable') {
    if (enabled) {
      enabled = false;
      revertAll();
    }
    sendResponse({ status: 'disabled' });
  } else if (request.action === 'enable') {
    if (!enabled) {
      enabled = true;
      reparseAll();
    }
    sendResponse({ status: 'enabled' });
  }
  return true;
});

// ==================== 原有函数（稍作调整） ====================

// Set marked.js options
if (typeof marked !== 'undefined') {
    marked.setOptions({
        gfm: true,
        breaks: true,
        sanitize: false
    });
}

function renderMath(text, clonesMap) {
    if (typeof katex === 'undefined') return text;
    
    const delimiters = [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
    ];

    let res = text;
    for (const delim of delimiters) {
        let startIndex = 0;
        while ((startIndex = res.indexOf(delim.left, startIndex)) !== -1) {
            if (startIndex > 0 && res[startIndex - 1] === '\\') {
                startIndex += delim.left.length;
                continue;
            }
            const endIndex = res.indexOf(delim.right, startIndex + delim.left.length);
            if (endIndex === -1) break;
            if (res[endIndex - 1] === '\\') {
                startIndex = endIndex + delim.right.length;
                continue;
            }
            const mathStr = res.substring(startIndex + delim.left.length, endIndex);
            try {
                const html = katex.renderToString(mathStr, {
                    displayMode: delim.display,
                    throwOnError: false
                });
                const id = `XMDTOKEN${Math.random().toString(36).substr(2, 9)}X${clonesMap.size}X`;
                clonesMap.set(id, html);
                res = res.substring(0, startIndex) + id + res.substring(endIndex + delim.right.length);
                startIndex += id.length;
            } catch (e) {
                startIndex += delim.left.length;
            }
        }
    }
    res = res.replace(/\\(\$|\\\[|\\\]|\\\(|\\\))/g, '$1');
    return res;
}

function processTweet(tweetNode) {
    // 新增：如果全局禁用，则不处理
    if (!enabled) return;
    if (tweetNode.dataset.markdownProcessed === "true") return;

    tweetNode.dataset.markdownProcessed = "true";

    const isLatexed = /#latexed/i.test(tweetNode.textContent);
    let text = "";
    const clonesMap = new Map();

    function walk(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.nodeValue;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.tagName === 'A') {
                    if (isLatexed && child.textContent.trim().startsWith('$')) {
                        walk(child);
                        continue;
                    }
                    const id = `XMDTOKEN${Math.random().toString(36).substr(2, 9)}X${clonesMap.size}X`;
                    clonesMap.set(id, child.outerHTML);
                    text += id;
                } else if (child.tagName === 'IMG' ||
                           child.getAttribute('role') === 'button' ||
                           child.hasAttribute('tabindex')) {
                    const id = `XMDTOKEN${Math.random().toString(36).substr(2, 9)}X${clonesMap.size}X`;
                    clonesMap.set(id, child.outerHTML);
                    text += id;
                } else if (child.tagName === 'BR') {
                    text += "\n";
                } else {
                    walk(child);
                }
            }
        }
    }

    walk(tweetNode);
    if (!text.trim()) return;

    if (isLatexed) {
        text = renderMath(text, clonesMap);
    }

    let parsedHtml = "";
    try {
        parsedHtml = marked.parse(text);
    } catch (e) {
        console.error("Markdown parsing failed:", e);
        return;
    }

    for (const [token, html] of clonesMap.entries()) {
        parsedHtml = parsedHtml.split(token).join(html);
    }

    const markdownContainer = document.createElement('div');
    markdownContainer.className = 'x-md-container';
    markdownContainer.setAttribute('dir', 'auto');
    if (tweetNode.className) {
        markdownContainer.className += ' ' + tweetNode.className;
    }
    const computedStyle = window.getComputedStyle(tweetNode);
    if (computedStyle && computedStyle.color) {
        markdownContainer.style.color = computedStyle.color;
    }
    markdownContainer.innerHTML = parsedHtml;

    tweetNode.style.display = 'none';
    tweetNode.parentNode.insertBefore(markdownContainer, tweetNode.nextSibling);

    markdownContainer.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a) {
            e.preventDefault();
            e.stopPropagation();
            const href = a.getAttribute('href');
            let originalA = null;
            if (href) {
                originalA = tweetNode.querySelector(`a[href="${href}"]`);
            }
            if (originalA) {
                originalA.click();
            } else {
                window.open(a.href, '_blank');
            }
        }
    });
}

// 修改 observer 回调，检查 enabled 状态
const observerCallback = (mutations) => {
    if (!enabled) return;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.getAttribute && node.getAttribute('data-testid') === 'tweetText') {
                        processTweet(node);
                    }
                    const tweetTexts = node.querySelectorAll ? node.querySelectorAll('[data-testid="tweetText"]') : [];
                    tweetTexts.forEach(processTweet);
                }
            }
        }
    }
};

// 启动 observer
function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(observerCallback);
    observer.observe(document.body, { childList: true, subtree: true });
}

// 页面加载完成后，初始化状态、启动 observer 并处理现有节点
async function main() {
    await initState();
    startObserver();
    if (enabled) {
        document.querySelectorAll('[data-testid="tweetText"]').forEach(processTweet);
    }
}

main();