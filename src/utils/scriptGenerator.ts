export interface ScriptOptions {
  activationDelay: number; // ms to wait after clicking window before shortcut
  stepDelay: number; // ms between windows
  invertShortcut: 'Alt+I';
  hideShortcut: 'Alt+H' | 'Ctrl+Alt+H';
  magnetMode: 'ctrl_lock' | 'alt_m' | 'hybrid';
  mountPosition: 'auto' | 'header_left' | 'header_right' | 'floating';
  showFeedbackToasts: boolean;
  version: string;
}

export const DEFAULT_SCRIPT_OPTIONS: ScriptOptions = {
  activationDelay: 75,
  stepDelay: 60,
  invertShortcut: 'Alt+I',
  hideShortcut: 'Alt+H',
  magnetMode: 'hybrid',
  mountPosition: 'auto',
  showFeedbackToasts: true,
  version: '2.1.0'
};

export function generateUserScript(options: Partial<ScriptOptions> = {}): string {
  const opts = { ...DEFAULT_SCRIPT_OPTIONS, ...options };
  
  const hideKeyConfig = opts.hideShortcut === 'Ctrl+Alt+H'
    ? '{ ctrlKey: true, altKey: true, keyCode: 72, code: "KeyH", key: "H" }'
    : '{ ctrlKey: false, altKey: true, keyCode: 72, code: "KeyH", key: "h" }';

  return `// ==UserScript==
// @name         TradingView 多窗口三合一增强 (标签栏注入·窗口激活·快捷键派发)
// @namespace    https://tradingview.com/
// @version      ${opts.version}
// @description  将 隐藏、磁力、翻转K线 制作成精美图标并注入 TradingView 标签栏/顶部工具栏。点击后自动遍历并激活各个图表窗口（模拟鼠标聚焦），按序向多窗口派发快捷键。
// @author       AI Studio
// @match        https://*.tradingview.com/chart/*
// @match        https://*.tradingview.com/
// @icon         https://www.tradingview.com/static/images/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置参数 =================
    const CONFIG = {
        activationDelay: ${opts.activationDelay}, // 激活窗口后等待毫秒数（让 TradingView 内部聚焦生效）
        stepDelay: ${opts.stepDelay},             // 窗口间切换间隔毫秒数
        mountPosition: '${opts.mountPosition}',   // 'auto' | 'header_left' | 'header_right' | 'floating'
        showToasts: ${opts.showFeedbackToasts},   // 是否在页面右上角显示轻量状态提示
        hideShortcut: ${hideKeyConfig},
        invertShortcut: { altKey: true, ctrlKey: false, keyCode: 73, code: 'KeyI', key: 'i' }
    };

    let isMagnetActive = false;
    let isProcessing = false;

    // 辅助延时函数
    const delay = ms => new Promise(r => setTimeout(r, ms));

    // 轻量提示消息
    function showToast(msg, type = 'info') {
        if (!CONFIG.showToasts) return;
        const toast = document.createElement('div');
        toast.className = 'tv-enhancer-toast';
        toast.innerHTML = msg;
        toast.style.cssText = \`
            position: fixed;
            top: 60px;
            right: 20px;
            z-index: 999999;
            background: \${type === 'success' ? '#22ab94' : type === 'warn' ? '#f7525f' : '#2962ff'};
            color: #fff;
            padding: 8px 14px;
            border-radius: 6px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            pointer-events: none;
            opacity: 0;
            transform: translateY(-8px);
            transition: all 0.25s ease;
        \`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
            setTimeout(() => toast.remove(), 300);
        }, 1600);
    }

    // ================= 核心：寻找全部图表窗口 =================
    function getChartWidgets() {
        // 多维度匹配 TradingView 图表容器（支持多图表分屏布局）
        const selectors = [
            '.chart-widget',
            '[data-role="chart"]',
            '.chart-gui-wrapper',
            '.layout__area--center',
            '.tv-chart-view'
        ];

        let found = [];
        for (const sel of selectors) {
            const list = document.querySelectorAll(sel);
            if (list.length > 0) {
                found = Array.from(list);
                break;
            }
        }

        // 过滤可见并且有实际宽高的节点
        const validWidgets = found.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 50 && rect.height > 50;
        });

        // 如果找不到特定的 widget 容器，兜底查找所有图表 canvas 的父容器
        if (validWidgets.length === 0) {
            const canvases = document.querySelectorAll('canvas');
            const parents = new Set();
            canvases.forEach(c => {
                const p = c.closest('[class*="widget"]') || c.closest('[class*="container"]') || c.parentElement;
                if (p && p.getBoundingClientRect().width > 100) {
                    parents.add(p);
                }
            });
            return Array.from(parents);
        }

        // 按视觉坐标从左到右、从上到下排序
        return validWidgets.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.top - rb.top) * 1000 + (ra.left - rb.left);
        });
    }

    // ================= 核心：激活窗口 (模拟真实物理点击聚焦) =================
    function activateWindow(widget) {
        if (!widget) return;
        const rect = widget.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;

        const canvas = widget.querySelector('canvas') || widget;

        const commonOpts = {
            clientX,
            clientY,
            screenX: clientX,
            screenY: clientY,
            bubbles: true,
            cancelable: true,
            view: window,
            composed: true,
            buttons: 1
        };

        // 发送完整的鼠标/指针交互序列，唤醒 TradingView 的内部窗口管理器
        try {
            canvas.dispatchEvent(new PointerEvent('pointerdown', commonOpts));
            canvas.dispatchEvent(new MouseEvent('mousedown', commonOpts));
            canvas.dispatchEvent(new PointerEvent('pointerup', commonOpts));
            canvas.dispatchEvent(new MouseEvent('mouseup', commonOpts));
            canvas.dispatchEvent(new MouseEvent('click', commonOpts));
        } catch (e) {
            // 兼容性回退
            canvas.dispatchEvent(new MouseEvent('mousedown', commonOpts));
            canvas.dispatchEvent(new MouseEvent('click', commonOpts));
        }

        if (typeof canvas.focus === 'function') {
            canvas.focus();
        }
    }

    // ================= 核心：向目标节点分发键盘快捷键 =================
    function sendShortcut(targetElement, keyOptions) {
        const target = targetElement.querySelector('canvas') || targetElement || document.activeElement || document;

        const eventData = {
            key: keyOptions.key,
            code: keyOptions.code,
            keyCode: keyOptions.keyCode,
            which: keyOptions.keyCode,
            altKey: !!keyOptions.altKey,
            ctrlKey: !!keyOptions.ctrlKey,
            shiftKey: !!keyOptions.shiftKey,
            metaKey: false,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window
        };

        const kd = new KeyboardEvent('keydown', eventData);
        target.dispatchEvent(kd);
        document.dispatchEvent(kd);
        window.dispatchEvent(kd);

        setTimeout(() => {
            const ku = new KeyboardEvent('keyup', eventData);
            target.dispatchEvent(ku);
            document.dispatchEvent(ku);
            window.dispatchEvent(ku);
        }, 30);
    }

    // ================= 循环向所有窗口执行指令 =================
    async function dispatchToAllWindows(actionName, onSingleChart) {
        if (isProcessing) return;
        isProcessing = true;

        const widgets = getChartWidgets();
        const total = widgets.length || 1;

        showToast(\`正在向 \${total} 个窗口执行「\${actionName}」...\`, 'info');

        if (widgets.length === 0) {
            // 兜底单图表情况
            activateWindow(document.body);
            await delay(CONFIG.activationDelay);
            await onSingleChart(document.body, 0);
        } else {
            for (let i = 0; i < widgets.length; i++) {
                const widget = widgets[i];
                // 1. 关键第一步：激活当前图表窗口
                activateWindow(widget);
                await delay(CONFIG.activationDelay);

                // 2. 发送具体功能快捷键
                await onSingleChart(widget, i);

                // 3. 间隔防并发防丢包
                await delay(CONFIG.stepDelay);
            }
        }

        isProcessing = false;
        showToast(\`「\${actionName}」已同步至全部 \${total} 个窗口 ✓\`, 'success');
    }

    // 1. 隐藏功能（Alt+H 或 Ctrl+Alt+H）
    function handleTriggerHide() {
        dispatchToAllWindows('隐藏/恢复画线', (widget) => {
            sendShortcut(widget, CONFIG.hideShortcut);
        });
    }

    // 2. 翻转K线功能（Alt+I）
    function handleTriggerInvert() {
        dispatchToAllWindows('翻转K线图', (widget) => {
            sendShortcut(widget, CONFIG.invertShortcut);
        });
    }

    // 模拟依次按键键入周期数值，最后按下 Enter 键
    function sendTimeframe(targetElement, interval) {
        return new Promise((resolve) => {
            const canvas = targetElement.querySelector('canvas') || targetElement;
            
            // 1. 强行对画布设置 tabindex 并让其获取物理焦点（非常关键！TradingView 的全局监听器只有在焦点在其区域内时才捕获键盘事件）
            if (canvas) {
                canvas.setAttribute('tabindex', '-1');
                canvas.focus();
            }

            const chars = interval.split('');
            let idx = 0;

            function typeNext() {
                if (idx < chars.length) {
                    const char = chars[idx];
                    let keyCode = char.charCodeAt(0);
                    let code = "Key" + char.toUpperCase();
                    if (char >= '0' && char <= '9') {
                        keyCode = 48 + parseInt(char);
                        code = "Digit" + char;
                    }

                    // 关键所在：第一下敲击是针对 canvas 或者是 activeElement（唤起输入框）
                    // 唤起输入框后，焦点的 activeElement 将自动切换为输入框本身的 input
                    // 后续字符必须自动投递到当前的焦点元素 (activeElement) 上，否则字符无法键入到输入框中！
                    const activeEl = document.activeElement || canvas || document;

                    const down = new KeyboardEvent('keydown', {
                        key: char,
                        code: code,
                        keyCode: keyCode,
                        which: keyCode,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                    });
                    activeEl.dispatchEvent(down);

                    const press = new KeyboardEvent('keypress', {
                        key: char,
                        code: code,
                        keyCode: keyCode,
                        which: keyCode,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                    });
                    activeEl.dispatchEvent(press);

                    const up = new KeyboardEvent('keyup', {
                        key: char,
                        code: code,
                        keyCode: keyCode,
                        which: keyCode,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                    });
                    activeEl.dispatchEvent(up);

                    idx++;
                    // 延迟 60 毫秒输入下一个字符（给 TradingView 的 React 输入弹框留出充足的加载与承接时间）
                    setTimeout(typeNext, 60);
                } else {
                    // 字符输入结束，延迟 100 毫秒发送 Enter 确定键完成周期变更
                    setTimeout(() => {
                        const activeEl = document.activeElement || canvas || document;
                        const enterEvent = {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true,
                            composed: true,
                            view: window
                        };
                        activeEl.dispatchEvent(new KeyboardEvent('keydown', enterEvent));
                        activeEl.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
                        activeEl.dispatchEvent(new KeyboardEvent('keyup', enterEvent));
                        
                        // 结束当前窗口操作，释放 promise
                        setTimeout(resolve, 50);
                    }, 100);
                }
            }

            // 启动字符键入队列
            typeNext();
        });
    }

    // 3. 磁力功能 (切换 Ctrl 吸附状态 / 或触发左侧磁吸工具)
    function handleTriggerMagnet(btnElement) {
        isMagnetActive = !isMagnetActive;

        if (isMagnetActive) {
            btnElement.style.color = '#f7525f';
            btnElement.style.background = 'rgba(247, 82, 95, 0.15)';
            btnElement.setAttribute('title', '磁力模式已开启 (点击向全部窗口关闭)');
        } else {
            btnElement.style.color = '';
            btnElement.style.background = '';
            btnElement.setAttribute('title', '磁力吸附 (点击向全部窗口开启)');
        }

        dispatchToAllWindows(isMagnetActive ? '开启磁力吸附' : '关闭磁力吸附', (widget) => {
            // 方式一：向当前窗口触发磁吸按键 (Ctrl 锁 / Alt+M)
            const ctrlEvent = {
                key: 'Control',
                code: 'ControlLeft',
                keyCode: 17,
                which: 17,
                ctrlKey: isMagnetActive,
                bubbles: true,
                composed: true
            };
            const target = widget.querySelector('canvas') || widget;
            target.dispatchEvent(new KeyboardEvent(isMagnetActive ? 'keydown' : 'keyup', ctrlEvent));
            document.dispatchEvent(new KeyboardEvent(isMagnetActive ? 'keydown' : 'keyup', ctrlEvent));

            // 方式二：尝试同步点击该窗口或左侧工具栏的磁铁按钮
            const magnetBtn = widget.querySelector('[data-name="magnet"]') ||
                              widget.querySelector('[data-name="magnet-mode"]') ||
                              document.querySelector('[data-name="magnet"]');
            if (magnetBtn) {
                magnetBtn.click();
            }
        });
    }

    // ================= 标签栏 UI 注入 =================
    const ICONS = {
        hide: \`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>\`,
        magnet: \`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.35-6.35a2.85 2.85 0 0 0-4-4.03L6 15Z"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/></svg>\`,
        invert: \`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>\`
    };

    function createIconButton(id, title, svgIcon, onClick) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.type = 'button';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.className = 'tv-enhancer-btn';
        btn.innerHTML = svgIcon;
        btn.style.cssText = \`
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            padding: 0;
            margin: 0 2px;
            border: 1px solid rgba(120, 123, 134, 0.25);
            background: transparent;
            color: #d1d4dc;
            border-radius: 6px;
            cursor: pointer;
            outline: none;
            transition: all 0.15s ease;
            box-sizing: border-box;
            user-select: none;
        \`;

        btn.onmouseenter = () => {
            btn.style.borderColor = '#2962ff';
            btn.style.color = '#2962ff';
            btn.style.background = 'rgba(41, 98, 255, 0.08)';
        };
        btn.onmouseleave = () => {
            if (id === 'tv_enhancer_magnet' && isMagnetActive) return;
            btn.style.borderColor = 'rgba(120, 123, 134, 0.25)';
            btn.style.color = '#d1d4dc';
            btn.style.background = 'transparent';
        };

        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 按钮点击动效
            btn.style.transform = 'scale(0.88)';
            setTimeout(() => btn.style.transform = 'scale(1)', 120);
            onClick(btn);
        };

        return btn;
    }

    function injectToolbar() {
        if (document.getElementById('tv-enhancer-tab-group')) return;

        // 寻找 TradingView 顶部标签栏 / 工具栏容器
        const headerToolbarSelectors = [
            '#header-toolbar',
            '[data-role="header-toolbar"]',
            '.tv-header',
            '.layout__area--top',
            'div[class*="toolbarContainer"]',
            'header[class*="header"]'
        ];

        let targetContainer = null;
        for (const sel of headerToolbarSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                targetContainer = el;
                break;
            }
        }

        // 创建专属图标组容器
        const group = document.createElement('div');
        group.id = 'tv-enhancer-tab-group';
        group.className = 'tv-enhancer-tabs';
        group.style.cssText = \`
            display: inline-flex;
            align-items: center;
            padding: 2px 6px;
            margin: 0 4px;
            background: rgba(30, 34, 45, 0.7);
            border-radius: 8px;
            border: 1px solid rgba(120, 123, 134, 0.2);
            backdrop-filter: blur(8px);
            z-index: 1000;
        \`;

        // 1. 隐藏按钮
        const hideBtn = createIconButton('tv_enhancer_hide', '全部窗口：隐藏/显示画线 (Alt+H)', ICONS.hide, () => {
            handleTriggerHide();
        });

        // 2. 磁力按钮
        const magnetBtn = createIconButton('tv_enhancer_magnet', '全部窗口：磁力吸附切换 (Magnet / Ctrl)', ICONS.magnet, (btn) => {
            handleTriggerMagnet(btn);
        });

        // 3. 翻转K线按钮
        const invertBtn = createIconButton('tv_enhancer_invert', '全部窗口：翻转K线图 (Alt+I)', ICONS.invert, () => {
            handleTriggerInvert();
        });

        // 4. 周期同步选择按钮与下拉菜单
        const tContainer = document.createElement('div');
        tContainer.id = 'tv_enhancer_t_container';
        tContainer.style.cssText = \`
            position: relative;
            display: inline-block;
        \`;

        const tBtn = createIconButton('tv_enhancer_timeframe', '全部窗口：同步切换周期 (T)', '<span style="font-weight:bold;font-size:13px;font-family:sans-serif;">T</span>', () => {
            const menu = document.getElementById('tv_enhancer_tf_menu');
            if (menu) {
                menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            }
        });

        const tfMenu = document.createElement('div');
        tfMenu.id = 'tv_enhancer_tf_menu';
        tfMenu.style.cssText = \`
            display: none;
            position: absolute;
            top: 36px;
            left: 2px;
            z-index: 100010;
            background: #1c2030;
            border: 1px solid #363a45;
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            padding: 4px;
            width: 130px;
        \`;

        const periods = [
            { label: '3分钟', value: '3' },
            { label: '5分钟', value: '5' },
            { label: '15分钟', value: '15' },
            { label: '30分钟', value: '30' },
            { label: '1小时', value: '60' },
            { label: '4小时', value: '240' },
            { label: '日线', value: 'D' }
        ];

        periods.forEach(p => {
            const item = document.createElement('button');
            item.type = 'button';
            item.innerText = p.label;
            item.style.cssText = \`
                display: block;
                width: 100%;
                background: transparent;
                border: none;
                color: #d1d4dc;
                text-align: left;
                padding: 6px 10px;
                font-size: 11px;
                cursor: pointer;
                border-radius: 4px;
                font-family: sans-serif;
            \`;
            item.onmouseenter = () => {
                item.style.background = '#2962ff';
                item.style.color = '#fff';
            };
            item.onmouseleave = () => {
                item.style.background = 'transparent';
                item.style.color = '#d1d4dc';
            };
            item.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                tfMenu.style.display = 'none';
                dispatchToAllWindows('切换周期为 ' + p.label, (widget) => {
                    sendTimeframe(widget, p.value);
                });
            };
            tfMenu.appendChild(item);
        });

        tContainer.appendChild(tBtn);
        tContainer.appendChild(tfMenu);

        // 点击外部收起菜单
        document.addEventListener('click', (e) => {
            if (!tContainer.contains(e.target)) {
                tfMenu.style.display = 'none';
            }
        });

        group.appendChild(hideBtn);
        group.appendChild(magnetBtn);
        group.appendChild(invertBtn);
        group.appendChild(tContainer);

        if (targetContainer) {
            // 注入到标签栏中
            targetContainer.appendChild(group);
            console.log('[TV-Enhancer] 成功注入 TradingView 标签栏！');
        } else {
            // 优雅回退：如果在嵌入页或移动端未找到头部标签栏，作为吸顶微型标签栏停靠
            group.style.position = 'fixed';
            group.style.top = '10px';
            group.style.right = '70px';
            group.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
            document.body.appendChild(group);
            console.log('[TV-Enhancer] 已停靠为浮动标签栏');
        }
    }

    // 页面就绪后周期检测并注入（适应 TradingView 动态渲染生命周期）
    const observer = new MutationObserver(() => {
        if (!document.getElementById('tv-enhancer-tab-group')) {
            injectToolbar();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 初始执行尝试
    injectToolbar();
    setTimeout(injectToolbar, 1000);
    setTimeout(injectToolbar, 3000);

    // 窗口失焦安全重置磁吸
    window.addEventListener('blur', () => {
        if (isMagnetActive) {
            const btn = document.getElementById('tv_enhancer_magnet');
            if (btn) handleTriggerMagnet(btn);
        }
    });

    console.log('[TV-Enhancer] TradingView 多窗口三合一油猴脚本已就绪！');
})();
`;
}
