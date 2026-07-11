// ==========================================
// 1. 設定とAPIキー・テストモードの定義
// ==========================================
const IS_TEST_MODE = false;

function getGeminiApiKey() {
  const savedKey = localStorage.getItem("user_gemini_api_key");
  if (savedKey && savedKey.trim() !== "") {
    return savedKey.trim();
  }

  if (typeof CONFIG !== "undefined" && CONFIG.GEMINI_API_KEY) {
    const defaultPlaceholder = "AQ.Ab8RN6IEZquveH9t-exeZh9Kxzf58NoS5SCxPdPPBuRss3Uhcg";
    if (CONFIG.GEMINI_API_KEY !== defaultPlaceholder && !CONFIG.GEMINI_API_KEY.startsWith("YOUR_")) {
      return CONFIG.GEMINI_API_KEY;
    }
  }
  return "";
}

let fileInput;
window.currentSSList = [];
let activeBlobUrl = null;

// ==========================================
// 2. 画面の準備ができたら動く処理
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  createApiKeyConfigPanel();

  // 定期的に設定状況とログイン状況をチェックして使用OKバッジを更新する
  setInterval(updateSystemStatusBadge, 1000);

  fileInput = document.getElementById("fileInput");
  if (!fileInput) return;
  fileInput.addEventListener("change", handleFile);

  if (!window.driveFiles || window.driveFiles.length === 0) {
    window.driveFiles = [
      { id: "1", name: "EMo東東京 DDセルフ環七豊玉.pdf", modifiedTime: Date.now() },
      { id: "2", name: "井口鉱油 朝霞本町SS.pdf", modifiedTime: Date.now() },
      { id: "3", name: "EMo西東京 新座.pdf", modifiedTime: Date.now() },
      { id: "4", name: "松勇 EneJet DD高松.pdf", modifiedTime: Date.now() },
      { id: "5", name: "ENEOS 横浜SS.pdf", modifiedTime: Date.now() }
    ];
  }

  if (typeof UI !== "undefined") {
    UI.showImage = (src, mimeType) => {
      if (!UI.previewArea) return;
      const isPdf = (mimeType === "application/pdf") || (src && src.startsWith("data:application/pdf"));
      
      if (isPdf) {
        UI.previewArea.innerHTML = `<embed src="${src}" type="application/pdf" style="width:100%; height:500px; border:1px solid #ccc; border-radius:4px;">`;
      } else {
        UI.previewArea.innerHTML = `<img src="${src}" style="max-width:100%; border-radius:4px;">`;
      }
    };

    UI.showRanking = (files) => {
      const dropdown = document.getElementById("ssDropdown");
      if (dropdown) {
        updateRankingForIndex(parseInt(dropdown.value, 10));
      } else {
        renderSSDropdownAndRanking();
      }
    };

    UI.selectDelivery = async function(fileId, fileName) {
      const dropdown = document.getElementById("ssDropdown");
      const activeIndex = dropdown ? parseInt(dropdown.value, 10) : 0;
      const currentSS = window.currentSSList ? window.currentSSList[activeIndex] : null;

      if (!currentSS) {
        alert("照合対象の配送先が選択されていません。");
        return;
      }

      const targetFile = (window.driveFiles || []).find(f => f.id === fileId);
      const targetUrl = (targetFile && targetFile.webViewLink) 
        ? targetFile.webViewLink 
        : `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;

      // ★対策3：ダブルチェックスイッチがOFFの場合はAIを通さずに即ファイルを開く
      const doubleCheckSwitch = document.getElementById("aiDoubleCheckSwitch");
      if (!doubleCheckSwitch || !doubleCheckSwitch.checked) {
        window.open(targetUrl, "_blank");
        return;
      }

      const loadingDiv = document.createElement("div");
      loadingDiv.id = "verifyLoading";
      loadingDiv.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); color:white; z-index:10000; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;";
      loadingDiv.innerHTML = `
        <div style="font-size:24px; margin-bottom:15px; font-weight:bold; color:#f39c12;">🔍 AIによる最終ダブルチェック中...</div>
        <div style="font-size:15px; margin-bottom:10px; color:#fff;">Googleドライブから「${escapeHtml(fileName)}」をロードしています。</div>
        <div style="font-size:12px; color:#aaa;">指示書のお届け先・住所と一致しているか、中身を確認しています（約2〜3秒）</div>
      `;
      document.body.appendChild(loadingDiv);

      try {
        const fileBlob = await downloadDriveFile(fileId);
        
        let mimeType = targetFile ? targetFile.mimeType : "application/pdf";
        if (fileName.toLowerCase().endsWith(".pdf")) {
          mimeType = "application/pdf";
        }

        const checkResult = await verifyFileContentWithGemini(fileBlob, mimeType, currentSS);
        loadingDiv.remove();

        if (checkResult.verified) {
          alert(`✅ 【一致確認OK！】\nAIがファイル内を確認し、住所・お届け先の一致を確信しました。\n\n【AIからの発見レポート】:\n${checkResult.reason}\n\nプレビューファイルを起動します。`);
          window.open(targetUrl, "_blank");
        } else {
          const warnMsg = `⚠️ 【警告：住所が不一致の可能性があります】\n\nAIが選択されたファイルを確認したところ、指示書の住所と一致しない、または不審な点が見つかりました：\n\n「${checkResult.reason}」\n\n本当にこのファイル（${fileName}）を開いてもよろしいですか？\n誤配防止のため、今一度ご確認いただくことを強く推奨します。`;
          if (confirm(warnMsg)) {
            window.open(targetUrl, "_blank");
          }
        }

      } catch (err) {
        loadingDiv.remove();
        console.error("ダブルチェックエラー:", err);
        const errMsg = `⚠️ 【ダブルチェックが完了できませんでした】\n\n${err.message}\n\nこのままファイル（${fileName}）を開きますか？`;
        if (confirm(errMsg)) {
          window.open(targetUrl, "_blank");
        }
      }
    };
  }
});

// ==========================================
// 2-2. 使用OK判定・ステータス更新処理
// ==========================================
function updateSystemStatusBadge() {
  const apiKey = getGeminiApiKey();
  const hasApiKey = apiKey && apiKey.length > 5;

  // 1) APIキー状態の表示を更新
  const apiKeyStatusSpan = document.getElementById("apiKeyStatus");
  if (apiKeyStatusSpan) {
    if (hasApiKey) {
      apiKeyStatusSpan.textContent = "設定済み (OK)";
      apiKeyStatusSpan.style.color = "#27ae60";
    } else {
      apiKeyStatusSpan.textContent = "未設定";
      apiKeyStatusSpan.style.color = "#e74c3c";
    }
  }

  // 2) Googleログイン状態の確認
  const driveUserDiv = document.getElementById("driveUser");
  const isGoogleLoggedIn = driveUserDiv && driveUserDiv.textContent.trim() !== "未ログイン";

  // 3) 総合バッジの更新
  const statusBadge = document.getElementById("systemStatusBadge");
  if (statusBadge) {
    if (hasApiKey && isGoogleLoggedIn) {
      statusBadge.textContent = "🟢 システム使用OK";
      statusBadge.style.backgroundColor = "#e8f5e9";
      statusBadge.style.color = "#2e7d32";
      statusBadge.style.borderColor = "#a5d6a7";
    } else {
      const missing = [];
      if (!hasApiKey) missing.push("APIキー");
      if (!isGoogleLoggedIn) missing.push("ログイン");
      statusBadge.textContent = `❌ ${missing.join(" & ")}が未完了`;
      statusBadge.style.backgroundColor = "#ffebee";
      statusBadge.style.color = "#c62828";
      statusBadge.style.borderColor = "#ef9a9a";
    }
  }
}

// ==========================================
// 3. APIキーを設定・保存する画面バー
// ==========================================
function createApiKeyConfigPanel() {
  const existingPanel = document.getElementById("apiKeyConfigPanel");
  if (existingPanel) existingPanel.remove();

  const panel = document.createElement("div");
  panel.id = "apiKeyConfigPanel";
  panel.style = "background: #fff3cd; padding: 10px 15px; border-bottom: 2px solid #ffeeba; display: flex; justify-content: space-between; align-items: center; font-family: sans-serif; font-size: 13px; color: #856404; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";
  
  const currentKey = localStorage.getItem("user_gemini_api_key") || "";

  panel.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>🔑 <b>Gemini APIキー設定:</b></span>
      <input type="password" id="userApiKeyInput" value="${escapeHtml(currentKey)}" placeholder="AIzaSy... から始まるご自身のAPIキーを入力" style="padding: 6px; width: 280px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
      <button id="saveKeyBtn" style="padding: 6px 12px; background: #ffc107; color: #333; border: 1px solid #e0a800; cursor: pointer; border-radius: 4px; font-weight: bold; font-size: 12px; transition: 0.2s;">保存する</button>
      <button id="clearKeyBtn" style="padding: 6px 12px; background: #e74c3c; color: white; border: none; cursor: pointer; border-radius: 4px; font-size: 12px;">消去</button>
    </div>
    <div style="font-size: 11px; color: #666; text-align: right;">
      ${IS_TEST_MODE ? '<span style="color: #27ae60; font-weight: bold;">🛠 現在【テスト（デモ）モード】がオンです。</span>' : '<span style="color: #1e50a2; font-weight: bold;">⚡ 現在【本番AI通信モード】がオンです！</span>'}
      <br>キーが1日20制限に達した場合は、<b>Google AI Studio (aistudio.google.com)</b> から新しい無料キーを作成して登録してください。
    </div>
  `;

  document.body.insertBefore(panel, document.body.firstChild);

  document.getElementById("saveKeyBtn").addEventListener("click", () => {
    const inputVal = document.getElementById("userApiKeyInput").value.trim();
    if (inputVal === "") {
      alert("キーが入力されていません。");
      return;
    }
    localStorage.setItem("user_gemini_api_key", inputVal);
    alert("APIキーをブラウザに安全に保存しました！次回から入力を省略できます。");
    window.location.reload();
  });

  document.getElementById("clearKeyBtn").addEventListener("click", () => {
    if (confirm("ブラウザに保存されているAPIキーを削除しますか？")) {
      localStorage.removeItem("user_gemini_api_key");
      document.getElementById("userApiKeyInput").value = "";
      alert("削除しました。");
      window.location.reload();
    }
  });
}

// ==========================================
// 4. 送信前に、自動で画像をリサイズして軽量化する関数
// ==========================================
async function resizeAndCompressImage(base64DataUrl, maxWidth = 1024, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64DataUrl;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(compressedDataUrl);
    };
    img.onerror = () => {
      resolve(base64DataUrl);
    };
  });
}

