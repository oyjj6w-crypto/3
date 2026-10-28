# TradingView 周期弹窗、比例对齐与画图按键修复方案

## 一、用户需求与变动要点汇总

1. **彻底修复隐藏画图快捷按钮（右侧浮动眼睛图标）**：
   - 彻底移除 `action === 'hide'` 中加入的 `isAlreadyHidden` 单向拦截；
   - 恢复为无条件原生触发（点击按钮或分发快捷键 `Ctrl+Alt+H`），确保用户随时随地点击都能稳定切换（隐藏 ↔ 显示）。

2. **彻底删除周期切换里的自动隐藏画图**：
   - 从 `dispatchNativeTimeframe` 中彻底清除所有后台自动隐藏画图（`hideBtn` / `getAllShapes` / `Ctrl+Alt+H`）的逻辑，不再对 TradingView 的画图状态做任何后台误触。

3. **流水线方案二：多窗口错峰键入 + 2秒独立看护比例校准**：
   - **错峰键入**：窗口 1 与窗口 2 之间保持 650ms 安全焦点交接间隔，各窗口依次键入周期字符并敲回车，避免按键冲突与焦点争抢；
   - **各自独立 2 秒看护校准**：
     - 回车后 700ms（阶段 1）：跨图点击非活跃图 B，触发初步比例广播；
     - 回车后 2000ms（阶段 2 巡检）：遍历所有 `.chart-widget` 计算 K 线密度 $D = \frac{\text{时间轴刻度数}}{\text{宽度}}$。
     - 若最大密度与最小密度比值 $\frac{D_{\max}}{D_{\min}} > 1.35$ 或刻度标签相差 $\ge 3$（说明存在比例过大窗口）：
     - 精准点击密度最大、比例正常的窗口 $D_{\max}$ 的 Canvas，强制 TradingView 同步所有窗口为紧凑正常比例！

---

## 二、关键代码变动

1. `app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt`:
   - `dispatchTradingViewAction`：设置 `action.startsWith("timeframe_") -> 650L`，实现多窗口错峰流水线。
   - `dispatchNativeTimeframe`：阶段 1 移除自动隐藏画图，阶段 2 设置为 2000ms 执行 $D_{\max} / D_{\min} > 1.35$ 比例巡检与精准补点。
   - `buildActionExecutionScript`：`action === 'hide'` 恢复无条件触发，随点随切。
2. `src/data/androidProjectSource.ts`:
   - 同步 `PersistentWebViewPool` 的最新参数与逻辑。

---

## 三、验证结果

1. **Brace Check**: 所有 Kotlin 语法花括号及圆括号平衡校验通过。
2. **TypeScript**: `tsc --noEmit` 0 错误。
3. **Applet Compilation**: `compile_applet` 编译成功。
