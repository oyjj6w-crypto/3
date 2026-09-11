import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Terminal,
  Settings2,
  BookOpen,
  HelpCircle,
  ExternalLink,
  Code2,
  Sparkles,
  MousePointerClick,
  Layers,
  Sliders
} from 'lucide-react';
import { ScriptOptions, generateUserScript } from '../utils/scriptGenerator';

interface UserScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  scriptOptions: ScriptOptions;
  onUpdateOptions: (newOpts: Partial<ScriptOptions>) => void;
}

export const UserScriptModal: React.FC<UserScriptModalProps> = ({
  isOpen,
  onClose,
  scriptOptions,
  onUpdateOptions
}) => {
  const [activeTab, setActiveTab] = useState<'code' | 'config' | 'install' | 'faq'>('code');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const scriptCode = generateUserScript(scriptOptions);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([scriptCode], { type: 'application/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tradingview-multiwindow-enhancer.user.js';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-5xl h-[90vh] bg-[#181b24] border border-[#2a2e39] rounded-xl shadow-2xl flex flex-col overflow-hidden text-gray-200 font-sans">
        {/* Modal Header */}
        <div className="h-14 px-5 bg-[#1e222d] border-b border-[#2a2e39] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#2962ff] flex items-center justify-center text-white font-bold shadow">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                TradingView 多窗口快捷键增强油猴插件
                <span className="text-xs font-mono font-normal bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded border border-blue-500/30">
                  v{scriptOptions.version}
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                标签栏三图标无缝注入 · 顺序鼠标物理激活 · 向 3 个窗口同步派发快捷键
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#2a2e39] hover:bg-[#363a45] text-xs text-gray-200 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">已复制完整代码</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>一键复制代码</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-[#2962ff] hover:bg-[#1e53e5] text-xs text-white transition-all shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 .user.js 文件</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              aria-label="关闭窗口"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="h-10 px-5 bg-[#141720] border-b border-[#2a2e39] flex items-center space-x-6 text-xs font-medium shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`flex items-center space-x-1.5 py-2.5 border-b-2 transition-colors ${
              activeTab === 'code'
                ? 'border-[#2962ff] text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>脚本源码</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`flex items-center space-x-1.5 py-2.5 border-b-2 transition-colors ${
              activeTab === 'config'
                ? 'border-[#2962ff] text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>参数调优配置</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('install')}
            className={`flex items-center space-x-1.5 py-2.5 border-b-2 transition-colors ${
              activeTab === 'install'
                ? 'border-[#2962ff] text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>手机与电脑安装教程</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('faq')}
            className={`flex items-center space-x-1.5 py-2.5 border-b-2 transition-colors ${
              activeTab === 'faq'
                ? 'border-[#2962ff] text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>核心机制与原理解析</span>
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-[#131722]">
          {/* TAB 1: 源码预览 */}
          {activeTab === 'code' && (
            <div className="flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-400 bg-[#1e222d] p-3 rounded-lg border border-[#2a2e39]">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span>
                    代码已针对 <strong>TradingView 3窗口多分屏布局</strong> 与{' '}
                    <strong>顶部标签栏注入</strong> 深度优化。
                  </span>
                </div>
                <span className="font-mono text-gray-500">
                  {scriptCode.split('\n').length} 行代码 · UTF-8
                </span>
              </div>

              <div className="relative flex-1 bg-[#0d1017] rounded-lg border border-[#2a2e39] overflow-hidden">
                <pre className="h-full p-4 text-xs font-mono text-gray-300 overflow-auto leading-relaxed select-text">
                  <code>{scriptCode}</code>
                </pre>
              </div>
            </div>
          )}

          {/* TAB 2: 参数配置 */}
          {activeTab === 'config' && (
            <div className="max-w-3xl mx-auto space-y-6 py-2">
              <div className="bg-[#1e222d] p-4 rounded-xl border border-[#2a2e39] space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <MousePointerClick className="w-4 h-4 text-[#2962ff]" />
                  窗口激活与调度延迟微调
                </h3>
                <p className="text-xs text-gray-400">
                  TradingView 内部在接收快捷键前，需要大约 50~100ms
                  的时间完成活动图表切换。针对低配平板或高分屏设备，可适当调大延迟以保证 100% 触发成功率。
                </p>

                <div className="space-y-4 pt-2">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 font-medium">
                        窗口激活等待时间 (activationDelay)
                      </span>
                      <span className="font-mono text-[#2962ff]">
                        {scriptOptions.activationDelay} ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min={40}
                      max={200}
                      step={5}
                      value={scriptOptions.activationDelay}
                      onChange={e =>
                        onUpdateOptions({ activationDelay: parseInt(e.target.value) })
                      }
                      className="w-full accent-[#2962ff] cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>40ms (高配电脑极速)</span>
                      <span>75ms (推荐默认值)</span>
                      <span>200ms (慢速网络/平板)</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 font-medium">
                        窗口间切换间隔 (stepDelay)
                      </span>
                      <span className="font-mono text-[#2962ff]">{scriptOptions.stepDelay} ms</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={180}
                      step={5}
                      value={scriptOptions.stepDelay}
                      onChange={e =>
                        onUpdateOptions({ stepDelay: parseInt(e.target.value) })
                      }
                      className="w-full accent-[#2962ff] cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>30ms (流畅无感知)</span>
                      <span>60ms (推荐默认值)</span>
                      <span>180ms (确保视觉完全同步)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 快捷键键位定制 */}
              <div className="bg-[#1e222d] p-4 rounded-xl border border-[#2a2e39] space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-amber-400" />
                  按键组合偏好设置
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <label className="text-gray-300 font-medium block">
                      隐藏/恢复功能快捷键
                    </label>
                    <div className="space-y-1.5">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="hideShortcut"
                          checked={scriptOptions.hideShortcut === 'Alt+H'}
                          onChange={() => onUpdateOptions({ hideShortcut: 'Alt+H' })}
                          className="accent-[#2962ff]"
                        />
                        <span>Alt + H (隐藏当前画线 - 推荐)</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="hideShortcut"
                          checked={scriptOptions.hideShortcut === 'Ctrl+Alt+H'}
                          onChange={() => onUpdateOptions({ hideShortcut: 'Ctrl+Alt+H' })}
                          className="accent-[#2962ff]"
                        />
                        <span>Ctrl + Alt + H (隐藏画线与全部指标)</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-gray-300 font-medium block">翻转K线快捷键</label>
                    <div className="p-2.5 bg-[#141720] rounded border border-gray-800 text-gray-300">
                      <span className="font-mono text-emerald-400">Alt + I</span>
                      <p className="text-[11px] text-gray-500 mt-1">
                        TradingView 官方倒转坐标标度标准快捷键
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 状态通知提示 */}
              <div className="bg-[#1e222d] p-4 rounded-xl border border-[#2a2e39] flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-white">页面轻量 Toast 状态反馈</h4>
                  <p className="text-[11px] text-gray-400">
                    在触发隐藏、磁力或翻转时，在页面右上角短暂显示执行提示与成功状态
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={scriptOptions.showFeedbackToasts}
                  onChange={e => onUpdateOptions({ showFeedbackToasts: e.target.checked })}
                  className="w-4 h-4 accent-[#2962ff] cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* TAB 3: 安装教程 */}
          {activeTab === 'install' && (
            <div className="max-w-3xl mx-auto space-y-6 py-2">
              <div className="bg-[#1e222d] p-5 rounded-xl border border-[#2a2e39] space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-blue-900/60 text-blue-300 text-xs border border-blue-500/30">
                    方案 A
                  </span>
                  电脑端 (Chrome / Edge / Firefox) 安装步骤
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-xs text-gray-300 leading-relaxed">
                  <li>
                    在浏览器扩展商店中安装 <strong>Tampermonkey (油猴)</strong> 或{' '}
                    <strong>Violentmonkey (暴力猴)</strong>。
                  </li>
                  <li>
                    点击浏览器右上角油猴扩展图标，选择 <strong>「添加新脚本」</strong>。
                  </li>
                  <li>
                    将上方的 <strong>脚本源码</strong> 全部复制，粘贴替换编辑器中的默认内容。
                  </li>
                  <li>
                    按 <code>Ctrl + S</code> 保存脚本。
                  </li>
                  <li>
                    打开 TradingView 网页版 (<code>https://www.tradingview.com/chart/</code>
                    )，刷新页面即可在顶部标签栏看到 3 个新图标！
                  </li>
                </ol>
              </div>

              <div className="bg-[#1e222d] p-5 rounded-xl border border-[#2a2e39] space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 text-xs border border-amber-500/30">
                    方案 B
                  </span>
                  Android 手机 / 平板端安装步骤
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-xs text-gray-300 leading-relaxed">
                  <li>
                    推荐下载支持 Chrome 插件的浏览器，例如 <strong>Kiwi Browser</strong> 或{' '}
                    <strong>Firefox 移动版</strong>。
                  </li>
                  <li>在 Kiwi Browser 中访问 Chrome 应用商店，安装 Tampermonkey 扩展。</li>
                  <li>
                    点击本界面右上角的 <strong>「一键复制代码」</strong> 或{' '}
                    <strong>「下载 .user.js 文件」</strong>。
                  </li>
                  <li>在 Kiwi Browser 打开下载的文件，油猴会自动弹出安装提示，点击确认安装。</li>
                  <li>
                    访问 TradingView 多窗口看盘，顶部或右上方将自动呈现 3 个便携式操作图标！
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 4: 核心机制与技术原理解析 */}
          {activeTab === 'faq' && (
            <div className="max-w-3xl mx-auto space-y-4 py-2 text-xs text-gray-300 leading-relaxed">
              <div className="bg-[#1e222d] p-4 rounded-xl border border-[#2a2e39] space-y-2">
                <h4 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  为什么一定要「激活窗口」后再发快捷键才有效？
                </h4>
                <p className="text-gray-300">
                  TradingView 的多图表分屏框架采用单例焦点机制（即 <code>activeChartIndex</code>
                  ）。当一个图表处于非活动状态时，TradingView
                  在画板上注册的键盘事件监听器会过滤掉全局热键，只有被用户点击激活的视窗才会响应{' '}
                  <code>Alt+I</code> 或 <code>Alt+H</code>。
                </p>
                <p className="text-gray-400">
                  本脚本在向各窗口分发按键前，通过精确计算每个图表 <code>.chart-widget</code> 的坐标，合成原生的{' '}
                  <code>pointerdown</code>、<code>mousedown</code>、<code>click</code> 和{' '}
                  <code>focus()</code> 序列，完美唤醒 TradingView
                  内部的焦点切换，然后立即派发快捷键，从而实现 3 个窗口 100% 可靠执行！
                </p>
              </div>

              <div className="bg-[#1e222d] p-4 rounded-xl border border-[#2a2e39] space-y-2">
                <h4 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  为什么将按钮注入到「标签栏」比原版的侧边悬浮圆球更好？
                </h4>
                <p className="text-gray-300">
                  原版油猴脚本采用固定在左下角的 3 个绝对定位圆球（占用 180px~420px 垂直高度），在手机或横屏平板上会严重遮挡左侧工具栏和画线标度。
                </p>
                <p className="text-gray-400">
                  新版脚本直接挂载到 TradingView 顶部的 <code>#header-toolbar</code> 标签栏，与品种、周期按钮平级并列，具备原生级的外观质感与悬停提示。若在移动端找不到顶部栏，会自动以半透明微型药丸形态停靠在屏幕边缘，完全不遮挡 K 线视线。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
