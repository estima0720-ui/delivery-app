let tokenClient;
let accessToken = null;

// =========================================================================
// 【高速化設定】全件同期（0）にしつつ、最新順に取得して即画面に反映させます。
// =========================================================================
const DRIVE_LOAD_PERIOD_MONTHS = 0; 

window.addEventListener("DOMContentLoaded", () => {
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) {
    loginBtn.onclick = () => {
      login();
    };
  }

  // 1. ページ読み込み時にローカルキャッシュからファイル一覧を即時復元（体感待ち時間をなくす）
  restoreFilesFromCache();

  // 2. 自動ログイン（およびバックグラウンド裏同期）を試行
  tryAutoLogin();
});

function login() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: "315078508163-ueu6f39u1fs2hfcr42bg2hb1qrjo4qq0.apps.googleusercontent.com",
    scope: "https://www.googleapis.com/auth/drive.readonly",
    callback: async (res) => {
      accessToken = res.access_token;

      const expiresIn = res.expires_in ? parseInt(res.expires_in, 10) : 3600;
      const expiresAt = Date.now() + (expiresIn * 1000);

      localStorage.setItem("gdrive_access_token", accessToken);
      localStorage.setItem("gdrive_expires_at", expiresAt.toString());

      const userEl = document.getElementById("driveUser");
      if (userEl) userEl.textContent = "ログイン済み";
      
      // 手動ログイン時も段階的にロードを開始
      await loadDriveFiles();
    }
  });
  tokenClient.requestAccessToken();
}

// キャッシュからのファイル即時復元処理
function restoreFilesFromCache() {
  const cachedFiles = localStorage.getItem("gdrive_files_cache");
  const userEl = document.getElementById("driveUser");
  
  if (cachedFiles) {
    try {
      window.driveFiles = JSON.parse(cachedFiles);
      console.log(`【Google Drive】キャッシュから ${window.driveFiles.length} 件のファイルを即時展開しました。`);
      if (userEl) {
        userEl.textContent = `未ログイン (キャッシュ ${window.driveFiles.length} 件を表示中)`;
      }
    } catch (e) {
      console.error("キャッシュ復元エラー:", e);
    }
  }
}

// 自動ログインの試行
async function tryAutoLogin() {
  const cachedToken = localStorage.getItem("gdrive_access_token");
  const expiresAtStr = localStorage.getItem("gdrive_expires_at");
  const userEl = document.getElementById("driveUser");

  if (cachedToken && expiresAtStr) {
    const expiresAt = parseInt(expiresAtStr, 10);
    
    if (Date.now() < (expiresAt - 5 * 60 * 1000)) {
      accessToken = cachedToken;
      console.log("【Google Drive】有効なトークンを検出。最新データから段階的にバックグラウンド同期します。");
      
      if (userEl) {
        const currentCount = window.driveFiles ? window.driveFiles.length : 0;
        userEl.textContent = `自動ログイン済み (最新ファイルを裏で同期中... / 現在 ${currentCount} 件を表示中)`;
      }

      // 非同期（裏側）で最新ファイルの段階的ロードを実行
      loadDriveFiles();
      return;
    }
  }

  localStorage.removeItem("gdrive_access_token");
  localStorage.removeItem("gdrive_expires_at");
}

// 段階的（プログレッシブ）に取得データをUIおよびグローバル変数へ反映するヘルパー
function applyDriveFilesToUI(files, isFinal = false) {
  // 同名ファイルは「更新日時が最も新しいもの」を残す重複排除
  const uniqueFilesMap = new Map();
  files.forEach(file => {
    const existing = uniqueFilesMap.get(file.name);
    if (!existing || new Date(file.modifiedTime) > new Date(existing.modifiedTime)) {
      uniqueFilesMap.set(file.name, file);
    }
  });

  window.driveFiles = Array.from(uniqueFilesMap.values());

  // 最終ロード完了時のみローカルキャッシュに丸ごと書き込み
  if (isFinal) {
    try {
      localStorage.setItem("gdrive_files_cache", JSON.stringify(window.driveFiles));
    } catch (e) {
      console.warn("ローカルキャッシュへの書き込みに失敗しました:", e);
    }
  }

  // ステータス表示の更新
  const userEl = document.getElementById("driveUser");
  if (userEl) {
    if (isFinal) {
      userEl.textContent = `ログイン済み (同期完了: 全${window.driveFiles.length}件)`;
    } else {
      userEl.textContent = `ログイン済み (自動同期中... / 現在 ${window.driveFiles.length} 件を表示中)`;
    }
  }

  // 現在選択中の店舗があればランキングを即座に再計算・再描画
  const dropdown = document.getElementById("ssDropdown");
  if (dropdown) {
    updateRankingForIndex(parseInt(dropdown.value, 10));
  } else if (window.currentSSList && window.currentSSList.length > 0) {
    updateRankingForIndex(0);
  }
}

async function loadDriveFiles() {
  const userEl = document.getElementById("driveUser");

  let allFiles = [];
  let nextPageToken = null;
  
  // 基本クエリ（ゴミ箱除外、フォルダ除外）
  let queryParts = [
    "trashed=false",
    "mimeType!='application/vnd.google-apps.folder'"
  ];

  if (DRIVE_LOAD_PERIOD_MONTHS > 0) {
    const limitDate = new Date();
    limitDate.setMonth(limitDate.getMonth() - DRIVE_LOAD_PERIOD_MONTHS);
    queryParts.push(`modifiedTime > '${limitDate.toISOString()}'`);
  }

  const query = encodeURIComponent(queryParts.join(" and "));

  try {
    do {
      // 【最新優先ロード】orderBy=modifiedTime desc を付与して「最新順」にAPIから取得します
      let url = `https://www.googleapis.com/drive/v3/files?fields=nextPageToken,files(id,name,modifiedTime,webViewLink)&q=${query}&pageSize=1000&orderBy=modifiedTime desc`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("gdrive_access_token");
          localStorage.removeItem("gdrive_expires_at");
          accessToken = null;
          if (userEl) userEl.textContent = "ログイン期限切れ。再ログインしてください。";
          return;
        }
        throw new Error(`Google Drive APIエラー: ${res.status}`);
      }

      const data = await res.json();
      if (data.files) {
        allFiles = allFiles.concat(data.files);
      }
      
      // 【段階的反映】1ページ（1000件）取得するたびに、画面とデータを即時更新（裏同期中も操作可能にします）
      applyDriveFilesToUI(allFiles, false);

      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    // 全ページの読み込みが終わったら、最終保存と完了ステータス更新を行います
    applyDriveFilesToUI(allFiles, true);
    
  } catch (error) {
    console.error("ファイルロード中にエラーが発生しました:", error);
    if (userEl) {
      if (window.driveFiles && window.driveFiles.length > 0) {
        userEl.textContent = `同期エラー（キャッシュデータ ${window.driveFiles.length}件を表示中）`;
      } else {
        userEl.textContent = "同期エラーが発生しました";
      }
    }
  }
}