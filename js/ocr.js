/**
 * OCRテキストの表記ゆれやノイズを事前に徹底除去する前処理
 * (高精度ゆえに発生するスペース、全角記号、枠線の文字化、届日の誤読を吸収します)
 */
function preprocessOCRText(text) {
  if (!text) return "";

  // 1. 全角英数字・全角記号をすべて半角に変換
  let cleaned = text.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  // 全角スペースを半角スペースに統一
  cleaned = cleaned.replace(/　/g, " ");

  // 2. 「届日」のOCR誤読パターンをすべて「届日」に統一
  // (届目, 居日, 居目, 眉日, 属日, 画日, 周日, 届月, 届曰, 居月 などを強力に補正)
  cleaned = cleaned.replace(/[届居眉属画周][日目月曰]/g, "届日");

  // 3. 記号の揺れを修正 (特にブラケット [ ] や 枠線として認識されたパイプ | )
  cleaned = cleaned.replace(/[【〔［（]/g, "[");
  cleaned = cleaned.replace(/[】〕］）]/g, "]");
  cleaned = cleaned.replace(/[|｜]/g, " "); // 罫線の文字化を除去

  // 4. 文字間の不自然なスペースを詰める
  // (例: "Ｅ Ｍ ｏ" -> "EMo", "届 日" -> "届日" のように、前後に文字がある1文字スペースを除去)
  cleaned = cleaned.replace(/([a-zA-Z\u30a0-\u30ff\u3040-\u309f\u4e00-\u9faf])\s([a-zA-Z\u30a0-\u30ff\u3040-\u309f\u4e00-\u9faf])/g, "$1$2");
  // 念のためもう一度（連続スペース対策）
  cleaned = cleaned.replace(/([a-zA-Z\u30a0-\u30ff\u3040-\u309f\u4e00-\u9faf])\s([a-zA-Z\u30a0-\u30ff\u3040-\u309f\u4e00-\u9faf])/g, "$1$2");

  return cleaned;
}

/**
 * OCRテキストから配送先（SS名・届先名称）のみを抽出する
 */
function extractSSOnly(text) {
  if (!text) return [];

  // まず前処理を行い、OCRノイズを無害化する
  const preprocessedText = preprocessOCRText(text);
  const lines = preprocessedText.split("\n");
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // 行頭の余計な番号（例: "1 ", "2 " などの行番号やノイズ記号）を除去
    line = line.replace(/^[^a-zA-Z\u30a0-\u30ff\u3040-\u309f\u4e00-\u9faf]+/g, "");

    // ==========================================
    // パターン1: 構造的抽出 (「届日」行の直後の行を狙い撃ち)
    // ==========================================
    if (/届日/.test(line)) {
      let targetLine = "";
      for (let j = i + 1; j < lines.length; j++) {
        const nextL = lines[j].trim();
        if (nextL) {
          // メタデータ行でなければ対象とする
          if (!/届日|出荷年月日|配送指示書|作成日|乗務員/.test(nextL)) {
            targetLine = nextL;
          }
          break;
        }
      }

      if (targetLine) {
        const cleaned = normalizeSSName(targetLine);
        if (cleaned && cleaned.length > 2) {
          results.push(cleaned);
          continue; 
        }
      }
    }

    // ==========================================
    // パターン2: キーワードベースの抽出
    // ==========================================
    
    // ノイズ判定を「完全一致（行全体がそれだけ）」に近い形に緩和し、
    // 「SS名と同じ行に余計な明細が写り込んでしまった場合」の巻き込み消滅を防ぎます。
    if (
      /^\s*(レギュラー|ハイオク|軽油|灯油|A重油)\s*$/.test(line) ||
      /^\s*(数量|単価|合計|金額)\s*$/.test(line) ||
      /ジョイント|インチ|ワンタッチ/.test(line)
    ) {
      continue;
    }

    // SS関連キーワード（半角化されているため、半角前提で検索できます）
    if (
      /SS/i.test(line) ||
      /サービスステーション/.test(line) ||
      /セルフ/.test(line) ||
      /DD/i.test(line) ||
      /EneJet/i.test(line) ||
      /エネジェット/.test(line) ||
      /ENEOS/i.test(line) ||
      /エネオス/.test(line) ||
      /出光/.test(line) ||
      /apollostation/i.test(line) ||
      /アポロ/.test(line) ||
      /スタンド/.test(line) ||
      /鉱油/.test(line) ||
      /石油/.test(line)
    ) {
      const cleaned = normalizeSSName(line);
      if (cleaned && cleaned.length > 2) {
        results.push(cleaned);
      }
    }

    // 補助キーワード
    if (/株式会社|有限会社|店|センター|営業所/.test(line)) {
      const cleaned = normalizeSSName(line);
      if (cleaned && cleaned.length > 2) {
        results.push(cleaned);
      }
    }
  }

  // もし上記の厳しい条件で1件も引っかからなかった場合の「最終セーフティネット」
  // (「届日」の次の行で、かつ空行でないものを無条件で候補として拾い上げます)
  if (results.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (/届日/.test(line)) {
        for (let j = i + 1; j < lines.length; j++) {
          const nextL = lines[j].trim();
          if (nextL && !/届日|出荷年月日|配送指示書|作成日|乗務員/.test(nextL)) {
            const cleaned = normalizeSSName(nextL);
            if (cleaned && cleaned.length > 2) {
              results.push(cleaned);
            }
            break;
          }
        }
      }
    }
  }

  return [...new Set(results)];
}

/**
 * SS名の表記ゆれ、重複ワード、電話番号などのノイズをクレンジング・統一する
 */
function normalizeSSName(text) {
  if (!text) return "";

  let cleaned = text;

  // 1. 電話番号の除去
  cleaned = cleaned.replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, "");

  // 2. 括弧および括弧内の文字の除去
  cleaned = cleaned.replace(/（.*?）|\(.*?\)/g, "");

  // 3. 不要な記号やコード類の除去
  cleaned = cleaned.replace(/[\[\]「」『』【】|]/g, "");

  // 4. 重複する同一ワードの統合
  cleaned = deduplicateWords(cleaned);

  // 5. 表記ゆれの統一 (すべて半角に名寄せ)
  cleaned = cleaned
    .replace(/サービスステーション/g, "SS")
    .replace(/エネオス|ENEOS/gi, "ENEOS")
    .replace(/Ene-?Jet/gi, "EneJet")
    .replace(/apollostation/gi, "apollostation")
    .replace(/ｓｓ/gi, "SS")
    .replace(/ＳＳ/g, "SS")
    .replace(/ＤＤ/g, "DD");

  // 6. 前後の空白を除去し、連続する余計な空白を半角スペース1つに統合
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

/**
 * 文字列内の連続する重複単語を1つにまとめる
 */
function deduplicateWords(str) {
  const parts = str.split(/[\s　]+/);
  const uniqueParts = [];
  for (const part of parts) {
    if (!part) continue;
    if (uniqueParts.length === 0 || uniqueParts[uniqueParts.length - 1] !== part) {
      uniqueParts.push(part);
    }
  }
  return uniqueParts.join(" ");
}