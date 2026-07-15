/* --- src/js/instruments/piano/fx.js (修正版) --- */

let churchConvolver = null;
let churchGainNode = null;
let dryGainNode = null; // ★直通音用の音量管理を追加

export async function setupReverb(audioCtx, pianoGain) {
    if (!pianoGain) return;

    // 1. ノードの作成
    if (!churchConvolver) churchConvolver = audioCtx.createConvolver();
    if (!churchGainNode) churchGainNode = audioCtx.createGain();
    if (!dryGainNode) dryGainNode = audioCtx.createGain();

    // 2. 音量の設定（好みに合わせて調整してください）
    churchGainNode.gain.setValueAtTime(0, audioCtx.currentTime); // ★ 異音の原因調査のため一時的に0（リバーブ無効化）
    dryGainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);    // 元の音の強さ

    try {
        const response = await fetch('./assets/church.mp3');
        if (!response.ok) throw new Error("リバーブファイルの取得に失敗しました");
        
        const arrayBuffer = await response.arrayBuffer();
        const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        churchConvolver.buffer = decodedBuffer;

        // --- 3. 接続の再構築 (ここが重要) ---
        // pianoGain から来た音を 2つに分ける
        
        // Aルート：リバーブを通る響き
        pianoGain.connect(churchConvolver);
        churchConvolver.connect(churchGainNode);
        churchGainNode.connect(audioCtx.destination);

        // Bルート：そのままの音（ドライ）
        pianoGain.connect(dryGainNode);
        dryGainNode.connect(audioCtx.destination);

        console.log("Piano FX: 全ての接続が完了しました（二重出力を解消）");
        
    } catch (e) {
        // ロード失敗時は、直通(dry)だけ繋いで音が出るようにする
        pianoGain.connect(audioCtx.destination);
        console.error("Piano FX Error:", e);
    }
}