// ==========================================
// 5. 自動的に少し待ってリトライする通信用の便利ツール
// ==========================================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, maxRetries = 3) {
  let delay = 1500;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429 && i < maxRetries - 1) {
        console.warn(`一時的に混雑、または利用制限(429)に達しました。${delay / 1000}秒後に自動でリトライします... (試行 ${i + 1}/${maxRetries})`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      
      return response;
    } catch (err) {
      if (i < maxRetries - 1) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

// ==========================================
// 6. Googleドライブからファイルダウンロード
// ==========================================
async function downloadDriveFile(fileId) {
  let token = null;

  const cachedToken = localStorage.getItem("gdrive_access_token");
  if (cachedToken && cachedToken.length > 20) {
    token = cachedToken;
  }

  if (!token) {
    if (typeof gapi !== "undefined" && gapi.client && gapi.client.getToken()) {
      token = gapi.client.getToken().access_token;
    }
  }

  if (!token) {
    const globalVars = ["accessToken", "access_token", "googleToken", "driveToken", "token"];
    for (const v of globalVars) {
      if (typeof window[v] !== "undefined" && window[v]) {
        token = window[v];
        break;
      }
    }
  }

  if (!token) {
    throw new Error("Google Driveへのアクセス権限（認証鍵）がアプリ内で見つかりませんでした。ログイン状態をお確かめください。");
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error("Google Driveからのダウンロードに失敗しました。");
  }

  return await response.blob();
}

// ==========================================
// 7. Gemini住所ダブルチェック検証
// ==========================================
async function verifyFileContentWithGemini(blob, mimeType, targetSS) {
  if (IS_TEST_MODE) {
    await sleep(1000);
    return {
      verified: true,
      reason: `【テストモード動作】ファイル「${targetSS.fullName}」の1枚目の上部に、住所「${targetSS.address || "住所"}」が合致する記載を確認しました。`
    };
  }

  const activeKey = getGeminiApiKey();
  if (!activeKey) {
    throw new Error("GeminiのAPIキーが設定されていません。");
  }

  let base64Data = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });

  if (mimeType.startsWith("image/")) {
    const rawDataUrl = `data:${mimeType};base64,${base64Data}`;
    const compressedUrl = await resizeAndCompressImage(rawDataUrl, 1024, 0.6);
    base64Data = compressedUrl.split(',')[1];
  }

  let safeMimeType = mimeType;
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(safeMimeType)) {
    safeMimeType = "application/pdf";
  }

  const prompt = `
    配送指示書のお届け先情報を照合してください。
    届先名称: ${targetSS.fullName}
    配送先住所: ${targetSS.address || "住所情報なし"}
  `;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      verified: { type: "BOOLEAN" },
      reason: { type: "STRING" }
    },
    required: ["verified", "reason"]
  };

  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: safeMimeType, data: base64Data } }] }],
        generationConfig: { 
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`AIへのアクセスに失敗しました (ステータス: ${response.status})`);
  }

  const resultData = await response.json();
  try {
    const text = resultData?.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleanJsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(cleanJsonText);
  } catch (e) {
    throw new Error("ダブルチェックの解析データの処理に失敗しました。");
  }
}

