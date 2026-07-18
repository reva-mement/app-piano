/* js/thought-engine.js */

let thoughtInterval = null;
let THOUGHT_DATABASE = null;
let lastThoughtText = ""; 
let currentWeatherCategory = "Default";

/**
 * ★ 黒板の人物画像を切り替える共通関数。
 * 実際にペンで描画するわけではなく、CSSの mask-image を使って
 * 「左上から右下にかけて斜めに描き進む」ような見た目のワイプ演出だけを行う。
 * Session/Studioモード開始時や、天候・状態が変わった時など、
 * どこからでもこの関数経由で画像を切り替えることで演出を統一する。
 */
/**
 * ★ セリフ欄のテキストを即座に差し替える（タイプライター演出なしの即時表示）。
 * 例: Session/Studio開始時に「〜♪」を表示する用途など。
 */
export function setBubbleText(text) {
    bubbleGeneration++; // ★ 進行中のtypeWriterEffectのタイピングを無効化してから上書きする
    const myGeneration = bubbleGeneration;
    const bubbleText = document.querySelector('#ai-thought-bubble .speech-bubble-text');
    if (!bubbleText) return;
    bubbleText.style.transition = "none";
    bubbleText.style.opacity = 1;
    bubbleText.textContent = text;

    // ★★★ 修正：typeWriterEffect()と同じく「30秒表示→フェードアウト→
    //   次のセリフサイクルへ」という継続処理をここにも追加する。
    //   これが無いと、setBubbleText()で表示した内容（GAME ON終了後の
    //   スコア発表など）がそのまま固定表示され続け、キャラクターが
    //   二度と通常のセリフサイクルへ戻らなくなってしまっていた。
    setTimeout(() => {
        if (myGeneration !== bubbleGeneration) return; // 別の表示に切り替わっていたら何もしない
        bubbleText.style.transition = "opacity 2.0s";
        bubbleText.style.opacity = 0;
        setTimeout(() => {
            if (myGeneration !== bubbleGeneration) return;
            runThoughtCycle();
        }, 2000);
    }, 30000);
}

export function setCharacterImage(fileName, { animate = true, durationMs = 1800 } = {}) {
    const imgElement = document.getElementById('weather-image');
    if (!imgElement) return;

    const targetSrc = "assets/" + fileName;
    if (imgElement.src.includes(fileName)) return; // 既に同じ画像なら何もしない

    // ★ 修正："/" + fileName という絶対パスへのフォールバックは、
    //   GitHub Pagesのようにサブパス配信（例: https://xxx.github.io/app-piano/）の環境では
    //   ドメイン直下を指してしまい、常に404になる上コンソールにエラーが溜まり続けるだけだったため撤去。
    //   assets/ 以下の相対パスは <base href="./"> により常に正しいページ基準で解決されるので、
    //   ここでは読み込み失敗時に一度だけ警告を出すだけに留める。
    imgElement.onerror = () => {
        console.error(`❌ Failed to load image at ${imgElement.src}（assetsフォルダにファイルが存在するか確認してください）`);
        imgElement.onerror = null; // 無限リトライ防止
    };

    if (!animate) {
        imgElement.src = targetSrc;
        imgElement.style.webkitMaskImage = '';
        imgElement.style.maskImage = '';
        return;
    }

    // 開始時点：まだ何も描かれていない（全て隠れている）状態にする
    const hiddenMask = 'linear-gradient(135deg, transparent 0%, transparent 0%)';
    imgElement.style.webkitMaskImage = hiddenMask;
    imgElement.style.maskImage = hiddenMask;

    // 画像を差し替えてから、斜め（左上→右下）にマスクの境界を進めて「描き出す」
    imgElement.src = targetSrc;

    const start = performance.now();
    function step(now) {
        const t = Math.min(1, (now - start) / durationMs);
        // 135deg = 左上から右下へ向かう対角線。境界を0%→150%まで動かし、
        // 端まで確実に描き切れるようオーバーシュートさせている。
        const reveal = t * 150;
        const edge = Math.min(100, reveal + 14); // 境界のぼかし幅（チョークの粒立ち感）
        const mask = `linear-gradient(135deg, #000 ${Math.max(0, reveal - 14)}%, #000 ${reveal}%, transparent ${edge}%)`;
        imgElement.style.webkitMaskImage = mask;
        imgElement.style.maskImage = mask;

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            // 演出終了後はmaskを解除して通常表示に戻す（以降の見た目に影響を残さないため）
            imgElement.style.webkitMaskImage = '';
            imgElement.style.maskImage = '';
        }
    }
    requestAnimationFrame(step);
}

