const GEMINI_API_KEY = (typeof CONFIG !== "undefined" && CONFIG.GEMINI_API_KEY) 
  ? CONFIG.GEMINI_API_KEY 
  : "AQ.Ab8RN6IEZquveH9t-exeZh9Kxzf58NoS5SCxPdPPBuRss3Uhcg"; 

let fileInput;
window.currentSSList = [];
let activeBlobUrl = null;

window.addEventListener("DOMContentLoaded", () => {
  fileInput = document.getElementById("fileInput");
  if (!fileInput) return;
  fileInput.addEventListener("change", handleFile);

  // 実際のGoogle Driveのファイル（1.1万件）が読み込まれている場合は、絶対にダミーデータで上書きしないようにガードします
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

    // ==========================================================
    // 確定処理：選択した1件のファイルを裏でダウンロードして最終ダブルチェック！
    // ==========================================================
    UI.selectDelivery = async function(fileId, fileName) {
      const dropdown = document.getElementById("ssDropdown");
      const activeIndex = dropdown ? parseInt(dropdown.value, 10) : 0;
      const currentSS = window.currentSSList ? window.currentSSList[activeIndex] : null;

      if (!currentSS) {
        alert("照合対象の配送先が選択されていません。");
        return;
      }

      // 最終的に起動するGoogle Driveプレビュー用URL
      const targetFile = (window.driveFiles || []).find(f => f.id === fileId);
      const targetUrl = (targetFile && targetFile.webViewLink) 
        ? targetFile.webViewLink 
        : `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;

      // 画面に検証中のローディング画面を表示します
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
        // 1. Google Driveから、この1件のファイルをバイナリ（Blob）として取得します
        const fileBlob = await downloadDriveFile(fileId);
        
        // ファイルのMIMEタイプを安全に自動判別します
        let mimeType = targetFile ? targetFile.mimeType : "application/pdf";
        if (fileName.toLowerCase().endsWith(".pdf")) {
          mimeType = "application/pdf";
        }

        // 2. Gemini APIを使って、ファイルの中身と指示書の住所情報が一致しているかを裏で判定します
        const checkResult = await verifyFileContentWithGemini(fileBlob, mimeType, currentSS);

        // 検証が終わったのでローディング画面を消します
        loadingDiv.remove();

        if (checkResult.verified) {
          // ✅ 検証一致（安全！）
          // 【新機能】AIから送られてきた「住所が見つかった具体的な場所（reason）」をユーザーに表示します
          alert(`✅ 【一致確認OK！】\nAIがファイル内を確認し、住所・お届け先の一致を確信しました。\n\n【AIからの発見レポート】:\n${checkResult.reason}\n\nプレビューファイルを起動します。`);
          window.open(targetUrl, "_blank");
        } else {
          // ⚠️ 検証不一致（誤配送の警告！）
          const warnMsg = `⚠️ 【警告：住所が不一致の可能性があります】\n\nAIが選択されたファイルを確認したところ、指示書の住所と一致しない、または不審な点が見つかりました：\n\n「${checkResult.reason}」\n\n本当にこのファイル（${fileName}）を開いてもよろしいですか？\n誤配防止のため、今一度ご確認いただくことを強く推奨します。`;
          if (confirm(warnMsg)) {
            window.open(targetUrl, "_blank");
          }
        }

      } catch (err) {
        // エラーが起きた場合はローディングを消し、安全のためユーザーの判断でファイルを開けるようにします
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
// 改良：js/drive.jsで保存された gdrive_access_token を最優先で読み出す
// ==========================================
async function downloadDriveFile(fileId) {
  let token = null;

  // 1. 【最優先】js/drive.jsがLocalStorageに保存した「gdrive_access_token」を直接取り出します
  const cachedToken = localStorage.getItem("gdrive_access_token");
  if (cachedToken && cachedToken.length > 20) {
    token = cachedToken;
  }

  // 2. （予備）もし無ければ標準的なgapiクライアントから取得を試みる
  if (!token) {
    if (typeof gapi !== "undefined" && gapi.client && gapi.client.getToken()) {
      token = gapi.client.getToken().access_token;
    }
  }

  // 3. （予備）その他の一般的な保管場所を捜捜索
  if (!token) {
    const globalVars = ["accessToken", "access_token", "googleToken", "driveToken", "token"];
    for (const v of globalVars) {
      if (typeof window[v] !== "undefined" && window[v]) {
        token = window[v];
        break;
      }
    }
  }

  // それでも鍵が見つからない場合、エラーを投げます
  if (!token) {
    throw new Error("Google Driveへのアクセス権限（認証鍵）がアプリ内で見つかりませんでした。ログイン状態をお確かめください。");
  }

  // 鍵が見つかったので、実際にダウンロードを試みます
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Google Driveからのダウンロードに失敗しました。(ステータス: ${response.status})`);
  }

  return await response.blob();
}