// ==========================================
// 8. ファイルアップロード選択時のOCR処理
// ==========================================
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
  }

  activeBlobUrl = URL.createObjectURL(file);
  if (typeof UI !== "undefined" && typeof UI.showImage === "function") {
    UI.showImage(activeBlobUrl, file.type);
  }

  // ★対策4：AI配送先抽出スイッチがOFFの場合は、OCRを行わずにスキップする
  const ocrSwitch = document.getElementById("aiOcrSwitch");
  if (ocrSwitch && !ocrSwitch.checked) {
    if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
      UI.setOCR("【AI配送先抽出オフ】\n自動解析をスキップしました。\n「001_台帳」フォルダから手動でお調べください。");
    }
    if (UI && UI.driveList) {
      UI.driveList.innerHTML = "AIによる自動照合がオフに設定されています。";
    }
    return;
  }

  if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
    UI.setOCR("指示書解析中... (数秒かかります)");
  }
  if (UI && UI.driveList) {
    UI.driveList.innerHTML = "解析完了後に自動照合を開始します...";
  }

  const reader = new FileReader();
  reader.onload = async (ev) => {
    let imgDataUrl = ev.target.result;

    try {
      if (IS_TEST_MODE) {
        await sleep(1000);
        const demoResult = {
          destinations: [
            { fullName: "EMo東東京 DDセルフ環七豊玉", coreKeyword: "豊玉", address: "東京都練馬区豊玉北3丁目24-15" },
            { fullName: "井口鉱油 朝霞本町SS", coreKeyword: "朝霞本町", address: "埼玉県朝霞市本町1丁目1-1" }
          ],
          vehicleNumber: "足立100あ9999"
        };
        
        window.currentSSList = demoResult.destinations;
        window.currentVehicleNumber = demoResult.vehicleNumber;

        const displayLines = [`【車両ナンバー】: ${window.currentVehicleNumber}`, `----------------------------------`];
        demoResult.destinations.forEach(item => {
          displayLines.push(`${item.fullName} (${item.address})`);
        });

        if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
          UI.setOCR(displayLines.join("\n"));
        }
        renderSSDropdownAndRanking();
        return;
      }

      if (file.type.startsWith("image/")) {
        imgDataUrl = await resizeAndCompressImage(imgDataUrl, 1024, 0.6);
      }

      const activeKey = getGeminiApiKey();
      if (!activeKey) {
        throw new Error("GeminiのAPIキーが設定されていません。");
      }

      const ocrResult = await runGeminiOCR(imgDataUrl);
      if (!ocrResult || !Array.isArray(ocrResult.destinations)) {
        throw new Error("AIからのレスポンス形式が不正です。");
      }
      
      const ssList = ocrResult.destinations;
      window.currentSSList = ssList;
      window.currentVehicleNumber = ocrResult.vehicleNumber || "";

      const displayLines = [];
      if (window.currentVehicleNumber) {
        displayLines.push(`【車両ナンバー】: ${window.currentVehicleNumber}`);
        displayLines.push(`----------------------------------`);
      } else {
        displayLines.push(`【車両ナンバー】: (抽出できませんでした)`);
        displayLines.push(`----------------------------------`);
      }

      ssList.forEach(item => {
        const name = item.fullName || "名称不明";
        const addr = item.address ? ` (${item.address})` : "";
        displayLines.push(`${name}${addr}`);
      });
      
      if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
        UI.setOCR(displayLines.join("\n"));
      }

      renderSSDropdownAndRanking();

    } catch (error) {
      console.error("処理エラー:", error);
      if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
        UI.setOCR(`エラーが発生しました:\n${error.message}`);
      }
    }
  };
  reader.readAsDataURL(file);
}

