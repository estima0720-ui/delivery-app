
const fileInput = document.getElementById("fileInput");
const csvInput = document.getElementById("csvInput");

// 初期化
UI.setPlaceholder();

// マスター保持
let deliveryMaster = [];

// =========================
// ファイル選択
// =========================
fileInput.addEventListener("change", handleFile);

function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.type === "application/pdf") {
    handlePDF(file);
    return;
  }

  if (file.type.startsWith("image/")) {
    handleImage(file);
    return;
  }

  alert("対応していないファイル形式です");
}

// =========================
// 画像処理
// =========================
function handleImage(file) {
  const reader = new FileReader();

  reader.onload = function (e) {
    const imageData = e.target.result;

    UI.showImage(imageData);

    runOCR(imageData);
  };

  reader.readAsDataURL(file);

  UI.setStatus("deliveryStatus", "⏳ OCR処理中...");
  UI.setStatus("driveStatus", "（未検索）");
  UI.setStatus("osmStatus", "（未表示）");
  UI.setStatus("mapStatus", "（未表示）");
}

// =========================
// PDF（仮）
// =========================
function handlePDF(file) {
  UI.showPDFMessage(file.name);

  UI.setStatus("deliveryStatus", "▼ PDF（OCR未対応）");
}

// =========================
// OCR
// =========================
async function runOCR(imageData) {
  UI.setOCR("⏳ OCR処理中...");

  const result = await Tesseract.recognize(
    imageData,
    "jpn+eng",
    { logger: m => console.log(m) }
  );

  const text = result.data.text;

  UI.setOCR(text);

  matchDelivery(text);
}

// =========================
// CSV読み込み
// =========================
csvInput.addEventListener("change", handleCSV);

function handleCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    parseCSV(e.target.result);
  };

  reader.readAsText(file, "utf-8");
}

function parseCSV(text) {
  const lines = text.split("\n").filter(l => l.trim() !== "");

  deliveryMaster = lines.slice(1).map(line => {
    const [id, name, address, keyword] = line.split(",");

    return {
      id,
      name,
      address,
      keyword: (keyword || "").trim()
    };
  });

  UI.setMasterStatus(`📦 ${deliveryMaster.length}件読み込み完了`);
}

// =========================
// 配送先マッチング（改善版）
// =========================
function matchDelivery(text) {
  let bestMatch = null;
  let maxScore = 0;

  for (const item of deliveryMaster) {
    if (!item.keyword) continue;

    const keywords = item.keyword.split(" ");

    let score = 0;

    for (const key of keywords) {
      if (text.includes(key)) {
        score++;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestMatch = item;
    }
  }

  if (bestMatch) {
    UI.setStatus("deliveryStatus", `📍 ${bestMatch.name}`);
  } else {
    UI.setStatus("deliveryStatus", "⚠️ マッチなし");
  }
}