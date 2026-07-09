const UI = {
  // GetterによるDOMの遅延取得
  get previewArea() {
    return document.getElementById("previewArea");
  },
  get ocrText() {
    return document.getElementById("ocrText");
  },
  get driveList() {
    return document.getElementById("driveList");
  },

  // 安全なOCR表示更新（改行が綺麗に反映されるよう pre-wrap スタイルを追加）
  setOCR(text) {
    const el = this.ocrText;
    if (el) {
      el.style.whiteSpace = "pre-wrap"; // 改行を画面に正しく反映させるための設定
      el.textContent = text;
    } else {
      console.warn("警告: #ocrText 要素がDOM上に見つかりません。");
    }
  },

  // 画像およびPDFのプレビュー表示に対応（app.jsからロジックを統合）
  showImage(src, mimeType) {
    const area = this.previewArea;
    if (!area) return;

    // ファイル種別がPDFであるか判定
    const isPdf = (mimeType === "application/pdf") || (src && src.startsWith("data:application/pdf"));
    
    if (isPdf) {
      area.innerHTML = `<embed src="${src}" type="application/pdf" style="width:100%; height:500px; border:1px solid #ccc; border-radius:4px;">`;
    } else {
      area.innerHTML = `<img src="${src}" style="max-width:100%; border-radius:4px;">`;
    }
  },

  // プレースホルダー（app.jsでオーバーライドされます）
  selectDelivery(id, name) {
    console.log(`配送先が選択されました: ID=${id}, Name=${name}`);
  }
};

// 他のJSファイルから安全にアクセスできるようにグローバルオブジェクトとして明示的にバインド
window.UI = UI;