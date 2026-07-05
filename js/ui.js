
const UI = {
  previewArea: document.getElementById("previewArea"),
  deliveryStatus: document.getElementById("deliveryStatus"),
  driveStatus: document.getElementById("driveStatus"),
  osmStatus: document.getElementById("osmStatus"),
  mapStatus: document.getElementById("mapStatus"),

  setPlaceholder() {
    if (!this.previewArea) return;

    this.previewArea.innerHTML = `
      <p class="placeholder">PDF・画像がここに表示されます</p>
    `;
  },

  showImage(src) {
    if (!this.previewArea) return;

    this.previewArea.innerHTML = "";
    const img = document.createElement("img");
    img.src = src;
    this.previewArea.appendChild(img);
  },

  showPDFMessage(fileName) {
    if (!this.previewArea) return;

    this.previewArea.innerHTML = `
      <p class="placeholder">📄 PDF読み込み中: ${fileName}</p>
      <p class="placeholder">（次バージョンでPDFプレビュー対応）</p>
    `;
  },

  setStatus(type, text) {
    if (this[type]) {
      this[type].textContent = text;
    }
  }
};

/* =========================
   OCR表示
========================= */

UI.ocrText = document.getElementById("ocrText");

UI.setOCR = function(text) {
  if (this.ocrText) {
    this.ocrText.textContent = text;
  }
};

/* =========================
   CSVマスター表示
========================= */

UI.masterStatus = document.getElementById("masterStatus");

UI.setMasterStatus = function(text) {
  if (this.masterStatus) {
    this.masterStatus.textContent = text;
  }
};