// Geminiを使ってダウンロードしたファイルの内容（住所等）を検証する関数
async function verifyFileContentWithGemini(blob, mimeType, targetSS) {
  // BlobをGeminiが読めるBase64テキストに変換します
  const base64Data = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });

  // 安全対策: mimeTypeが不適切な場合は強制的にPDF扱いにする
  let safeMimeType = mimeType;
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(safeMimeType)) {
    safeMimeType = "application/pdf";
  }

  // 【新設】AIに対して、蛍光ペンでマークする代わりに、「具体的に書類のどの部分に住所が書いてあったか」を抜き出して詳しく説明するようプロンプトを強化しました
  const prompt = `
    これから送付するファイル（PDF、画像、またはExcel等の書類）の中身を読み取り、
    今回の配送指示書から抽出された以下のお届け先情報と【本当に一致しているか（誤配の可能性がないか）】を厳重に確認してください。

    【照合したいお届け先情報】
    - 届先名称: ${targetSS.fullName}
    - 配送先住所: ${targetSS.address || "住所情報なし"}

    【チェック基準と命令】
    1. このファイル内に、上記のお届け先名称や配送先住所（またはそれに極めて近い表記揺れ、例:「3丁目24-15」と「3-24-15」など）が記載されているかを確認してください。
    2. ファイル内のどこかしらにこの店舗名、またはこの住所が記載されていれば、一致（verified: true）とみなしてください。
    3. もし、全く異なる別の地域名（例: 港区ではない、店舗名が全然違うなど）が記載されている場合は、不一致（verified: false）にしてください。
    4. 【重要】理由（reason）を回答する際、蛍光ペンの代わりに、このファイル内の「どのあたり（例：書類の右上の住所欄、1枚目の下部、〇〇行目など）」に今回の住所や店名が書かれていたか、具体的にその一節を抜き出して日本語で分かりやすく説明してください。
  `;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      verified: { 
        type: "BOOLEAN", 
        description: "店舗名や住所がこのファイル内に記載されており、一致していると確認できた場合は true、そうでない・別店舗の可能性が高い場合は false" 
      },
      reason: { 
        type: "STRING", 
        description: "一致・不一致と判断した具体的な理由と、その住所や名前が記載されていた「ファイル内の具体的な場所」を分かりやすい日本語で説明" 
      }
    },
    required: ["verified", "reason"]
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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

  // 【改良】もしGoogleの「利用制限（429）」等にかかってしまった場合、フリーズせず初心者にも状況が一発で分かるメッセージを通知します
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(`GoogleのAI無料プランの【利用制限】に一時的に達しました。\n\n短時間に連続してボタンを押したため、Google側の制限（1分間に20回まで）にかかっています。\n\n【解決策】:\n1分ほど何も操作せずに待ってから、もう一度お試しください。自動的に解除されます。`);
    }
    const errorDetails = await response.text();
    throw new Error(`通信失敗 (ステータス: ${response.status}) - 詳細: ${errorDetails}`);
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

  if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
    UI.setOCR("AIによる配送指示書解析中... (数秒かかります)");
  }
  if (UI && UI.driveList) {
    UI.driveList.innerHTML = "解析完了後に自動照合を開始します...";
  }

  const reader = new FileReader();
  reader.onload = async (ev) => {
    const imgDataUrl = ev.target.result;

    try {
      if (!GEMINI_API_KEY || GEMINI_API_KEY === "" || GEMINI_API_KEY.startsWith("YOUR_")) {
        throw new Error("config.local.js に有効なGemini APIキーを設定してください。");
      }

      // Geminiから配送先と車両ナンバーを含むデータオブジェクトを受け取ります
      const ocrResult = await runGeminiOCR(imgDataUrl);
      if (!ocrResult || !Array.isArray(ocrResult.destinations)) {
        throw new Error("AIからのレスポンス形式が不正です（配送先リストが見つかりません）。");
      }
      
      const ssList = ocrResult.destinations;
      window.currentSSList = ssList;

      // 将来使えるように、抽出された車両ナンバーをグローバル変数（window）に保存しておきます
      window.currentVehicleNumber = ocrResult.vehicleNumber || "";

      // OCR結果エリア用の表示ラインを作成
      const displayLines = [];
      
      // 車両ナンバーが抽出できていれば、最初に目立つように表示します
      if (window.currentVehicleNumber) {
        displayLines.push(`【車両ナンバー】: ${window.currentVehicleNumber}`);
        displayLines.push(`----------------------------------`);
      }

      // 抽出された店舗名と住所のリストを追加
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
      
      // 【改良】画像解析時に429エラーが出た場合、ランキングが狂うのを防ぐためにアドバイスを表示します
      let errorMsg = `エラーが発生しました:\n${error.message}`;
      if (error.message.includes("429")) {
        errorMsg = `⚠️ 【Googleの利用制限に達しました】\n\n短時間に何度もAIを実行したため、Googleの無料枠制限（1分間に20回まで）にかかっています。\n\n【解決策】:\n1分ほど何も操作せずに待ってから、指示書ファイルを再度アップロードしてください。ランキングが正常に復旧します。`;
      }
      
      if (typeof UI !== "undefined" && typeof UI.setOCR === "function") {
        UI.setOCR(errorMsg);
      }
    }
  };
  reader.readAsDataURL(file);
}

