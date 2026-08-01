import { GitHubClient, GitHubApiError } from "./api.js";
import { ensureUnlocked } from "./lock.js";

const STORAGE_KEY = "githubDriveConfig";
const MAX_FILE_SIZE = 90 * 1024 * 1024; // GitHub Contents API の実用上限に合わせた安全マージン

const el = {
  repoLabel: document.getElementById("repoLabel"),
  repoIndicator: document.getElementById("repoIndicator"),
  settingsBtn: document.getElementById("settingsBtn"),
  breadcrumb: document.getElementById("breadcrumb"),
  newFolderBtn: document.getElementById("newFolderBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  downloadSelectedBtn: document.getElementById("downloadSelectedBtn"),
  deleteSelectedBtn: document.getElementById("deleteSelectedBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  emptyState: document.getElementById("emptyState"),
  fileTable: document.getElementById("fileTable"),
  fileTableBody: document.getElementById("fileTableBody"),
  selectAllCheckbox: document.getElementById("selectAllCheckbox"),
  toastContainer: document.getElementById("toastContainer"),

  settingsModal: document.getElementById("settingsModal"),
  settingsForm: document.getElementById("settingsForm"),
  inputToken: document.getElementById("inputToken"),
  inputOwner: document.getElementById("inputOwner"),
  inputRepo: document.getElementById("inputRepo"),
  inputBranch: document.getElementById("inputBranch"),
  clearTokenBtn: document.getElementById("clearTokenBtn"),
  cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),

  newFolderModal: document.getElementById("newFolderModal"),
  newFolderForm: document.getElementById("newFolderForm"),
  newFolderName: document.getElementById("newFolderName"),
  cancelNewFolderBtn: document.getElementById("cancelNewFolderBtn"),

  progressOverlay: document.getElementById("progressOverlay"),
  progressText: document.getElementById("progressText"),
  progressFill: document.getElementById("progressFill"),
};

let client = null;
let currentPath = []; // パスセグメントの配列
let currentEntries = []; // 現在のフォルダに表示中のエントリ一覧
const selection = new Map(); // path -> entry（現在のフォルダ内での選択状態）

// ---------- ユーティリティ ----------

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  el.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function formatSize(bytes) {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function pathString(segments) {
  return segments.join("/");
}

function showProgress(text) {
  el.progressText.textContent = text;
  el.progressFill.style.width = "0%";
  el.progressOverlay.hidden = false;
}

function updateProgress(ratio, text) {
  el.progressFill.style.width = `${Math.round(ratio * 100)}%`;
  if (text) el.progressText.textContent = text;
}

function hideProgress() {
  el.progressOverlay.hidden = true;
}

function handleError(err, fallbackMessage) {
  console.error(err);
  if (err instanceof GitHubApiError) {
    if (err.status === 401) {
      showToast("認証エラー: トークンが無効です。設定を確認してください。", "error");
      return;
    }
    showToast(err.message, "error");
    return;
  }
  showToast(fallbackMessage || err.message || "不明なエラーが発生しました", "error");
}

// ---------- 設定の読み書き ----------

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

function setToolbarEnabled(enabled) {
  el.newFolderBtn.disabled = !enabled;
  el.uploadBtn.disabled = !enabled;
  el.refreshBtn.disabled = !enabled;
  if (!enabled) clearSelection();
  updateSelectionButtons();
}

// ---------- 選択状態 ----------

function clearSelection() {
  selection.clear();
  el.selectAllCheckbox.checked = false;
  el.selectAllCheckbox.indeterminate = false;
  updateSelectionButtons();
}

function updateSelectionButtons() {
  const enabled = !!client && selection.size > 0;
  el.downloadSelectedBtn.disabled = !enabled;
  el.deleteSelectedBtn.disabled = !enabled;
}

function syncSelectAllCheckbox() {
  const total = currentEntries.length;
  const checkedCount = selection.size;
  el.selectAllCheckbox.checked = total > 0 && checkedCount === total;
  el.selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < total;
}

function toggleSelection(entry, checked, tr) {
  if (checked) {
    selection.set(entry.path, entry);
  } else {
    selection.delete(entry.path);
  }
  tr.classList.toggle("row-selected", checked);
  syncSelectAllCheckbox();
  updateSelectionButtons();
}

el.selectAllCheckbox.addEventListener("change", () => {
  const checked = el.selectAllCheckbox.checked;
  selection.clear();
  if (checked) {
    currentEntries.forEach((entry) => selection.set(entry.path, entry));
  }
  el.fileTableBody.querySelectorAll("tr").forEach((tr) => {
    tr.classList.toggle("row-selected", checked);
    const cb = tr.querySelector(".entry-checkbox");
    if (cb) cb.checked = checked;
  });
  el.selectAllCheckbox.indeterminate = false;
  updateSelectionButtons();
});

// ---------- 設定モーダル ----------

function openSettingsModal() {
  const config = loadConfig();
  if (config) {
    el.inputToken.value = config.token || "";
    el.inputOwner.value = config.owner || "";
    el.inputRepo.value = config.repo || "";
    el.inputBranch.value = config.branch || "main";
  }
  el.settingsModal.hidden = false;
  el.inputOwner.focus();
}

function closeSettingsModal() {
  el.settingsModal.hidden = true;
}

el.settingsBtn.addEventListener("click", openSettingsModal);
el.repoIndicator.addEventListener("click", openSettingsModal);
el.cancelSettingsBtn.addEventListener("click", closeSettingsModal);

el.clearTokenBtn.addEventListener("click", () => {
  clearConfig();
  client = null;
  currentPath = [];
  el.repoLabel.textContent = "未設定";
  setToolbarEnabled(false);
  el.fileTable.hidden = true;
  el.emptyState.hidden = false;
  el.emptyState.textContent = "ストレージが未設定です。右上の ⚙️ から接続先リポジトリを設定してください。";
  closeSettingsModal();
  showToast("保存済み設定を削除しました");
});

el.settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const config = {
    token: el.inputToken.value.trim(),
    owner: el.inputOwner.value.trim(),
    repo: el.inputRepo.value.trim(),
    branch: el.inputBranch.value.trim() || "main",
  };

  const submitBtn = e.submitter;
  submitBtn.disabled = true;
  submitBtn.textContent = "接続確認中...";
  try {
    const testClient = new GitHubClient(config);
    await testClient.verifyRepo();
    saveConfig(config);
    client = testClient;
    currentPath = [];
    el.repoLabel.textContent = `${config.owner}/${config.repo}@${config.branch}`;
    setToolbarEnabled(true);
    closeSettingsModal();
    showToast("接続しました", "success");
    await refresh();
  } catch (err) {
    handleError(err, "リポジトリへの接続に失敗しました");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "接続して保存";
  }
});