// ==========================================
// 9. ドロップダウン表示・ランキング・地図関連
// ==========================================
function renderSSDropdownAndRanking() {
  if (!UI || !UI.driveList) return;
  if (!window.currentSSList || window.currentSSList.length === 0) {
    UI.driveList.innerHTML = "配送先が検出されませんでした。";
    return;
  }

  let html = `
    <div style="margin-bottom: 15px; padding: 10px; background: #f0f7ff; border: 1px solid #cce3ff; border-radius: 5px;">
      <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #1e50a2;">
        🔍 照合する配送先を選択してください:
      </label>
      <select id="ssDropdown" style="width: 100%; padding: 10px; font-size: 15px; border: 1px solid #aaa; background: #fff;">
  `;
  
  window.currentSSList.forEach((item, index) => {
    const addressSuffix = item.address ? ` (${item.address})` : "";
    html += `<option value="${index}">${escapeHtml(item.fullName)}${escapeHtml(addressSuffix)}</option>`;
  });
  
  html += `</select></div><div id="rankingContainer"></div>`;
  UI.driveList.innerHTML = html;

  const dropdown = document.getElementById("ssDropdown");
  if (dropdown) {
    dropdown.addEventListener("change", (e) => {
      updateRankingForIndex(parseInt(e.target.value, 10));
    });
  }
  updateRankingForIndex(0);
}

