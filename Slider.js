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
            
            // 如果 DOM 已經建立完成（因為首次渲染時 DOM 可能還沒好），則觸發重新計算
            if (this.slider_value) {
                this.updateFromBase(this.slider_value.value);
            }
        }
    }

    constructor() {
        super();
        this.shadow = this.attachShadow({mode:"open"});
        const container = document.createElement("div");
        container.classList.add("this_div-style");
        
        // 3. 將 ratio 綁定在 this 上，並賦予初始值
        this._ratio = Number(this.getAttribute("ratio")) || 1;
        container.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    box-sizing: border-box;
                }
                .outside_div{
                    background-color: none;
                    display: grid;
                    place-items: center; /* 一行屬性同時處理水平與垂直置中 */
                    padding-bottom: 10px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .inside_div{
                    background-color: none;
                    display: grid;
                    place-items: center;
                    border: 1px solid #334155 ;
                    border-radius: 20px;
                    padding: 10px;
                    width: 100%;
                    box-sizing: border-box;
                }
                h2{
                    margin-top: 0;
                    color: #22d3ee;
                    text-align: center;
                    font-size: 20px;
                    margin-bottom: 20px;
                    font-weight: bold;
                }
                p{
                    color: #94a3b8;
                    text-align: center;
                    font-size: 15px;
                    margin-bottom: 20px;
                    font-weight: bold;
                    white-space: nowrap;
                }
                .slider {
                -webkit-appearance: none;
                width: 90%;
                max-width: 100%;
                height: 5px;
                border-radius: 4px; 
                background: linear-gradient(to right, #22d3ee 15%, #94a3b8 15%);
                outline: none;
                margin-bottom: 20px;
                }

                .slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 20px;               /* 滑塊寬度 */
                height: 20px;              /* 滑塊高度 */
                border-radius: 50%;        /* 圓形 */
                background: #22d3ee;       /* 內部背景 */
                border: 3px solid #0f172a; /* 外部粗框 */
                cursor: pointer;
                }
                .slider::-moz-range-thumb {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: #22d3ee;
                    border: 3px solid #0f172a;
                    cursor: pointer;
                }
                .base-input, .result-input {
                    background: transparent;
                    border: none;
                    outline: none;
                    text-align: center;
                    width: 80px;         /* 依實際需求調整寬度 */
                    font-size: 20px;
                    font-weight: bold;
                    padding: 2px 5px;
                    font-family: inherit;
                }

                .base-input::-webkit-inner-spin-button,
                .base-input::-webkit-outer-spin-button,
                .result-input::-webkit-inner-spin-button,
                .result-input::-webkit-outer-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }

                .base-input, .result-input {
                    -moz-appearance: textfield;
                }

                .base-input {
                    color: #22d3ee;
                    border-bottom: 1px solid #94a3b8;
                }

                .result-input {
                    color: #34d399;      /* 亮綠色 */
                    border-bottom: 1px solid #94a3b8;
                }

            </style>
            <div class="outside_div">
                <h2>餘額換算</h2>
                <input 
                    type="range" 
                    id="cash-slider" 
                    min="100" 
                    max="10000" 
                    value="1000" 
                    step="1" 
                    class="slider"
                >
                <div class="inside_div">
                    <p>
                        你打算投入： 
                        <input type="number" id="base-input" class="base-input" value="1000">
                        元
                    </p>
                    <p>
                        目前可換到的餘額：
                        <input type="number" id="result-input" class="result-input">
                        元
                    </p>
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
        const percentage = ((Number(value) - min) / (max - min)) * 100;
        this.slider_value.style.background = `linear-gradient(to right, #22d3ee ${percentage}%, #94a3b8 ${percentage}%)`;
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