// delivery-app/js/counter.js

// TODO: ご自身でデプロイしたGoogle Apps Script (GAS) の「ウェブアプリURL」に置き換えてください
const COUNTER_API_URL = "https://script.google.com/macros/s/AKfycbwRpoXkB3QFZ5w4hSVt62Z1u-xk-nU_mNmJwXf3WFqIrAxhgcWZmmCBXUUF_Oi-P9rA/exec";

/**
 * 訪問者数をGASに記録し、画面のカウンター表示を更新します
 * @param {string} userEmail - ログイン中のGoogleユーザーのメールアドレス
 */
async function recordAndFetchVisitorCount(userEmail) {
  const todayElem = document.getElementById("today-count");
  const totalElem = document.getElementById("total-count");

  // 同一セッション（タブを開いている間）での多重送信を防止
  const alreadyCounted = sessionStorage.getItem("visitor_counted");

  try {
    let response;
    
    if (alreadyCounted === "true") {
      // 既に送信済みの場合は、カウントアップせずに「現在のカウント値だけ」を取得します
      // （GAS側にカウントアップしないフラグ "justFetch: true" を送る）
      response = await fetch(COUNTER_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ email: userEmail, justFetch: true })
      });
    } else {
      // セッション内初回アクセス時は新規にログを記録
      response = await fetch(COUNTER_API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ email: userEmail, justFetch: false })
      });
      
      sessionStorage.setItem("visitor_counted", "true");
    }

    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status === "success") {
      if (todayElem) todayElem.textContent = data.today;
      if (totalElem) totalElem.textContent = data.total;
    } else {
      console.error("カウンター集計エラー:", data.message);
    }
  } catch (error) {
    console.error("アクセスカウンターの通信に失敗しました:", error);
    if (todayElem) todayElem.textContent = "エラー";
    if (totalElem) totalElem.textContent = "エラー";
  }
}