function updateRankingForIndex(index) {
  const container = document.getElementById("rankingContainer");
  if (!container) return;
  const item = window.currentSSList[index];
  if (!item) return;

  const filesToRank = window.driveFiles || [];
  
  let ranked = filesToRank.map(f => {
    const score = calculateFuzzyScore(item, f.name);
    return { ...f, score };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeA = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
    const timeB = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    return timeB - timeA;
  });

  const top3 = ranked.slice(0, 3);
  renderRankingInContainer(container, top3);
}

function renderRankingInContainer(container, files) {
  if (!files || files.length === 0) {
    container.innerHTML = "<div>照合候補なし</div>";
    return;
  }

  const dropdown = document.getElementById("ssDropdown");
  const activeIndex = dropdown ? parseInt(dropdown.value, 10) : 0;
  const currentSS = window.currentSSList ? window.currentSSList[activeIndex] : null;

  let mapQuery = "";
  if (currentSS) {
    mapQuery = (currentSS.address && currentSS.address.trim() !== "") ? currentSS.address : currentSS.fullName;
  }

  const html = files.map((f) => {
    const percent = f.score || 0;
    const isAuto = percent >= 80;
    const color = isAuto ? "🟢" : "🟡";
    
    const dateObj = f.modifiedTime ? new Date(f.modifiedTime) : null;
    const formattedDate = (dateObj && !isNaN(dateObj)) ? dateObj.toLocaleString() : "日付不明";

    const mapButtonHtml = mapQuery 
      ? `<button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}', '_blank')" style="margin-top: 5px; margin-left: 8px; background-color: #34a853; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">🗺 Googleマップ</button>`
      : "";

    const miniMapButtonHtml = `
      <button onclick="openMiniMap('${escapeJSString(f.name)}')" style="margin-top: 5px; margin-left: 8px; background-color: #f39c12; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">📁 簡易地図を作成</button>
    `;

    return `
      <div style="padding: 10px 0;">
        <span>${color} <b>${isAuto ? "自動確定候補" : "候補"}</b> ${escapeHtml(f.name)}</span><br>
        一致率：<b>${percent}%</b><br>
        <small style="color: #666;">更新日時：${formattedDate}</small><br>
        <button onclick="if(UI && typeof UI.selectDelivery === 'function'){UI.selectDelivery('${escapeJSString(f.id)}', '${escapeJSString(f.name)}')}else{alert('配送先を選択しました: ${escapeJSString(f.name)}');}" style="margin-top: 5px;">この配送先でOK (PDF)</button>
        ${mapButtonHtml}
        ${miniMapButtonHtml}
      </div><hr style="border: none; border-top: 1px solid #eee; margin: 8px 0;">`;
  }).join("");
  container.innerHTML = html;
}