// ==========================================
// 配送先選択プルダウンの描画（店舗名 ＋ 住所に改善）
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
  
  // 各選択肢に店舗名だけでなく (住所) もカッコ内に表示するように修正
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

// ==========================================
// ランキング描画：簡易地図ボタン設置
// ==========================================
function renderRankingInContainer(container, files) {
  if (!files || files.length === 0) {
    container.innerHTML = "<div>照合候補なし</div>";
    return;
  }

  const dropdown = document.getElementById("ssDropdown");
  const activeIndex = dropdown ? parseInt(dropdown.value, 10) : 0;
  const currentSS = window.currentSSList ? window.currentSSList[activeIndex] : null;

  // Google Map用の検索クエリ決定
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

    // ① Google Map外部起動ボタン（緑色）
    const mapButtonHtml = mapQuery 
      ? `<button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}', '_blank')" style="margin-top: 5px; margin-left: 8px; background-color: #34a853; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">🗺 Googleマップ</button>`
      : "";

    // ② 簡易地図作成・ポップアップボタン（オレンジ色）
    const miniMapButtonHtml = `
      <button onclick="openMiniMap('${escapeJSString(f.name)}')" style="margin-top: 5px; margin-left: 8px; background-color: #f39c12; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">📁 簡易地図を作成</button>
    `;

    return `
      <div style="padding: 10px 0;">
        <span>${color} <b>${isAuto ? "自動確定候補" : "候補"}</b> ${escapeHtml(f.name)}</span><br>
        一致率：<b>${percent}%</b><br>
        <small style="color: #666;">更新日時：${formattedDate}</small><br>
        
        <!-- PDFプレビュー用ボタン（最終チェック機能に対応） -->
        <button onclick="if(UI && typeof UI.selectDelivery === 'function'){UI.selectDelivery('${escapeJSString(f.id)}', '${escapeJSString(f.name)}')}else{alert('配送先を選択しました: ${escapeJSString(f.name)}');}" style="margin-top: 5px;">この配送先でOK (PDF)</button>
        
        <!-- Google Map起動用ボタン -->
        ${mapButtonHtml}

        <!-- 簡易地図作成ポップアップボタン -->
        ${miniMapButtonHtml}

      </div><hr style="border: none; border-top: 1px solid #eee; margin: 8px 0;">`;
  }).join("");
  container.innerHTML = html;
}

// ==========================================
// 簡易地図処理：指定された目的地周辺の簡易大通り道路地図を生成
// ==========================================
function openMiniMap(fileName) {
  showOnScreenMiniMap(fileName);
}

