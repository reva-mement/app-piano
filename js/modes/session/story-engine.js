/**
 * PianoWorks - 命のストーリー・エンジン (Story Engine)
 * パス: js/modes/session/story-engine.js
 */

export class StoryEngine {
    constructor() {
        this.storyType = 'A';  // 'A':打鍵熱量, 'B':マルチ波形, 'C':ONNX温度カオス
        this.startTime = 0;
        this.duration = 180;   // ストーリーの基本周期：3分(180秒)
        this.userEnergy = 0.0; // ユーザーのリアルタイム打鍵熱量
        this.waveType = 0;     // 展開B用の波形選択
    }

    /**
     * セッション開始（PLAY）時にストーリー展開のルートを完全ランダム抽選
     */
    init(audioContextTime) {
        this.startTime = audioContextTime;
        this.userEnergy = 0.0;
        
        const types = ['A', 'B', 'C'];
        this.storyType = types[Math.floor(Math.random() * types.length)];
        this.waveType = Math.floor(Math.random() * 3); 

        console.log(`🎭 【ストーリーガチャ】👉 『展開 ${this.storyType}』でアセンブル開始。`);
        if (this.storyType === 'B') {
            const waves = ['王道サイン波', 'ジェットコースター', '終始たゆたい(ダウン)'];
            console.log(` └─ 📊 波形ルート: ${waves[this.waveType]}`);
        }
    }

    /**
     * ユーザーが鍵盤を叩いた熱量をチャージ（session.jsから叩かれる）
     */
    chargeEnergy(velocity) {
        // 連打されるほど蓄積（最大1.5まで許容して一時的なバーストを演出）
        this.userEnergy = Math.min(1.5, this.userEnergy + (velocity * 0.2));
    }

    /**
     * 進行度に基づき、現在のエモーショナル・インデックス E (0.0 〜 1.0) を算出
     */
    getCurrentIndex(currentAudioTime) {
        if (this.startTime === 0) return { emotionalIndex: 0.2, storyType: 'C' };

        const elapsed = currentAudioTime - this.startTime;
        let t = Math.min(1.0, elapsed / this.duration); // 3分で1.0に達する進行度

        // 毎フレーム、ユーザーの熱量は自然冷却（減衰）させる
        this.userEnergy *= 0.93; 

        let E = 0.0;

        switch (this.storyType) {
            case 'A':
                // 🔥 【展開A：打鍵熱量ドライブ型】ユーザーの情熱がタイムラインを支配
                E = Math.min(1.0, (t * 0.2) + (this.userEnergy * 0.8));
                break;

            case 'B':
                // 📊 【展開B：マルチ波形バイオリズム型】AIが自律的な感情の波を描く
                if (this.waveType === 0) {
                    E = Math.sin(t * Math.PI * 0.5); // 王道：後半へ向けて上昇
                } else if (this.waveType === 1) {
                    E = t < 0.2 ? 0.85 : (t < 0.6 ? 0.15 : 0.95); // ジェットコースター
                } else {
                    E = t > 0.92 ? 1.0 : 0.25; // ダウン：最後だけ奇跡が起きる
                }
                break;

            case 'C':
            default:
                // 🌡️ 【展開C：ONNX温度カオス・ドライブ型】時間経過とともにAIの理性が融解
                E = t;
                break;
        }

        return {
            emotionalIndex: Math.max(0.0, Math.min(1.0, E)), // 0〜1に安全にクランプ
            storyType: this.storyType
        };
    }
}

export const storyEngine = new StoryEngine();