function openMiniMap(fileName) {
  showOnScreenMiniMap(fileName);
}

function showOnScreenMiniMap(fileName) {
  const storeName = fileName.replace(/\.(pdf|xlsx|xls)$/i, "");
  const dropdown = document.getElementById("ssDropdown");
  const activeIndex = dropdown ? parseInt(dropdown.value, 10) : 0;
  const currentSS = window.currentSSList ? window.currentSSList[activeIndex] : null;
  
  const mapQuery = (currentSS && currentSS.address && currentSS.address.trim() !== "") 
    ? currentSS.address 
    : storeName;

  const existingModal = document.getElementById("miniMapModal");
  if (existingModal) existingModal.remove();

  const modal = document.createElement("div");
  modal.id = "miniMapModal";
  modal.style.position = "fixed";
  modal.style.top = "0";
  modal.style.left = "0";
  modal.style.width = "100%";
  modal.style.height = "100%";
  modal.style.backgroundColor = "rgba(0,0,0,0.6)";
  modal.style.zIndex = "9999";
  modal.style.display = "flex";
  modal.style.justifyContent = "center";
  modal.style.alignItems = "center";

  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=13&output=embed&iwloc=near`;

  modal.innerHTML = `
    <div style="background: white; width: 90%; max-width: 750px; padding: 20px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); position: relative; font-family: sans-serif;">
      <h3 style="margin-top: 0; color: #1e50a2; font-size: 18px; border-bottom: 2px solid #1e50a2; padding-bottom: 8px;">🗺 周辺簡易道路地図: ${escapeHtml(storeName)}</h3>
      <p style="font-size: 12px; color: #666; margin-bottom: 15px;">
        ※周辺の主要幹線道路と目的地の位置関係が分かりやすいスケールで表示しています。
      </p>
      <div id="miniMapContainer" style="width: 100%; height: 420px; background: #fcfcfc; border-radius: 4px; overflow: hidden; border: 1px solid #ccc;">
        <iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" style="border:0;" allowfullscreen="" loading="lazy"></iframe>
      </div>
      <button onclick="document.getElementById('miniMapModal').remove()" style="position: absolute; top: 15px; right: 20px; background: none; border: none; font-size: 20px; cursor: pointer; color: #999;">✕</button>
      <div style="margin-top: 15px; text-align: right; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: #888;">ドラッグで地図の移動、ホイール操作でズーム率の調整が可能です。</span>
        <div>
          <button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}', '_blank')" style="background-color: #34a853; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">Googleマップで開く</button>
          <button onclick="document.getElementById('miniMapModal').remove()" style="margin-left: 8px; background-color: #7f8c8d; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px;">閉じる</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function escapeJSString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function cleanNameForMatching(str) {
  if (typeof str !== 'string') return "";
  let s = str.normalize("NFKC")
             .replace(/\.(pdf|xlsx|xls)$/i, "")
             .replace(/[\s　・._\-()（）[\]「」+]/g, "")
             .toLowerCase();
             
  const ignoreWords = [
    "eneos", "enejet", "dd", "セルフ", "ss", "店", "石油", 
    "鉱油", "商事", "配送", "指示", "指示書", "更新", "16kl"
  ];
  ignoreWords.forEach(word => {
    s = s.replaceAll(word, "");
  });
  return s;
}

const BROAD_KEYWORDS = [
  "東京", "神奈川", "千葉", "埼玉", "環七", "環八", "国道", 
  "街道", "16号", "246", "バイパス", "インター", "東日本", "西日本"
];