// ---------- パンくず ----------

function renderBreadcrumb() {
  el.breadcrumb.innerHTML = "";

  const homeBtn = document.createElement("button");
  homeBtn.textContent = "🏠 ホーム";
  homeBtn.addEventListener("click", () => navigateTo([]));
  el.breadcrumb.appendChild(homeBtn);

  currentPath.forEach((segment, i) => {
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "›";
    el.breadcrumb.appendChild(sep);

    if (i === currentPath.length - 1) {
      const span = document.createElement("span");
      span.className = "current";
      span.textContent = segment;
      el.breadcrumb.appendChild(span);
    } else {
      const btn = document.createElement("button");
      btn.textContent = segment;
      btn.addEventListener("click", () => navigateTo(currentPath.slice(0, i + 1)));
      el.breadcrumb.appendChild(btn);
    }
  });
}

async function navigateTo(segments) {
  currentPath = segments;
  await refresh();
}

// ---------- 一覧表示 ----------

async function refresh() {
  if (!client) return;
  clearSelection();
  renderBreadcrumb();
  try {
    const entries = await client.listContents(pathString(currentPath));
    renderEntries(entries);
  } catch (err) {
    handleError(err, "一覧の取得に失敗しました");
  }
}

function renderEntries(entries) {
  const visible = entries.filter((e) => e.name !== ".gitkeep");

  if (visible.length === 0) {
    currentEntries = [];
    el.fileTable.hidden = true;
    el.emptyState.hidden = false;
    el.emptyState.textContent = "このフォルダは空です。アップロードするか、新しいフォルダを作成してください。";
    return;
  }

  el.emptyState.hidden = true;
  el.fileTable.hidden = false;
  el.fileTableBody.innerHTML = "";

  const dirs = visible.filter((e) => e.type === "dir").sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const files = visible.filter((e) => e.type !== "dir").sort((a, b) => a.name.localeCompare(b.name, "ja"));
  currentEntries = [...dirs, ...files];

  currentEntries.forEach((entry) => {
    el.fileTableBody.appendChild(renderRow(entry));
  });
  syncSelectAllCheckbox();
}

