
const MATCHER = {

  // =========================
  // SS名ゆれ補正
  // =========================
  normalize(text) {

    return text
      .toLowerCase()
      .replace(/エネオス|eneos/g, "eneos")
      .replace(/出光|idemitsu/g, "idemitsu")
      .replace(/apollostation|アポロステーション/g, "apollostation")
      .replace(/サービスステーション/g, "ss")
      .replace(/\s+/g, "");
  },

  // =========================
  // スコア計算（重み付き）
  // =========================
  calcScore(text, name) {

    const t = this.normalize(text);
    const n = this.normalize(name);

    let score = 0;

    const words = t.split(/[\s　]+/);

    for (const w of words) {
      if (!w) continue;

      if (n.includes(w)) {

        // SSは重み強化（重要）
        if (w.includes("ss")) {
          score += 5;
        } else {
          score += 2;
        }
      }
    }

    return score;
  },

  // =========================
  // ランキング
  // =========================
  rankFiles(text, files) {

    return files
      .map(f => ({
        ...f,
        score: this.calcScore(text, f.name)
      }))
      .sort((a, b) => b.score - a.score);
  }
};