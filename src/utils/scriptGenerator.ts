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
            
            // 1. 强行对画布设置 tabindex 并让其获取物理焦点
            if (canvas) {
                canvas.setAttribute('tabindex', '-1');
                canvas.focus();
            }

            const chars = String(interval).split('');
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
                    window.dispatchEvent(down);

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
                    // 间隔 40 毫秒输入下一个字符
                    setTimeout(typeNext, 40);
                } else {
                    // 字符输入结束，延迟发送 Enter 确定键完成周期变更
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
                        window.dispatchEvent(new KeyboardEvent('keydown', enterEvent));
                        activeEl.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
                        activeEl.dispatchEvent(new KeyboardEvent('keyup', enterEvent));
                        
                        setTimeout(resolve, 50);
                    }, 60);
                }
            }

            typeNext();
        });
    }

    // 综合多策略切换单个图表窗口周期 (API -> 顶栏原生周期按钮/下拉 -> 键盘输入兜底)
    async function applyTimeframeToWindow(widget, interval, idx) {
        let success = false;
        const cleanTf = String(interval).trim().toUpperCase();

        // 策略 1: TradingView 官方 API (window.tvWidget / unsafeWindow.tvWidget)
        try {
            const win = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
            if (win.tvWidget) {
                if (typeof win.tvWidget.chart === 'function') {
                    const c = win.tvWidget.chart(idx);
                    if (c && typeof c.setResolution === 'function') {
                        c.setResolution(cleanTf);
                        success = true;
                    }
                } else if (typeof win.tvWidget.activeChart === 'function') {
                    const ac = win.tvWidget.activeChart();
                    if (ac && typeof ac.setResolution === 'function') {
                        ac.setResolution(cleanTf);
                        success = true;
                    }
                }
            }
        } catch (e) {
            console.warn('[TV-Enhancer] TV API setResolution error:', e);
        }

        // 策略 2: 顶栏 TradingView 原生周期按钮 / 下拉菜单精准点击
        if (!success) {
            try {
                const intervalBar = document.querySelector('#header-toolbar-intervals') || 
                                    document.querySelector('[data-name="header-toolbar-intervals"]') ||
                                    document.querySelector('div[id*="header-toolbar-intervals"]');
                if (intervalBar) {
                    // 2a. 查找顶栏是否存在已收藏的快捷周期按钮 (如 1m, 3m, 5m, 15m, 1h, 4h, 1D, D)
                    const buttons = Array.from(intervalBar.querySelectorAll('button, [role="button"]'));
                    const directBtn = buttons.find(b => {
                        const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toUpperCase();
                        return txt === cleanTf || 
                               txt === (cleanTf + 'M') || 
                               txt === (cleanTf + '分') || 
                               (cleanTf === '60' && (txt === '1H' || txt === '1小时' || txt === '60')) ||
                               (cleanTf === '240' && (txt === '4H' || txt === '4小时' || txt === '240')) ||
                               ((cleanTf === 'D' || cleanTf === '1D') && (txt === '1D' || txt === '日线' || txt === 'D'));
                    });

                    if (directBtn) {
                        directBtn.click();
                        success = true;
                    } else {
                        // 2b. 点击展开周期下拉菜单并在弹出列表中选取对应项
                        const trigger = intervalBar.querySelector('button') || intervalBar;
                        trigger.click();
                        await delay(80);

                        const items = Array.from(document.querySelectorAll('[data-role="menuitem"], [role="menuitem"], [class*="item-"]'));
                        const menuItem = items.find(it => {
                            const txt = (it.innerText || '').trim().toUpperCase();
                            return txt === cleanTf || 
                                   txt.includes(cleanTf + 'M') || 
                                   txt.includes(cleanTf + '分') || 
                                   (cleanTf === '60' && (txt.includes('1小时') || txt.includes('1H'))) ||
                                   (cleanTf === '240' && (txt.includes('4小时') || txt.includes('4H'))) ||
                                   ((cleanTf === 'D' || cleanTf === '1D') && (txt.includes('日线') || txt.includes('1D') || txt === 'D'));
                        });

                        if (menuItem) {
                            menuItem.click();
                            success = true;
                        } else {
                            // 关闭打开的菜单
                            document.body.click();
                        }
                    }
                }
            } catch (e) {
                console.warn('[TV-Enhancer] Toolbar interval click error:', e);
            }
        }

        // 策略 3: 键盘输入流模拟（作为兜底尝试）
        if (!success) {
            await sendTimeframe(widget, cleanTf);
        }
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

        // 4. 周期同步切换浮窗与交互逻辑 (直接挂载在 document.body，彻底规避 TradingView 顶栏 overflow:hidden 截断)
        let tfModal = document.getElementById('tv_enhancer_tf_modal');
        if (!tfModal) {
            tfModal = document.createElement('div');
            tfModal.id = 'tv_enhancer_tf_modal';
            tfModal.style.cssText = \`
                display: none;
                position: fixed;
                z-index: 2147483647;
                background: #1e222d;
                border: 1px solid #363a45;
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75);
                padding: 12px;
                width: 250px;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif;
                color: #d1d4dc;
                box-sizing: border-box;
            \`;

            // 头部标题与关闭
            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;';
            header.innerHTML = \`
                <span style="font-weight:600; font-size:12px; color:#f0f3fa;">⏱️ 同步切换周期 (全部窗口)</span>
                <span id="tv_tf_close" style="font-size:16px; cursor:pointer; color:#787b86; line-height:1; padding:2px;">&times;</span>
            \`;
            tfModal.appendChild(header);

            // 自定义周期输入框行
            const inputRow = document.createElement('div');
            inputRow.style.cssText = 'display:flex; gap:6px; margin-bottom:10px;';
            inputRow.innerHTML = \`
                <input id="tv_tf_custom_input" type="text" placeholder="输入周期 (如 15, 60, D...)" style="flex:1; min-width:0; background:#131722; border:1px solid #363a45; border-radius:4px; padding:6px 8px; font-size:12px; color:#fff; outline:none;" />
                <button id="tv_tf_sync_btn" type="button" style="background:#2962ff; color:#fff; border:none; border-radius:4px; padding:6px 10px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;">同步</button>
            \`;
            tfModal.appendChild(inputRow);

            // 快捷周期提示
            const tip = document.createElement('div');
            tip.style.cssText = 'font-size:11px; color:#787b86; margin-bottom:6px;';
            tip.innerText = '常用快捷周期：';
            tfModal.appendChild(tip);

            // 快捷周期网格
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid; grid-template-columns: repeat(4, 1fr); gap:4px;';

            const periods = [
                { label: '1分', val: '1' },
                { label: '3分', val: '3' },
                { label: '5分', val: '5' },
                { label: '15分', val: '15' },
                { label: '30分', val: '30' },
                { label: '1小时', val: '60' },
                { label: '4小时', val: '240' },
                { label: '日线', val: 'D' }
            ];

            function doSync(val, label) {
                if (!val) return;
                tfModal.style.display = 'none';
                dispatchToAllWindows('切换周期为 ' + (label || val), async (widget, i) => {
                    return await applyTimeframeToWindow(widget, val, i);
                });
            }

            periods.forEach(p => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.innerText = p.label;
                btn.style.cssText = \`
                    background: #2a2e39;
                    border: 1px solid transparent;
                    color: #d1d4dc;
                    border-radius: 4px;
                    padding: 5px 0;
                    font-size: 11px;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.15s;
                \`;
                btn.onmouseenter = () => {
                    btn.style.background = '#2962ff';
                    btn.style.color = '#fff';
                };
                btn.onmouseleave = () => {
                    btn.style.background = '#2a2e39';
                    btn.style.color = '#d1d4dc';
                };
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    doSync(p.val, p.label);
                };
                grid.appendChild(btn);
            });
            tfModal.appendChild(grid);

            document.body.appendChild(tfModal);

            // 绑定关闭按钮
            const closeBtn = tfModal.querySelector('#tv_tf_close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    tfModal.style.display = 'none';
                };
            }

            // 绑定输入框回车与确定按钮
            const syncBtn = tfModal.querySelector('#tv_tf_sync_btn');
            const customInput = tfModal.querySelector('#tv_tf_custom_input');

            if (syncBtn && customInput) {
                syncBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const v = customInput.value.trim();
                    if (v) doSync(v, v);
                };

                customInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        const v = customInput.value.trim();
                        if (v) doSync(v, v);
                    }
                };
            }

            // 点击页面空白处收起
            document.addEventListener('mousedown', (e) => {
                const triggerBtn = document.getElementById('tv_enhancer_timeframe');
                if (tfModal.style.display !== 'none' && !tfModal.contains(e.target) && (!triggerBtn || !triggerBtn.contains(e.target))) {
                    tfModal.style.display = 'none';
                }
            });
        }

        // T 按钮触发器
        const tBtn = createIconButton('tv_enhancer_timeframe', '全部窗口：同步切换周期 (T)', '<span style="font-weight:bold;font-size:13px;font-family:sans-serif;">T</span>', () => {
            const modal = document.getElementById('tv_enhancer_tf_modal');
            if (modal) {
                if (modal.style.display === 'none' || !modal.style.display) {
                    const rect = tBtn.getBoundingClientRect();
                    modal.style.top = Math.max(10, rect.bottom + 6) + 'px';
                    modal.style.left = Math.max(10, Math.min(window.innerWidth - 265, rect.left - 80)) + 'px';
                    modal.style.display = 'block';
                    const inp = modal.querySelector('#tv_tf_custom_input');
                    if (inp) {
                        inp.value = '';
                        setTimeout(() => inp.focus(), 50);
                    }
                } else {
                    modal.style.display = 'none';
                }
            }
        });

        group.appendChild(hideBtn);
        group.appendChild(magnetBtn);
        group.appendChild(invertBtn);
        group.appendChild(tBtn);

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
