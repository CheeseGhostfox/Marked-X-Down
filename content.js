// content.js

// Set marked.js options
if (typeof marked !== 'undefined') {
    marked.setOptions({
        gfm: true,
        breaks: true, // X.com uses soft breaks as real newlines
        sanitize: false // allow HTML tags
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
            // Check if escaped
            if (startIndex > 0 && res[startIndex - 1] === '\\') {
                startIndex += delim.left.length;
                continue;
            }
            
            const endIndex = res.indexOf(delim.right, startIndex + delim.left.length);
            if (endIndex === -1) {
                break; // No closing delimiter found
            }
            
            // Check if closing is escaped
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
    
    // Unescape \$ and \\( etc
    res = res.replace(/\\(\$|\\\[|\\\]|\\\(|\\\))/g, '$1');
    return res;
}

function processTweet(tweetNode) {
    if (tweetNode.dataset.markdownProcessed === "true") return;

    // Mark as processed early to avoid loops
    tweetNode.dataset.markdownProcessed = "true";

    // Check if we should activate LaTeX pipeline early so we can adjust extraction
    const isLatexed = /#latexed/i.test(tweetNode.textContent);

    // 1. Extract text and tokens by flattening the DOM tree
    let text = "";
    const clonesMap = new Map();

    function walk(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.nodeValue;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.tagName === 'A') {
                    // X.com converts $E into cashtags. We must flatten cashtags if in LaTeX mode!
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
                    // Recurse into SPAN, DIV wrappers to extract raw text
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

    // 2. Parse with marked
    let parsedHtml = "";
    try {
        parsedHtml = marked.parse(text);
    } catch (e) {
        console.error("Markdown parsing failed:", e);
        return;
    }

    // 3. Replace tokens back with original HTML
    for (const [token, html] of clonesMap.entries()) {
        parsedHtml = parsedHtml.split(token).join(html);
    }

    // 4. Create new container
    const markdownContainer = document.createElement('div');
    markdownContainer.className = 'x-md-container';
    markdownContainer.setAttribute('dir', 'auto'); // Fix text order for LTR/RTL mixed text and emojis
    
    // Copy the original classes to inherit the exact font sizing and weights
    if (tweetNode.className) {
        markdownContainer.className += ' ' + tweetNode.className;
    }
    
    // Explicitly copy color to support Dark Mode / Dim Mode properly
    const computedStyle = window.getComputedStyle(tweetNode);
    if (computedStyle && computedStyle.color) {
        markdownContainer.style.color = computedStyle.color;
    }
    
    markdownContainer.innerHTML = parsedHtml;
    
    // 5. Hide original and insert new
    tweetNode.style.display = 'none';
    tweetNode.parentNode.insertBefore(markdownContainer, tweetNode.nextSibling);

    // 6. Delegate events to preserve SPA routing
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

// Observe DOM mutations to catch new tweets loading
const observer = new MutationObserver((mutations) => {
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
});

// Start observing the body
observer.observe(document.body, { childList: true, subtree: true });

// Process existing nodes on initial load
document.querySelectorAll('[data-testid="tweetText"]').forEach(processTweet);