function renderRow(entry) {
  const tr = document.createElement("tr");
  const isDir = entry.type === "dir";

  const selectTd = document.createElement("td");
  selectTd.className = "col-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "entry-checkbox";
  checkbox.checked = selection.has(entry.path);
  checkbox.addEventListener("change", () => toggleSelection(entry, checkbox.checked, tr));
  selectTd.appendChild(checkbox);

  const nameTd = document.createElement("td");
  const nameWrap = document.createElement("div");
  nameWrap.className = `entry-name ${isDir ? "is-folder" : ""}`;
  const icon = document.createElement("span");
  icon.className = "entry-icon";
  icon.textContent = isDir ? "📁" : fileIcon(entry.name);
  const nameText = document.createElement("span");
  nameText.textContent = entry.name;
  nameWrap.appendChild(icon);
  nameWrap.appendChild(nameText);
  if (isDir) {
    nameWrap.addEventListener("click", () => navigateTo([...currentPath, entry.name]));
  }
  nameTd.appendChild(nameWrap);

  const sizeTd = document.createElement("td");
  sizeTd.className = "col-size";
  sizeTd.textContent = isDir ? "" : formatSize(entry.size);

  tr.appendChild(selectTd);
  tr.appendChild(nameTd);
  tr.appendChild(sizeTd);
  return tr;
}

function fileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️",
    pdf: "📕", doc: "📄", docx: "📄", txt: "📄", md: "📄",
    xls: "📊", xlsx: "📊", csv: "📊",
    zip: "🗜️", rar: "🗜️", "7z": "🗜️",
    mp3: "🎵", wav: "🎵",
    mp4: "🎬", mov: "🎬",
    js: "💻", ts: "💻", py: "💻", json: "💻", html: "💻", css: "💻",
  };
  return map[ext] || "📄";
}

// ---------- ダウンロード（選択項目を一括・非圧縮で） ----------

async function downloadSingleFile(entry) {
  const buffer = await client.downloadFile(entry.path);
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = entry.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadSelected() {
  if (selection.size === 0) return;
  const entries = Array.from(selection.values());

  try {
    showProgress("ダウンロード対象を確認中...");
    // フォルダが選択されている場合は中のファイルを再帰的に展開する
    let files = [];
    for (const entry of entries) {
      if (entry.type === "dir") {
        files = files.concat(await client.listFilesRecursive(entry.path));
      } else {
        files.push(entry);
      }
    }
    if (files.length === 0) {
      showToast("ダウンロード対象のファイルがありません", "error");
      return;
    }

    let done = 0;
    for (const file of files) {
      updateProgress(done / files.length, `ダウンロード中... (${done + 1} / ${files.length}) ${file.name}`);
      await downloadSingleFile(file);
      done++;
      // ブラウザの複数ファイル自動ダウンロード制限に配慮して少し間隔を空ける
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    showToast(`${files.length} 件のファイルをダウンロードしました（圧縮なし・個別ファイル）`, "success");
  } catch (err) {
    handleError(err, "ダウンロードに失敗しました");
  } finally {
    hideProgress();
  }
}

// ---------- 削除（選択項目を一括） ----------

async function deleteSelected() {
  if (selection.size === 0) return;
  const entries = Array.from(selection.values());
  const names = entries.map((e) => e.name).join(", ");
  if (!confirm(`選択した ${entries.length} 件（${names}）を削除しますか？この操作は取り消せません。`)) return;

  showProgress(`削除中... (0 / ${entries.length})`);
  let done = 0;
  const failed = [];

  for (const entry of entries) {
    try {
      if (entry.type === "dir") {
        await client.deleteFolder(entry.path);
      } else {
        await client.deleteFile(entry.path, entry.sha);
      }
    } catch (err) {
      failed.push(entry.name);
      console.error(err);
    }
    done++;
    updateProgress(done / entries.length, `削除中... (${done} / ${entries.length})`);
  }

  hideProgress();
  if (failed.length) showToast(`削除に失敗: ${failed.join(", ")}`, "error");
  const succeeded = entries.length - failed.length;
  if (succeeded > 0) showToast(`${succeeded} 件を削除しました`, "success");
  await refresh();
}

el.downloadSelectedBtn.addEventListener("click", downloadSelected);
el.deleteSelectedBtn.addEventListener("click", deleteSelected);

// ---------- 新規フォルダ ----------

el.newFolderBtn.addEventListener("click", () => {
  el.newFolderName.value = "";
  el.newFolderModal.hidden = false;
  el.newFolderName.focus();
});
el.cancelNewFolderBtn.addEventListener("click", () => {
  el.newFolderModal.hidden = true;
});

el.newFolderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el.newFolderName.value.trim();
  if (!name || /[/\\]/.test(name)) {
    showToast("フォルダ名に / や \\ は使用できません", "error");
    return;
  }
  el.newFolderModal.hidden = true;
  try {
    showProgress(`フォルダを作成中: ${name}`);
    await client.createFolder(pathString([...currentPath, name]));
    showToast(`フォルダ「${name}」を作成しました`, "success");
    await refresh();
  } catch (err) {
    handleError(err, "フォルダの作成に失敗しました");
  } finally {
    hideProgress();
  }
});

