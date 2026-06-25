# PianoWorks

ブラウザ上で動作する、AI支援つきのピアノ演奏・練習アプリです。Vite構成のWebアプリ（PWA対応）として実装されています。

## モード構成

- **Perform** — 動画を読み込みながらガイド演奏できるモード
- **Session** — AIとの掛け合いで即興演奏を楽しむモード（ジャンル：jazz / anison / classic を選択可能）
- **Studio** — MIDIスコアに沿って演奏を採点するゲーム形式の練習モード

## セットアップ

```bash
npm install
npm run dev
```

`npm run dev` で開発サーバーが起動します（デフォルトポート: `1430`）。

```bash
npm run build
npm run preview
```

で本番ビルド・プレビューができます。

## 既知の制約

- `js/ai-engine.js` が読み込む `model_token.onnx`（推論本体モデル）は本リポジトリには含まれていません。モデルが存在しない場合、AIは簡易フォールバック（ランダムウォーク）で動作します。
- `ort-wasm-simd-threaded.jsep.mjs` はローカル開発用のスタブファイル（ダミー実装）です。本番でONNX Runtime Webをフルに使う場合は、公式の `onnxruntime-web` パッケージから該当ファイルを配置してください。
- Sessionモードの「天候」連動演出は、ブラウザの位置情報（Geolocation API）と [Open-Meteo](https://open-meteo.com/) の無料APIを利用します。APIキーは不要です。

## ディレクトリ構成

```
index.html
js/            アプリ本体のロジック（モード別: perform / session / studio）
css/           スタイル
assets/        画像・アイコン等
vite.config.js
package.json
```
