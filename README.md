# GitHub Drive

GitHub リポジトリをストレージにした、OneDrive 風のファイル共有 Web アプリです。
サーバーは使わず、静的ファイルのみで動作します（GitHub Pages でホスト可能）。すべての通信は GitHub の API (`https://api.github.com`) 経由の HTTPS（443番ポート）です。

## できること

- フォルダ作成 / アップロード / ダウンロード / 削除
- フォルダ階層のナビゲーション（パンくずリスト）
- ドラッグ＆ドロップでのアップロード

## アーキテクチャ

- フロントエンドのみ（HTML / CSS / 素の JavaScript、ビルド不要）
- GitHub の [Contents API](https://docs.github.com/ja/rest/repos/contents) を直接ブラウザから呼び出してファイルを読み書き
- ファイルは指定したリポジトリへの git コミットとして保存されます
- 認証には Personal Access Token (PAT) を使用し、**ブラウザの localStorage にのみ**保存します（サーバーには一切送信されません）

### リポジトリ構成の推奨

アプリを配信するリポジトリと、ファイルを保存するリポジトリは **分けることを推奨**します。

- `github-drive-app`（このリポジトリ）: GitHub Pages で静的サイトとして公開
- `my-drive-storage`（別リポジトリ）: アップロードしたファイルの保存先

同じリポジトリを兼用することも可能ですが、アップロードのたびに Pages の自動デプロイが走ったり、アプリのソース履歴とファイル履歴が混在して肥大化するため、分離をおすすめします。

## セットアップ手順

### 1. ファイル保存用リポジトリを作成する

GitHub で新しいリポジトリ（例: `my-drive-storage`）を作成します。

- 公開範囲: 個人利用なら **Private** を強く推奨（Public だと誰でも中身が見えます）
- 「Add a README file」にチェックを入れて作成すると、`main` ブランチが最初から存在するので安心です

### 2. Personal Access Token (PAT) を発行する

[GitHub Settings > Developer settings > Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) から発行します。

- **Repository access**: 「Only select repositories」→ 手順1で作ったリポジトリのみを選択
- **Permissions**: 「Contents」を **Read and write** に設定（他は不要）
- **Expiration**: 必要に応じて短めの期限を設定し、期限が切れたら再発行してください

⚠️ classic トークン（`ghp_...`）も動作しますが、権限がアカウント全体に及ぶため fine-grained トークンを強く推奨します。

### 3. このアプリをホストする

このフォルダ一式（`index.html`, `assets/`）を GitHub リポジトリに push し、Settings > Pages で GitHub Pages を有効化してください。有効化すると `https://<ユーザー名>.github.io/<リポジトリ名>/` で HTTPS 配信されます。

ローカルで試す場合は、任意の静的サーバーで配信してください（`type="module"` を使っているため `file://` では動作しません）。例:

```
npx serve .
```

### 4. アプリ側で接続設定をする

1. 公開した URL にブラウザでアクセス
2. 右上の ⚙️ をクリック
3. 手順2で発行した PAT、手順1のオーナー名・リポジトリ名・ブランチ名（`main` など）を入力して「接続して保存」

以降はブラウザにトークンが保存され、次回アクセス時も自動的に接続されます。

## セキュリティ上の注意

- PAT はブラウザの localStorage に平文で保存されます。共有 PC や信頼できない端末では使用しないでください。
- 必ず対象リポジトリのみ・Contents 権限のみに絞った fine-grained PAT を使ってください。
- ファイル保存用リポジトリは Private を推奨します。Public リポジトリを使うと、このアプリを介さずとも GitHub 上で誰でもファイルを閲覧できてしまいます。
- このアプリの URL（GitHub Pages）自体は誰でも開けますが、有効な PAT を持たない限りファイル一覧の取得や操作はできません。

## 制限事項

- 1ファイルあたり約 90MB まで（GitHub Contents API の実用上の上限に基づく安全マージン）。100MB を超えるファイルは GitHub 側で拒否されます。
- GitHub には空フォルダの概念がないため、新規フォルダ作成時に内部的に `.gitkeep` という空ファイルを置いています（一覧には表示されません）。
- アップロード・削除のたびに GitHub 上へ1コミットが作成されます。
