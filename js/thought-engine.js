/* js/thought-engine.js */

let thoughtInterval = null;
let THOUGHT_DATABASE = null;
let lastThoughtText = ""; 
let currentWeatherCategory = "Default";

export async function initThoughtEngine() {
    try {
        const response = await fetch('js/thought.json'); 
        if (!response.ok) throw new Error("thought.json が見つかりません");
        
        THOUGHT_DATABASE = await response.json();
        console.log("🧠 Thought Engine: Activated");

        // UI（黒板）のレンダリング完了を待ってから箱を確認
        setTimeout(() => {
            const box = document.getElementById('weather-icon-container'); // IDをHTMLに合わせました
            if (box) {
                console.log("✅ Box element found: weather-icon-container");
            } else {
                console.error("❌ Box element NOT FOUND. HTMLのIDは weather-icon-container ですか？");
            }
        }, 2000); 
        
        setTimeout(async () => {
            await runThoughtCycle();
        }, 10000); 
    } catch (e) {
        console.error("❌ Thought Engine Load Error:", e);
    }
}

/**
 * 思考サイクルの制御
 */
async function runThoughtCycle() {
    await generateUnifiedMutter();
}

/**
 * すべての候補を混ぜてから抽選するロジック
 */
/**
 * すべての候補を混ぜてから抽選し、同時に天候ビジュアルを更新する
 */
async function generateUnifiedMutter() {
    if (!THOUGHT_DATABASE) return;

    let pool = [];
    
    // 1. 基本プールの追加
    if (THOUGHT_DATABASE.general) pool.push(...THOUGHT_DATABASE.general);
    if (THOUGHT_DATABASE.trivia) pool.push(...THOUGHT_DATABASE.trivia);
    if (THOUGHT_DATABASE.user_care) pool.push(...THOUGHT_DATABASE.user_care); 

    // 2. 時間帯の追加
    const now = new Date();
    const h = now.getHours();
    if (h >= 5 && h < 11 && THOUGHT_DATABASE.morning) pool.push(...THOUGHT_DATABASE.morning);
    if ((h >= 20 || h < 5) && THOUGHT_DATABASE.night) pool.push(...THOUGHT_DATABASE.night);

    // 3. 天気情報の取得と画像更新（エラーハンドリング強化）
    // fetchWeatherConditionがnullを返しても、画像更新(updateWeatherVisual)が動くようにします
    const weatherData = await fetchWeatherCondition();
    let currentCategory = "Default";

    if (weatherData) {
        // API取得成功時
        if (weatherData.text) pool.push(weatherData.text);
        currentCategory = weatherData.category;
    } else {
        // API失敗時（一瞬のエラーなど）
        console.warn("⚠️ Weather API is currently unavailable. Using default visual.");
    }

    // 取得の成否に関わらず、現在のカテゴリに基づいて画像を更新
    // これにより、APIが切れても「赤い箱」の中身が消えたり止まったりするのを防ぎます
    updateWeatherVisual(currentCategory);

    if (pool.length === 0) {
        // プールが空の場合は、次のサイクルへ
        setTimeout(() => runThoughtCycle(), 5000);
        return;
    }

    // 4. 重複回避の抽選
    let candidates = pool.filter(text => text !== lastThoughtText);
    if (candidates.length === 0) candidates = pool;

    const selectedText = candidates[Math.floor(Math.random() * candidates.length)];
    lastThoughtText = selectedText;
    
    // 黒板へのタイピング演出開始
    typeWriterEffect(selectedText);
}

/**
 * 画像を切り替える関数（デバッグログ付き）
 */
function updateWeatherVisual(category) {
    const container = document.getElementById('weather-icon-container');
    const imgElement = document.getElementById('weather-image');
    
    if (!container || !imgElement) return;

    // カテゴリに応じたファイル名決定
    let fileName = "general.png";
    if (category === "Clear") fileName = "sunny.png";
    if (category === "Rain") fileName = "rain.png";
    if (category === "Clouds") fileName = "sunny.png"; // Clouds時もとりあえずsunnyを表示

    // Vite環境において、JSから動的に指定する場合は相対パス "assets/" が最も安定します
    // /src/assets/ ではなく assets/ を第一候補にする
    const targetSrc = "assets/" + fileName;

    if (!imgElement.src.includes(fileName)) {
        console.log(`🖼️ Attempting to load: ${targetSrc} for category: ${category}`);
        imgElement.src = targetSrc;
        
        // もし assets/ でもダメな場合の最終バックアップ（ルート直下など）
        imgElement.onerror = () => {
            console.error(`❌ Failed to load image at ${imgElement.src}. Trying absolute path...`);
            imgElement.src = "/" + fileName; 
        };
    }

    // 表示を確定させる
    container.style.opacity = "1";
    container.style.backgroundColor = "transparent";
}

/**
 * 天気APIを叩き、取得した天気をグローバルに共有する
 */
async function fetchWeatherCondition() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn("Geolocation not supported");
            resolve(null);
            return;
        }

        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            try {
                const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
                if (response.ok) {
                    const data = await response.json();
                    const code = data.current_weather.weathercode;
                    const condition = mapMeteoCodeToCategory(code);

                    // 🌟 コンソールで内容を確認できるように修正
                    console.log("🌤 [Weather API] Raw Data:", data);
                    console.log("🌤 [Weather API] Resulting Category:", condition);
                    
                    window.currentWeather = condition; 
                    
                    if (typeof updateWeatherVisual === 'function') {
                        updateWeatherVisual(condition);
                    }
                    
                    resolve({ category: condition });
                }
            } catch (e) {
                console.error("Weather fetch failed:", e);
                resolve(null);
            }
        }, () => {
            resolve(null);
        });
    });
}

function mapMeteoCodeToCategory(code) {
    if (code === 0) return "Clear";
    if (code >= 1 && code <= 3) return "Clouds";
    if (code >= 51 && code <= 67) return "Rain";
    if (code >= 71 && code <= 77) return "Snow";
    return "Default";
}

/**
 * 黒板へのタイピング演出
 */
function typeWriterEffect(text) {
    const bubbleText = document.querySelector('#ai-thought-bubble .speech-bubble-text');
    if (!bubbleText) return;

    bubbleText.textContent = "";
    bubbleText.style.transition = "none"; 
    bubbleText.style.opacity = 1;

    let i = 0;
    const speed = 120;

    function type() {
        if (i < text.length) {
            bubbleText.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed + (Math.random() * 100 - 50));
        } else {
            // 30秒間表示を維持
            setTimeout(() => {
                bubbleText.style.transition = "opacity 2.0s";
                bubbleText.style.opacity = 0;
                // 消去完了後、2秒待って次を開始
                setTimeout(() => {
                    runThoughtCycle();
                }, 2000); 
            }, 30000); 
        }
    }
    type();
}