// ---------- アップロード ----------

el.uploadBtn.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => {
  uploadFiles(Array.from(el.fileInput.files));
  el.fileInput.value = "";
});

el.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (client) el.dropzone.classList.add("drag-over");
});
el.dropzone.addEventListener("dragleave", () => {
  el.dropzone.classList.remove("drag-over");
});
el.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  el.dropzone.classList.remove("drag-over");
  if (!client) return;
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) uploadFiles(files);
});

async function uploadFiles(files) {
  if (!files.length || !client) return;

  const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
  const valid = files.filter((f) => f.size <= MAX_FILE_SIZE);
  if (oversized.length) {
    showToast(
      `${oversized.map((f) => f.name).join(", ")} は ${formatSize(MAX_FILE_SIZE)} を超えるためスキップしました`,
      "error"
    );
  }
  if (!valid.length) return;

  showProgress(`アップロード中... (0 / ${valid.length})`);
  let done = 0;
  const failed = [];

  for (const file of valid) {
    try {
      const buffer = await file.arrayBuffer();
      const targetPath = pathString([...currentPath, file.name]);

      // 既存ファイルの上書きには sha が必要
      let existingSha;
      try {
        const meta = await client.getFileMeta(targetPath);
        if (!Array.isArray(meta)) existingSha = meta.sha;
      } catch {
        // 存在しない場合はそのまま新規作成
      }

      await client.putFile(targetPath, buffer, {
        message: `Upload ${file.name}`,
        sha: existingSha,
      });
    } catch (err) {
      failed.push(file.name);
      console.error(err);
    }
    done++;
    updateProgress(done / valid.length, `アップロード中... (${done} / ${valid.length})`);
  }

  hideProgress();
  if (failed.length) {
    showToast(`失敗: ${failed.join(", ")}`, "error");
  }
  const succeeded = valid.length - failed.length;
  if (succeeded > 0) {
    showToast(`${succeeded} 件のファイルをアップロードしました`, "success");
  }
  await refresh();
}

el.refreshBtn.addEventListener("click", refresh);

// ---------- 初期化 ----------

async function init() {
  const config = loadConfig();
  if (!config) {
    setToolbarEnabled(false);
    return;
  }
  el.repoLabel.textContent = `${config.owner}/${config.repo}@${config.branch}`;
  client = new GitHubClient(config);
  try {
    await client.verifyRepo();
    setToolbarEnabled(true);
    await refresh();
  } catch (err) {
    handleError(err, "保存済み設定での接続に失敗しました。設定を確認してください。");
    setToolbarEnabled(false);
  }
}

ensureUnlocked().then(init);