// ==========================================
// 大通り・道路・主要名称がクッキリ浮き出る簡易地図をその場で作成・描画
// ==========================================
function showOnScreenMiniMap(fileName) {
  const storeName = fileName.replace(/\.(pdf|xlsx|xls)$/i, "");
  
  // 現在選ばれている配送先情報を取得してクエリに使用
  const dropdown = document.getElementById("ssDropdown");
  const activeIndex = dropdown ? parseInt(dropdown.value, 10) : 0;
  const currentSS = window.currentSSList ? window.currentSSList[activeIndex] : null;
  
  // 住所を最優先にし、無い場合は店舗名を検索に使用
  const mapQuery = (currentSS && currentSS.address && currentSS.address.trim() !== "") 
    ? currentSS.address 
    : storeName;

  // 既存のポップアップを消去
  const existingModal = document.getElementById("miniMapModal");
  if (existingModal) existingModal.remove();

  // モーダル要素を生成
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

  // Google Maps埋め込み用のURLを生成
  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=13&output=embed&iwloc=near`;

  modal.innerHTML = `
    <div style="background: white; width: 90%; max-width: 750px; padding: 20px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); position: relative; font-family: sans-serif;">
      <h3 style="margin-top: 0; color: #1e50a2; font-size: 18px; border-bottom: 2px solid #1e50a2; padding-bottom: 8px;">🗺 周辺簡易道路地図: ${escapeHtml(storeName)}</h3>
      <p style="font-size: 12px; color: #666; margin-bottom: 15px;">
        ※周辺の主要幹線道路（山手通り、環七、環八、目黒通りなど）と目的地の位置関係が分かりやすい、広域な大通りスケールで表示しています。
      </p>
      
      <!-- 地図描画先エリア -->
      <div id="miniMapContainer" style="width: 100%; height: 420px; background: #fcfcfc; border-radius: 4px; overflow: hidden; border: 1px solid #ccc;">
        <iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" style="border:0;" allowfullscreen="" loading="lazy"></iframe>
      </div>
      
      <!-- 右上の閉じるボタン -->
      <button onclick="document.getElementById('miniMapModal').remove()" style="position: absolute; top: 15px; right: 20px; background: none; border: none; font-size: 20px; cursor: pointer; color: #999;">✕</button>
      
      <div style="margin-top: 15px; text-align: right; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: #888;">ドラッグで地図の移動、マウスホイールやピンチ操作でズーム率の調整が可能です。</span>
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

  // ① 完全一致 (100点)
  if (qClean === fClean) return 100;
  
  // ② 部分一致 (95点)
  if (qClean.includes(fClean) || fClean.includes(qClean)) return 95;

  // ③ 日本語固有名詞による部分一致救済 (92点)
  const qJP = qClean.replace(/[a-z0-9]/g, "");
  const fJP = fClean.replace(/[a-z0-9]/g, "");
  if (qJP.length >= 2 && fJP.length >= 2) {
    if (qJP.includes(fJP) || fJP.includes(qJP)) {
      return 92;
    }
  }

  // ④ AIの coreKeyword による救済 (85点)
  if (item.coreKeyword && item.coreKeyword.length >= 2) {
    const coreClean = cleanNameForMatching(item.coreKeyword);
    const isBroad = BROAD_KEYWORDS.some(broad => coreClean === broad);

    if (coreClean && coreClean.length >= 2 && !isBroad) {
      if (fClean.includes(coreClean)) {
        return 85; 
      }
    }
  }

  // ⑤ 住所（address）の地名とファイル名の照合救済
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

  // ⑥ 文字単位での Bigram 類似度
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
// Gemini APIによる解析処理
// ==========================================
async function runGeminiOCR(base64DataUrl) {
  const matches = base64DataUrl.match(/^data:(image\/.+|application\/pdf);base64,(.*)$/);
  if (!matches) throw new Error("Base64変換に失敗しました。");
  const mimeType = matches[1];
  const base64Data = matches[2];

  const prompt = `
    配送指示書の画像またはPDFから、以下の情報を正確に読み取って指定のJSONフォーマットで出力してください。

    1. 配送先情報 (destinations):
       - 届先名称 (fullName): SS名や店舗名、企業名を正確に抽出してください。
       - coreKeyword: それぞれの名称からブランド名（"ENEOS", "EneJet", "DD", "セルフ", "SS", "店"等）、および「環七」「16号」等の広域な道路名・路線名単体を除外した、店舗を個別に特定できる固有名称（例:「豊玉」「板橋」など）を抽出してください。
       - 住所 (address): 各届先名称に対応する「配送先住所」を画像内の住所欄などから正確に抽出してください。必ず届先名称と対応する正しい住所を1対1でペアにしてください。

    2. 車両ナンバー (vehicleNumber):
       - 画像内の「車番」や「車輛」などの項目の周辺、またはその後ろにあるカッコ「［ ］」または「[ ]」の中に書かれている車両のナンバー（例: 「品川100あ1234」など）を正確に抽出してください。
       - カッコ内の車両ナンバーが見つからない場合は、空文字 "" にしてください。
  `;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      destinations: {
        type: "ARRAY",
        description: "配送先とそれに対応する住所のペアリスト",
        items: {
          type: "OBJECT",
          properties: {
            fullName: { type: "STRING" },
            coreKeyword: { type: "STRING" },
            address: { type: "STRING", description: "配送先と1対1で対応する住所" }
          },
          required: ["fullName", "coreKeyword", "address"]
        }
      },
      vehicleNumber: {
        type: "STRING",
        description: "車番の後のカッコ［］または[]内に書かれている車両のナンバー"
      }
    },
    required: ["destinations", "vehicleNumber"]
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
      throw new Error("APIから有効なテキストレスポンスが得られませんでした。");
    }
    const cleanJsonText = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(cleanJsonText);
  } catch (e) {
    console.error("パース失敗時の生データ:", resultData);
    throw new Error(`JSONパース失敗: ${e.message}`);
  }
}