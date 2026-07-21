# librarian

近くの図書館で借りられる人気本ランキングを表示するWebアプリです。

楽天ブックスAPIの人気本ランキングと、カーリルAPIの図書館蔵書・貸出状況を組み合わせて、「今人気の本のうち、あなたの近くの図書館で今すぐ借りられる本」を見つけられます。

## 主な機能

- **人気本ランキング表示** — 楽天ブックスの書籍を「レビュー数順（定番人気）」「販売数順（今の話題作）」「評価の高い順」で表示します。ジャンル（総合・漫画・小説・文庫・ライトノベル・児童書・ビジネス・語学など）で絞り込めます。
- **評価の高い順（信頼できるレビュー数のみ）** — 「評価順」は、レビュー1〜数件の★5.0本が上位を占めて信頼できない問題を避けるため、レビュー件数の多い本を母集団にし、**レビュー50件以上**のものだけを★平均の高い順に並べます。
- **地域の図書館検索** — 地方ごとにまとめた県名から都道府県を選び、続いて市区町村を選ぶと、近隣の公共図書館システムの一覧を取得します（大学・専門図書館は一般利用が難しいため除外）。市区町村の選択肢はカーリルが返す市区町村名から作るため、表記ゆれで0件になりません。
- **現在地から探す** — ワンタップで現在地の近くにある図書館システムを距離順に表示します（位置情報が使える環境でのみボタンが出ます）。
- **貸出状況の表示** — 各本が近隣の図書館に所蔵されているか、今「貸出可」かをバッジで表示します。「館ごとの状況」を開くと分館ごとの貸出状況が確認でき、予約ページへのリンクも表示します。
- **本のあらすじ・詳細表示** — 各本の「あらすじを見る」であらすじを開閉でき、出版社・発売日・レビュー（★平均・件数）も表示します。
- **即時表示＋後追い反映** — ランキングは楽天のみを先に返して高速表示し（約0.4秒）、貸出状況はあとから取得してバッジを更新します。
- **絞り込み収集モード** — 「貸出可の本だけ」「蔵書のある本だけ」など条件に合致する本を複数ページ走査してまとめて収集します。「もっと探す」で続きを収集できます。
- **設定の記憶** — 前回選んだ都道府県・市区町村・図書館・ジャンル・並び順をブラウザに保存し、次回アクセス時に自動で復元します。
- **ダークモード** — ヘッダーのトグルでライト／ダークを切り替えられます（OSの設定にも自動追従。選択は保存されます）。

## 動作の仕組み

```
ブラウザ ──▶ Express サーバ ──┬──▶ 楽天ブックスAPI（ランキング・ISBN取得）
                             └──▶ カーリルAPI（図書館検索・蔵書/貸出状況）
```

- ランキングは楽天ブックス検索API（`BooksBook/Search`）を `sort=sales` / `sort=reviewCount` で取得します。楽天ブックスに専用のランキングAPIは無く、また市場ランキングAPIはISBNを返さずカーリル照合に使えないため、書籍検索APIを利用しています。
- 貸出状況はカーリルの `check` API（非同期）をポーリングして取得します。この処理は仕様上30秒前後かかるため、UIは「即時表示＋後追い反映」で待たせずに見せる設計にしています。

## セットアップ

### 必要なもの

- Node.js（ES Modules / `--watch` を使うため v18 以降を推奨）
- 各APIの利用キー
  - **カーリルAPI** — [https://calil.jp/doc/api.html](https://calil.jp/doc/api.html) で利用申請して取得
  - **楽天ウェブサービス** — [https://webservice.rakuten.co.jp/](https://webservice.rakuten.co.jp/) でアプリIDを取得

### 手順

1. 依存パッケージをインストールします。

   ```bash
   npm install
   ```

2. `.env.example` をコピーして `.env` を作成し、取得したキーを設定します。

   ```bash
   cp .env.example .env
   ```

   ```dotenv
   # カーリルAPI（図書館貸出状況）
   CALIL_APPKEY=your_calil_appkey_here

   # 楽天ウェブサービス（楽天ブックスAPI）
   RAKUTEN_APP_ID=your_rakuten_application_id_here
   RAKUTEN_ACCESS_KEY=your_rakuten_access_key_here
   # 楽天アプリ管理画面の「許可されたWebサイト」に登録したURL（Referer/Originとして送信される）
   RAKUTEN_ALLOWED_SITE_URL=https://example.com

   PORT=3000
   ```

3. サーバを起動します。

   ```bash
   npm start        # 通常起動
   npm run dev      # ファイル変更を監視して自動再起動
   ```

4. ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

## APIエンドポイント

サーバは静的フロントエンド（`public/`）と、以下のJSON APIを提供します。

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/prefectures` | 都道府県一覧 |
| GET | `/api/cities?pref=` | その都道府県で図書館がある市区町村名の一覧 |
| GET | `/api/genres` | 楽天ブックスのジャンル一覧 |
| GET | `/api/libraries?pref=&city=` | 地域の公共図書館システム一覧 |
| GET | `/api/libraries?lat=&lng=&limit=` | 現在地から近い公共図書館システム一覧（距離順） |
| GET | `/api/ranking?genreId=&page=&sort=` | 人気本ランキング（楽天のみ・高速） |
| GET | `/api/ranking/top-rated?genreId=` | 評価の高い順（レビュー50件以上の本を★平均降順・1時間キャッシュ） |
| GET | `/api/availability?isbns=&systemIds=&systemNames=` | 指定ISBN群の貸出状況（後追い反映用） |
| GET | `/api/ranking/collect?systemIds=&genreId=&filter=&startPage=&sort=` | 条件に合致する本を複数ページ走査して収集 |

- `sort` … `reviewCount`（デフォルト・定番人気）/ `sales`（今の話題作）/ `reviewAverage`（評価の高い順）。`reviewAverage` はフロントで `/api/ranking/top-rated` に振り分けられる（楽天の生の評価順は低レビュー数の本が上位を占めるため使わない）
- `filter` … `available`（貸出可）/ `onloan`（貸出中）/ `held`（蔵書あり）

## ディレクトリ構成

```
librarian/
├── server.js               Express サーバのエントリポイント
├── docs/
│   └── design-brief.md     デザインブリーフ（Figma AI 用の UI 仕様書）
├── src/
│   ├── routes/
│   │   └── api.js           APIルーティングとロジック
│   ├── services/
│   │   ├── rakutenService.js  楽天ブックスAPI 呼び出し
│   │   └── calilService.js    カーリルAPI 呼び出し（ポーリング）
│   └── data/
│       ├── prefectures.js   都道府県データ
│       └── genres.js        楽天ブックスのジャンル定義
└── public/                 フロントエンド（HTML / CSS / JS）
    ├── index.html
    ├── css/style.css
    └── js/
        ├── pref-map.js     都道府県の地方区分データ
        └── app.js
```

## 技術スタック

- [Express](https://expressjs.com/) — Webサーバ
- [axios](https://axios-http.com/) — HTTPクライアント
- [dotenv](https://github.com/motdotla/dotenv) — 環境変数の読み込み
- フロントエンドは依存フレームワークなしの素のHTML / CSS / JavaScript

## ライセンス・注意事項

- 本アプリは [カーリルAPI](https://calil.jp/doc/api.html) と [楽天ウェブサービス](https://webservice.rakuten.co.jp/) を利用しています。各サービスの利用規約に従ってください。
- `.env`（APIキー）は Git 管理対象外です。公開リポジトリにコミットしないでください。
