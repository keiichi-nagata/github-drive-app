// 簡易パスワードゲート。クライアントのみの静的サイトのため、これは正規の認証ではなく
// 「URLを知っただけの通りすがりの人に画面を触らせない」ための抑止目的の鍵です。
// 実際のファイル読み書きはブラウザごとに保存された GitHub PAT がなければ行えません。

import { ACCESS_PASSWORD_HASH } from "./config.js";

const SESSION_KEY = "githubDriveUnlocked";

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// パスワード未設定なら素通し。設定済みならブラウザタブを開いている間だけ再入力不要。
export function ensureUnlocked() {
  if (!ACCESS_PASSWORD_HASH) return Promise.resolve();
  if (sessionStorage.getItem(SESSION_KEY) === "1") return Promise.resolve();

  const overlay = document.getElementById("lockOverlay");
  const form = document.getElementById("lockForm");
  const input = document.getElementById("lockPassword");
  const errorEl = document.getElementById("lockError");

  overlay.hidden = false;
  input.focus();

  return new Promise((resolve) => {
    form.addEventListener("submit", async function handleSubmit(e) {
      e.preventDefault();
      const hash = await sha256Hex(input.value);
      if (hash === ACCESS_PASSWORD_HASH) {
        sessionStorage.setItem(SESSION_KEY, "1");
        overlay.hidden = true;
        form.removeEventListener("submit", handleSubmit);
        resolve();
      } else {
        errorEl.hidden = false;
        input.value = "";
        input.focus();
      }
    });
  });
}