export async function initThoughtEngine() {
    try {
        const response = await fetch('js/thought.json'); 
        if (!response.ok) throw new Error("thought.json が見つかりません");
        
        THOUGHT_DATABASE = await response.json();
        console.log("🧠 Thought Engine: Activated");

        // ★ 起動直後の初期表示は neutral.png（天候取得やモード開始より前に確定させる）
        setCharacterImage('neutral.png', { animate: false });

        // ★ 初回訪問かどうかを判定する（main.js の showFirstVisitHelpTip() と同じキーを見る。
        //   ここでは読み取るだけで、実際にフラグを立てるのは main.js 側の責務のまま）
        const isFirstVisit = !localStorage.getItem('pw_seen_help_tip');

        if (isFirstVisit) {
            // ★ 初回訪問時は、天気セリフより先にウェルカムメッセージを表示する。
            //   ローディング画面（4秒表示＋2秒フェード＝計6秒）が完全に終わるまで待つ。
            setTimeout(() => {
                setCharacterImage('smiling.png');
                typeWriterEffect('こんにちは！PianoWorksへようこそ。基本操作は右上のヘルプボタンから確認できます！');
            }, 6300);
        } else {
            // ★ 天気の取得が終わり次第、最初の1回だけ「天気固定」の画像・セリフに更新する
            //   （geolocation許可待ち等で多少時間がかかることがあるため、少し余裕を持たせる）
            setTimeout(() => {
                triggerInitialWeatherThought();
            }, 1500);
        }

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
            // ★ 初回訪問時は、上のウェルカムメッセージが typeWriterEffect の
            //   通常のチェーン（表示保持→フェード→次のサイクル）に乗って
            //   自動的に通常サイクルへ引き継がれるため、ここでは何もしない
            //   （両方が同時に動くと表示が競合してしまうため）。
            if (isFirstVisit) return;

            // ★ ロード後は、まず季節にちなんだセリフを一度だけ試す
            //   （天気がClearでない等の理由で表示できなければ、通常サイクルへ）
            const shown = await triggerSeasonalThought();
            if (!shown) {
                await runThoughtCycle();
            }
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
        currentCategory = weatherData.category;
    } else {
        // API失敗時（一瞬のエラーなど）
        console.warn("⚠️ Weather API is currently unavailable. Using default visual.");
    }

    // 取得の成否に関わらず、現在のカテゴリに基づいて画像を更新
    // これにより、APIが切れても「赤い箱」の中身が消えたり止まったりするのを防ぎます
    updateWeatherVisual(currentCategory);

    // ★ 約10%の確率で、通常のセリフの代わりにLevaCraft案内を表示する。
    //   天気取得・ビジュアル更新は上で必ず一度実行済みなので、ここでは
    //   文言と画像（smiling.png）だけを上書きする（他の処理はスキップしない）。
    if (Math.random() < 0.1) {
        const promoText = "LevaCraftのことをもっと知りたいんだったら、右上の歯車のボタンに入り口がありますよ。";
        setCharacterImage('smiling.png');
        lastThoughtText = promoText;
        typeWriterEffect(promoText);
        return;
    }

    // ★ Rain（window_rainy.png）/ Clear（window_sunny.png）表示中は、
    //   他の候補と混ぜず、天気にちなんだセリフを優先して使う
    if (weatherData && weatherData.text && (currentCategory === "Rain" || currentCategory === "Clear")) {
        lastThoughtText = weatherData.text;
        typeWriterEffect(weatherData.text);
        return;
    }

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
// ★ 天気に該当しない（＝Default等）時にランダムで抽選する候補群
const RANDOM_CHARACTER_POOL = [
    "neutral.png", "crying.png", "smiling.png",
    "slanted.png", "slanted_smiling.png", "sideways.png"
];

function updateWeatherVisual(category) {
    const container = document.getElementById('weather-icon-container');
    const imgElement = document.getElementById('weather-image');
    
    if (!container || !imgElement) return;

    // ★ カテゴリに応じたファイル名決定（窓越しの天候イラストに変更）
    let fileName;
    if (category === "Clear") fileName = "window_sunny.png";
    else if (category === "Rain") fileName = "window_rainy.png";
    else if (category === "Clouds") fileName = "window_cloudy.png";
    else {
        // ★ 天気に関する描画（Clear/Rain/Clouds）以外は、singを除く表情差分からランダムに出す
        fileName = RANDOM_CHARACTER_POOL[Math.floor(Math.random() * RANDOM_CHARACTER_POOL.length)];
    }

    // ★ 黒板にチョークで描くような斜めワイプ演出付きで切り替える
    setCharacterImage(fileName);

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
                    const temp = Math.round(data.current_weather.temperature);

                    // 🌟 コンソールで内容を確認できるように修正
                    console.log("🌤 [Weather API] Raw Data:", data);
                    console.log("🌤 [Weather API] Resulting Category:", condition);
                    
                    window.currentWeather = condition; 
                    
                    if (typeof updateWeatherVisual === 'function') {
                        updateWeatherVisual(condition);
                    }

                    // ★ 天気カテゴリ・気温・季節に応じたセリフを生成
                    const weatherText = generateWeatherThought(condition, temp);
                    
                    resolve({ category: condition, text: weatherText, temp });
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

/**
 * ★ 天気カテゴリ・気温・季節に応じたセリフを生成する（通常サイクル用・季節は考慮しない）。
 *   - Rain（window_rainy.png表示時）: 雨にちなんだセリフ
 *   - Clear（window_sunny.png表示時）: 気温とピアノにちなんだセリフ
 */
function generateWeatherThought(category, temp) {
    if (category === "Rain") {
        const rainLines = [
            "雨の日は、鍵盤の音がいつもより少し丸く聞こえる気がします。",
            "雨音とピアノの音色って、意外と相性がいいんですよね。",
            "しとしと降る雨を眺めながら弾くピアノも、悪くないものです。",
            "雨の匂いがすると、なんだか静かな曲を弾きたくなります。",
            "傘の音とピアノの音、今日はどちらが主役でしょうか。"
        ];
        return rainLines[Math.floor(Math.random() * rainLines.length)];
    }

    if (category === "Clear") {
        const clearLines = [
            `今日は${temp}度か。この気温だと、鍵盤の響きも少し変わって聞こえるかもしれません。`,
            `気温${temp}度、いい陽気ですね。窓を開けて弾くのも気持ちよさそうです。`,
            `${temp}度のこの陽気なら、指もよく動きそうです。`,
            `晴れて${temp}度。こんな日は、明るい曲を弾きたくなりますね。`
        ];
        return clearLines[Math.floor(Math.random() * clearLines.length)];
    }

    if (category === "Clouds") {
        const cloudLines = [
            `曇り空で${temp}度か。落ち着いた響きの曲が似合いそうです。`,
            `気温${temp}度の曇り日です。柔らかい光の中で、静かに鍵盤に向かうのもいいものです。`,
            `${temp}度のどんよりした空も、ピアノの音色を聴けば気分が変わるかもしれません。`,
            `雲に隠れた${temp}度の陽気。派手すぎない、穏やかな一曲はいかがですか。`
        ];
        return cloudLines[Math.floor(Math.random() * cloudLines.length)];
    }

    return null;
}

/**
 * ★ アプリ起動直後、最初の1回だけ呼び出す専用関数。
 *   天気を取得し、画像(window_sunny/rainy/cloudy等)とセリフを
 *   必ず天気にちなんだものに固定して表示する。
 *   これ以降は既存のアルゴリズム（triggerSeasonalThought → runThoughtCycle）に任せる。
 */
export async function triggerInitialWeatherThought() {
    const weatherData = await fetchWeatherCondition();
    const category = weatherData ? weatherData.category : "Default";

    // ★ 画像を天気に応じて確定（Default時はneutral.png等、既存ロジックに委ねる）
    updateWeatherVisual(category);

    // ★ セリフも天気にちなんだものを表示（Rain/Clear/Cloudsのみ対応。
    //   天気が取得できない/該当しない場合は、画像切り替えのみ行いセリフは変えない）
    if (weatherData) {
        const text = generateWeatherThought(category, weatherData.temp);
        if (text) {
            lastThoughtText = text;
            typeWriterEffect(text);
        }
    }
}

/**
 * ★ 季節（春・夏・秋・冬）＋気温＋ピアノにちなんだセリフを生成する。
 *   通常サイクルでは使わず、triggerSeasonalThought() 経由でのみ使用する
 *   （ロード後・各モード再生後に一度だけ表示するため）。
 */
function getSeason(month) {
    if (month === 12 || month === 1 || month === 2) return "winter";
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    return "autumn"; // 9〜11月
}

function generateSeasonalWeatherThought(temp) {
    const month = new Date().getMonth() + 1; // 1〜12
    const season = getSeason(month);

    const SEASON_LINES = {
        winter: [
            `冬の${temp}度か……指がかじかむ前に、少し弾いてみましょうか。`,
            `気温${temp}度の冬晴れです。冷えた指先も、弾いているうちに温まってきますね。`,
            `${temp}度の澄んだ冬の空気は、ピアノの音もよく響く気がします。`,
            `冬の陽だまりの中で、${temp}度の空気を感じながら一曲どうですか。`
        ],
        spring: [
            `春の陽気、${temp}度か。花びらが舞う中で弾く曲も、きっと素敵でしょうね。`,
            `気温${temp}度の春らしい陽気です。指先も軽やかに動きそうです。`,
            `${temp}度の春風が心地いいです。新しい曲に挑戦してみるのはどうでしょう。`,
            `春の${temp}度。芽吹く季節にぴったりの、明るい旋律が浮かびます。`
        ],
        summer: [
            `夏の${temp}度、なかなか暑いですね。涼しい音色の曲を弾きたくなります。`,
            `気温${temp}度の夏空です。汗ばむ陽気の中、指先だけは軽やかにいきましょう。`,
            `${temp}度の真夏日。冷房の効いた部屋で、ゆったりピアノに向かうのもいいものです。`,
            `夏の${temp}度。セミの声に負けないくらい、元気な曲はいかがですか。`
        ],
        autumn: [
            `秋の${temp}度、過ごしやすい陽気ですね。落ち着いた曲が似合いそうです。`,
            `気温${temp}度の秋晴れです。紅葉を眺めながら弾くピアノも素敵でしょうね。`,
            `${temp}度の秋風が心地いいです。少し物思いにふけるような一曲はどうでしょう。`,
            `秋の${temp}度。実りの季節にふさわしい、豊かな響きを奏でてみませんか。`
        ]
    };

    const pool = SEASON_LINES[season];
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * ★ 季節にちなんだセリフを「今すぐ一度だけ」表示する。
 *   ロード完了時、および各モード（Session/Studio/GAME ON）の再生終了時に呼び出す。
 *   天気がClear（window_sunny.png表示時）でない場合は何もしない。
 */
export async function triggerSeasonalThought() {
    if (!THOUGHT_DATABASE) return false; // 初期化前は何もしない

    const weatherData = await fetchWeatherCondition();
    if (!weatherData || weatherData.category !== "Clear") return false;

    const seasonalText = generateSeasonalWeatherThought(weatherData.temp);
    if (!seasonalText) return false;

    lastThoughtText = seasonalText;
    typeWriterEffect(seasonalText);
    return true;
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
// ★ セリフ表示の「世代」カウンタ。typeWriterEffectが継続中でも、
//   setBubbleText()やtypeWriterEffect()の新しい呼び出しがあれば世代を進め、
//   古いタイピング処理が後から文字を継ぎ足してしまうのを防ぐ。
let bubbleGeneration = 0;

function typeWriterEffect(text) {
    const bubbleText = document.querySelector('#ai-thought-bubble .speech-bubble-text');
    if (!bubbleText) return;

    bubbleGeneration++;
    const myGeneration = bubbleGeneration;

    bubbleText.textContent = "";
    bubbleText.style.transition = "none"; 
    bubbleText.style.opacity = 1;

    let i = 0;
    const speed = 120;

    function type() {
        if (myGeneration !== bubbleGeneration) return; // ★ 途中で別の表示に切り替わっていたら中断
        if (i < text.length) {
            bubbleText.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed + (Math.random() * 100 - 50));
        } else {
            // 30秒間表示を維持
            setTimeout(() => {
                if (myGeneration !== bubbleGeneration) return;
                bubbleText.style.transition = "opacity 2.0s";
                bubbleText.style.opacity = 0;
                // 消去完了後、2秒待って次を開始
                setTimeout(() => {
                    if (myGeneration !== bubbleGeneration) return;
                    runThoughtCycle();
                }, 2000); 
            }, 30000); 
        }
    }
    type();
}