function calculateFuzzyScore(item, filename) {
  if (!item || !item.fullName || !filename) return 0;

  const qClean = cleanNameForMatching(item.fullName);
  const fClean = cleanNameForMatching(filename);

  if (!qClean || !fClean) return 0;

  if (qClean === fClean) return 100;
  if (qClean.includes(fClean) || fClean.includes(qClean)) return 95;

  const qJP = qClean.replace(/[a-z0-9]/g, "");
  const fJP = fClean.replace(/[a-z0-9]/g, "");
  if (qJP.length >= 2 && fJP.length >= 2) {
    if (qJP.includes(fJP) || fJP.includes(qJP)) {
      return 92;
    }
  }

  if (item.coreKeyword && item.coreKeyword.length >= 2) {
    const coreClean = cleanNameForMatching(item.coreKeyword);
    const isBroad = BROAD_KEYWORDS.some(broad => coreClean === broad);

    if (coreClean && coreClean.length >= 2 && !isBroad) {
      if (fClean.includes(coreClean)) {
        return 85; 
      }
    }
  }

  let addressScore = 0;
  if (item.address && item.address.trim() !== "") {
    const addrClean = item.address.normalize("NFKC").replace(/[0-9\-ー 　[\]()（）]/g, "");
    const kanjiLocalities = addrClean.match(/[\u4e00-\u9faf]{2,}/g) || [];
    
    for (const locality of kanjiLocalities) {
      if (["東京都", "神奈川県", "埼玉県", "千葉県", "都内", "県内"].includes(locality)) continue;
      
      const cleanLocality = cleanNameForMatching(locality.replace(/[市区町村]/g, ""));
      if (cleanLocality && cleanLocality.length >= 2) {
        if (fClean.includes(cleanLocality)) {
          const isDistrict = locality.endsWith("区") || locality.endsWith("市") || locality.endsWith("町") || locality.endsWith("村");
          const score = isDistrict ? 82 : 90;
          addressScore = Math.max(addressScore, score);
        }
      }
    }
  }
  if (addressScore > 0) return addressScore;

  const getBigrams = (str) => {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };

  const b1 = getBigrams(qClean);
  const b2 = getBigrams(fClean);
  if (b1.size === 0 || b2.size === 0) return 0;

  let intersection = 0;
  for (const val of b1) {
    if (b2.has(val)) intersection++;
  }

  const matchRatio = Math.round((2 * intersection / (b1.size + b2.size)) * 100);
  return matchRatio;
}

// ==========================================
// 10. 指示書OCR読込（★対策1：プロンプトの調整）
// ==========================================
async function runGeminiOCR(base64DataUrl) {
  const activeKey = getGeminiApiKey();
  if (!activeKey) {
    throw new Error("GeminiのAPIキーが設定されていません。");
  }

  const matches = base64DataUrl.match(/^data:(image\/.+|application\/pdf);base64,(.*)$/);
  if (!matches) throw new Error("Base64変換に失敗しました。");
  const mimeType = matches[1];
  const base64Data = matches[2];

  // カッコで囲まれた情報をより見落とさずに精度よく捉えるように指定を再定義
  const prompt = `
    配送指示書の画像またはPDFから、以下の情報を正確に読み取って指定のJSONフォーマットで出力してください。

    1. 配送先情報 (destinations):
       - 届先名称 (fullName): SS名や店舗名、企業名を正確に抽出してください。
       - coreKeyword: それぞれの名称からブランド名（"ENEOS", "EneJet", "DD", "セルフ", "SS", "店"等）および道路名・路線名単体を除外した、店舗を個別に特定できる固有名称（例:「豊玉」など）を抽出してください。
       - 住所 (address): 各届先名称に対応する「配送先住所」を正確に抽出してください。必ず届先名称と対応する正しい住所を1対1でペアにしてください。

    2. 車両ナンバー (vehicleNumber):
       - 指示書の紙面上に、半角カッコ「[ ]」または全角カッコ「［ ］」に囲まれた状態で「足立100あ9999」や「練馬300わ1234」などの地名から始まる自動車登録番号（ナンバープレートの情報）が記載されています。
       - このカッコ［ ］、[ ] に囲まれている車両ナンバー情報を正確に見つけ出して抽出してください。
       - 抽出する際は、カッコ自体は含めずにカッコの中身のみ（例: "足立100あ9999"）にしてください。
       - 該当する情報が見当たらない場合は、空文字 "" としてください。
  `;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      destinations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            fullName: { type: "STRING" },
            coreKeyword: { type: "STRING" },
            address: { type: "STRING" }
          },
          required: ["fullName", "coreKeyword", "address"]
        }
      },
      vehicleNumber: { type: "STRING" }
    },
    required: ["destinations", "vehicleNumber"]
  };

  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
        generationConfig: { 
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      })
    }
  );
  
  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`APIエラー: ${response.status} - ${errorDetails}`);
  }
  
  const resultData = await response.json();
  try {
    const text = resultData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("AIからデータが返ってきませんでした。");
    }
    const cleanJsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(cleanJsonText);
  } catch (e) {
    throw new Error(`JSONパース失敗: ${e.message}`);
  }
}