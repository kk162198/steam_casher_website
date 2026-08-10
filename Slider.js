export default class Slider extends HTMLElement {
    // 1. 定義要監聽的屬性
    static get observedAttributes() {
        return ['ratio'];
    }

    // 2. 當屬性變更時觸發
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'ratio' && oldValue !== newValue) {
            // 更新實體上的 ratio 值
            this._ratio = Number(newValue) || 1;
            
            // DOM 可能還沒建立（attributeChangedCallback 會早於 connectedCallback），
            // 這時只更新 _ratio，等 connectedCallback 渲染時自然會用到新值。
            if (this._rendered && this.slider_value) {
                this.updateFromBase(this.slider_value.value);
            }
        }
    }

    constructor() {
        super();
        // Web Components 規範：constructor 裡不要碰屬性、也不要動 DOM
        //（用 document.createElement('profit-slider') 建立時屬性還不存在）。
        // 這裡只準備 shadow root，實際渲染放到 connectedCallback()。
        this.shadow = this.attachShadow({ mode: "open" });
        this._ratio = 1;
        this._rendered = false;
    }

    connectedCallback() {
        if (this._rendered) return;   // 移出再移入 DOM 時不要重建一次
        this._rendered = true;

        const container = document.createElement("div");
        container.classList.add("this_div-style");

        // ratio 在這個時間點才保證讀得到
        this._ratio = Number(this.getAttribute("ratio")) || 1;
        /* 樣式對齊 assets/style.css 的設計系統：
           - 顏色一律走 --brand / --pos / --ink2 / --line 這幾個 CSS 變數。
             自訂屬性會穿透 shadow DOM 繼承進來，所以不需要在這裡再寫死色碼。
             （加上 fallback，讓元件單獨拿去別的頁面用也不會沒有顏色。）
           - 全部靠左對齊。原本整組置中，跟卡片裡其他區塊的對齊方式不一致。
           - 原本有一個置中的 <h2>餘額換算</h2>：卡片本身已經有說明文字，
             這顆標題既重複、又在頁面中間多插一層 h2 破壞標題層級，改成
             真正的 <label>，順便補上滑桿與兩個輸入框缺的可及性標籤。
           - 圓角 20px → 8px，與 .card / .btn 同一組圓角。
           - 滑桿原本整條只有 5px 高，手機幾乎按不到。改成外框 24px 的
             觸控區、視覺軌道 6px，填色百分比用 --p 變數傳給軌道。 */
        container.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    box-sizing: border-box;
                    font-family: inherit;
                }
                .wrapper { display: flex; flex-direction: column; gap: 12px; }
                .field-label {
                    display: block;
                    font-size: 14px;
                    line-height: 1.75;
                    color: var(--ink2, #94a3b8);
                }
                .range-row { display: flex; flex-direction: column; gap: 2px; }
                .range-scale {
                    display: flex; justify-content: space-between;
                    font-size: 12px; line-height: 1.5; color: var(--ink3, #64748b);
                    font-variant-numeric: tabular-nums;
                }
                .slider {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 100%;
                    height: 24px;          /* 觸控區，不是軌道高度 */
                    background: transparent;
                    outline: none;
                    margin: 0;
                    cursor: pointer;
                    --p: 10%;
                }
                .slider::-webkit-slider-runnable-track {
                    height: 6px; border-radius: 999px;
                    background: linear-gradient(to right,
                        var(--brand, #22d3ee) var(--p), var(--line, #1e293b) var(--p));
                }
                .slider::-moz-range-track {
                    height: 6px; border-radius: 999px;
                    background: linear-gradient(to right,
                        var(--brand, #22d3ee) var(--p), var(--line, #1e293b) var(--p));
                }
                .slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 20px; height: 20px; border-radius: 50%;
                    background: var(--brand, #22d3ee);
                    border: 3px solid var(--card, #0f172a);
                    margin-top: -7px;      /* (6px 軌道 − 20px 圓鈕) ÷ 2 */
                }
                .slider::-moz-range-thumb {
                    width: 20px; height: 20px; border-radius: 50%;
                    background: var(--brand, #22d3ee);
                    border: 3px solid var(--card, #0f172a);
                }
                .slider:focus-visible {
                    outline: 2px solid var(--brand, #22d3ee);
                    outline-offset: 2px; border-radius: 4px;
                }
                .box {
                    border: 1px solid var(--line, #1e293b);
                    border-radius: 8px;
                    padding: 14px 16px;
                    display: flex; flex-direction: column; gap: 10px;
                }
                .row {
                    display: flex; align-items: baseline; justify-content: space-between;
                    gap: 12px; flex-wrap: wrap;
                }
                .row-label { font-size: 14px; line-height: 1.75; color: var(--ink2, #94a3b8); }
                .row-value { display: inline-flex; align-items: baseline; gap: 4px; }
                .unit { font-size: 14px; color: var(--ink2, #94a3b8); }
                .base-input, .result-input {
                    background: transparent;
                    border: 0;
                    border-bottom: 1px solid var(--line, #1e293b);
                    outline: none;
                    text-align: right;
                    width: 96px;
                    font-size: 20px;
                    font-weight: 700;
                    line-height: 1.4;
                    padding: 4px 6px;
                    font-family: inherit;
                    font-variant-numeric: tabular-nums;
                    -moz-appearance: textfield;
                }
                .base-input:focus-visible, .result-input:focus-visible {
                    outline: 2px solid var(--brand, #22d3ee);
                    outline-offset: 2px; border-radius: 4px;
                }
                .base-input::-webkit-inner-spin-button,
                .base-input::-webkit-outer-spin-button,
                .result-input::-webkit-inner-spin-button,
                .result-input::-webkit-outer-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
                .base-input { color: var(--brand, #22d3ee); }
                .result-input { color: var(--pos, #34d399); }
            </style>
            <div class="wrapper">
                <div class="range-row">
                    <label class="field-label" for="cash-slider">投入金額</label>
                    <input
                        type="range"
                        id="cash-slider"
                        min="100"
                        max="10000"
                        value="1000"
                        step="1"
                        class="slider"
                    >
                    <div class="range-scale" aria-hidden="true"><span>100</span><span>10,000</span></div>
                </div>
                <div class="box">
                    <div class="row">
                        <label class="row-label" for="base-input">你打算投入</label>
                        <span class="row-value">
                            <input type="number" id="base-input" class="base-input" value="1000">
                            <span class="unit">元</span>
                        </span>
                    </div>
                    <div class="row">
                        <label class="row-label" for="result-input">目前可換到的餘額</label>
                        <span class="row-value">
                            <input type="number" id="result-input" class="result-input">
                            <span class="unit">元</span>
                        </span>
                    </div>
                </div>
            </div>
        `
        this.shadow.appendChild(container);
        
        // 4. 將 DOM 元素綁定在 this 上，讓 attributeChangedCallback 可以讀取到
        this.slider_value = this.shadow.querySelector("#cash-slider");
        this.baseInput = this.shadow.querySelector("#base-input");
        this.resultInput = this.shadow.querySelector("#result-input");

        // 初始化背景與數值
        this.updateFromBase(this.slider_value.value);

        // 綁定事件監聽器，使用箭頭函式以確保 this 指向 Slider 實體
        this.slider_value.addEventListener("input", (e) => this.updateFromBase(e.target.value));
        this.baseInput.addEventListener("input", (e) => this.updateFromBase(e.target.value));
        this.resultInput.addEventListener("input", (e) => this.updateFromresult(e.target.value));
    }

    // 5. 將更新邏輯獨立成類別方法，方便各處呼叫
    updateSliderBackground(value) {
        const min = Number(this.slider_value.min);
        const max = Number(this.slider_value.max);
        const raw = ((Number(value) - min) / (max - min)) * 100;
        const percentage = Math.min(100, Math.max(0, isFinite(raw) ? raw : 0));
        // 軌道是 ::-webkit-slider-runnable-track，沒辦法直接設 style，
        // 所以把填色百分比寫進自訂屬性，由 CSS 的 linear-gradient 讀取。
        this.slider_value.style.setProperty('--p', percentage + '%');
    }

    updateFromBase(value) {
        const baseVal = Number(value);
        this.slider_value.value = baseVal;
        this.baseInput.value = baseVal;
        // 注意這裡改用 this._ratio
        this.resultInput.value = Math.floor(baseVal * this._ratio);
        this.updateSliderBackground(baseVal);
    }

    updateFromresult(value) {
        const resultVal = Number(value);
        // 注意這裡改用 this._ratio
        const baseVal = Math.floor(resultVal / this._ratio);
        this.slider_value.value = baseVal;
        this.baseInput.value = baseVal;
        this.resultInput.value = resultVal;
        this.updateSliderBackground(baseVal);
    }
}
customElements.define('profit-slider', Slider);