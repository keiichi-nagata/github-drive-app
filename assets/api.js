// GitHub Contents API を薄くラップするクライアント。
// すべての通信は https://api.github.com (HTTPS/443) 経由。

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export class GitHubClient {
  constructor({ token, owner, repo, branch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || "main";
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      ...extra,
    };
  }

  _encodePath(path) {
    return path
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  // ルート ("") でも余分なスラッシュが付かない contents エンドポイント URL を組み立てる
  _contentsUrl(path) {
    const encoded = this._encodePath(path);
    const suffix = encoded ? `/${encoded}` : "";
    return `/repos/${this.owner}/${this.repo}/contents${suffix}`;
  }

  async _request(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      // 書き込み直後の一覧取得が古い応答を返さないよう、常にブラウザキャッシュを迂回する
      cache: "no-store",
      headers: this._headers(options.headers),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.message || "";
      } catch {
        /* ignore */
      }
      throw new GitHubApiError(
        `GitHub API エラー (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // リポジトリへの接続確認
  async verifyRepo() {
    return this._request(`/repos/${this.owner}/${this.repo}`);
  }

  // path 配下の一覧を取得。ルートは path === ""
  // 空リポジトリの場合は 404 なので [] を返す。
  async listContents(path) {
    // _ts はキャッシュ迂回用のダミーパラメータ（GitHub 側・中継プロキシ側のURLキー付きキャッシュ対策）
    const qs = `?ref=${encodeURIComponent(this.branch)}&_ts=${Date.now()}`;
    try {
      const data = await this._request(`${this._contentsUrl(path)}${qs}`);
      return Array.isArray(data) ? data : [data];
    } catch (err) {
      if (err.status === 404) return [];
      throw err;
    }
  }

  // 再帰的にファイル一覧（type === "file"）を取得する。
  // includeGitkeep: true の場合、空フォルダの目印である .gitkeep も含める（フォルダ削除時に必要）
  async listFilesRecursive(path, { includeGitkeep = false } = {}) {
    const entries = await this.listContents(path);
    let files = [];
    for (const entry of entries) {
      if (!includeGitkeep && entry.name === ".gitkeep") continue;
      if (entry.type === "dir") {
        files = files.concat(await this.listFilesRecursive(entry.path, { includeGitkeep }));
      } else {
        files.push(entry);
      }
    }
    return files;
  }

  async getFileMeta(path) {
    const qs = `?ref=${encodeURIComponent(this.branch)}&_ts=${Date.now()}`;
    return this._request(`${this._contentsUrl(path)}${qs}`);
  }

  // ダウンロード用にファイルの中身を ArrayBuffer で取得。
  // raw メディアタイプで api.github.com から直接取得することで、
  // 1MB を超えるファイルや private リポジトリでも同一エンドポイント・同一 CORS 設定で扱える。
  async downloadFile(path) {
    const qs = `?ref=${encodeURIComponent(this.branch)}&_ts=${Date.now()}`;
    const res = await fetch(`${API_BASE}${this._contentsUrl(path)}${qs}`, {
      cache: "no-store",
      headers: this._headers({ Accept: "application/vnd.github.raw" }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.message || "";
      } catch {
        /* ignore */
      }
      throw new GitHubApiError(`ダウンロードに失敗しました (${res.status}): ${detail}`, res.status);
    }
    return res.arrayBuffer();
  }

  // ファイル作成/更新。既存ファイルの場合は sha を渡すこと。
  async putFile(path, arrayBuffer, { message, sha } = {}) {
    const content = arrayBufferToBase64(arrayBuffer);
    const body = {
      message: message || `Upload ${path}`,
      content,
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    return this._request(this._contentsUrl(path), {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteFile(path, sha, message) {
    return this._request(this._contentsUrl(path), {
      method: "DELETE",
      body: JSON.stringify({
        message: message || `Delete ${path}`,
        sha,
        branch: this.branch,
      }),
    });
  }

  // 空フォルダは git に存在できないため .gitkeep を置いて代用する
  async createFolder(path) {
    const keepPath = `${path}/.gitkeep`.replace(/^\/+/, "");
    return this.putFile(keepPath, new ArrayBuffer(0), {
      message: `Create folder ${path}`,
    });
  }

  // フォルダ配下の全ファイル（.gitkeep 含む）を削除する（git 上、空フォルダは自動的に消える）
  async deleteFolder(path) {
    const files = await this.listFilesRecursive(path, { includeGitkeep: true });
    for (const file of files) {
      await this.deleteFile(file.path, file.sha, `Delete folder ${path}`);
    }
  }
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
