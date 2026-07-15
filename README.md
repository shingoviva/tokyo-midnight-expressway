# Tokyo After Midnight

東京の深夜の首都高速を、リアルタイムのプロシージャル描画で無限に走行する映像作品です。道路、高架、都市、交通、照明、環境音をブラウザ内で生成し続けます。

公開版: https://tokyo-after-midnight.shingo5555.chatgpt.site/

デスクトップとiPhoneのSafariに対応しています。iPhoneでは開始画面の `START` をタップすると、端末性能に合わせた描画品質で走行を開始します。音声は初期状態でオフです。

## 操作

- `START` / `Enter`: 映像を開始
- `Space` / `P`: 一時停止・再開
- `↑` / `↓`: 走行速度
- `M`: プロシージャル環境音
- `B`: 街灯・テールライトのモーションブラー強調
- `F`: フルスクリーン
- `H`: HUD表示切替
- マウスホイール: 走行速度

## 起動

```bash
npm install
npm run dev
```

```bash
npm run build
npm test
```
