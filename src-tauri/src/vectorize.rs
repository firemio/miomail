//! セマンティック検索: ベクトルストア抽象化・ベクトル化ジョブ・
//! ジョブ進捗記録・ランク融合(RRF)などの純粋ロジック。
//!
//! ベクトル DB には外部依存を持ち込まず、SQLite BLOB(f32 LE)に保存して
//! 総当たりコサイン類似度で検索する(10万件未満ならミリ秒級)。
//! 将来 LanceDB 等へ差し替えられるよう [`VectorStore`] トレイトで抽象化する。

use serde::Serialize;

use crate::db::DbState;

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/// 1バッチでエンコードするメール数。
pub const VECTORIZE_BATCH_SIZE: usize = 32;
/// 1同期サイクルで処理するバッチ数の上限(= 1サイクル最大 128 通)。
pub const VECTORIZE_MAX_BATCHES_PER_CYCLE: usize = 4;
/// エンコード対象テキストに使う本文の先頭文字数。
pub const VECTORIZE_BODY_CHARS: usize = 1000;

/// RRF(Reciprocal Rank Fusion)の定数 k。
pub const RRF_K: f64 = 60.0;

/// セマンティック検索でベクトルヒットを採用するコサイン類似度の下限。
/// ruri-v3-70m の実データ実測で関連ヒット ≒ 0.79、ノイズ ～0.78 だったことに基づく。
pub const SEMANTIC_VECTOR_MIN_SCORE: f32 = 0.78;

// ジョブ種別(job_progress.kind)
pub const JOB_SYNC: &str = "sync";
pub const JOB_BACKFILL: &str = "backfill";
pub const JOB_PREFETCH: &str = "prefetch";
pub const JOB_VECTORIZE: &str = "vectorize";
pub const JOB_MODEL_DOWNLOAD: &str = "model_download";

// app_settings のキー
pub const SETTING_SEMANTIC_ENABLED: &str = "semantic_enabled";
pub const SETTING_SEMANTIC_ERROR: &str = "semantic_error";

// ---------------------------------------------------------------------------
// app_settings(小さな KVS。セマンティック機能のオプトイン状態など)
// ---------------------------------------------------------------------------

pub fn setting_get(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

pub fn setting_set(conn: &rusqlite::Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .ok();
}

pub fn setting_delete(conn: &rusqlite::Connection, key: &str) {
    conn.execute("DELETE FROM app_settings WHERE key = ?1", [key]).ok();
}

/// セマンティック検索がオプトインされているか(デフォルト OFF)。
pub fn semantic_enabled(conn: &rusqlite::Connection) -> bool {
    setting_get(conn, SETTING_SEMANTIC_ENABLED).as_deref() == Some("1")
}

/// 最後に記録されたセマンティック機能のエラー(無ければ None)。
pub fn semantic_error(conn: &rusqlite::Connection) -> Option<String> {
    setting_get(conn, SETTING_SEMANTIC_ERROR).filter(|e| !e.is_empty())
}

// ---------------------------------------------------------------------------
// job_progress(各バックグラウンドジョブの進捗。PK: kind + account_id)
// ---------------------------------------------------------------------------

/// IF 契約: mail_job_progress の要素。
#[derive(Debug, Clone, Serialize)]
pub struct JobProgress {
    /// 'sync' | 'backfill' | 'prefetch' | 'vectorize' | 'model_download'
    pub kind: String,
    pub done: i64,
    pub total: i64,
    pub message: String,
    /// unix 秒
    pub updated_at: i64,
    pub active: bool,
}

/// 進捗を upsert する(純粋な記録。active 判定は読み出し時に行う)。
pub fn job_progress_upsert(
    conn: &rusqlite::Connection,
    kind: &str,
    account_id: i64,
    done: i64,
    total: i64,
    message: &str,
) {
    conn.execute(
        "INSERT INTO job_progress (kind, account_id, done, total, message, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
         ON CONFLICT(kind, account_id) DO UPDATE SET
             done = excluded.done,
             total = excluded.total,
             message = excluded.message,
             updated_at = excluded.updated_at",
        rusqlite::params![kind, account_id, done, total, message],
    )
    .ok();
}

/// ジョブ完了を記録する(done = total に揃えて active を解消する)。
pub fn job_progress_finish(conn: &rusqlite::Connection, kind: &str, account_id: i64, message: &str) {
    let total: i64 = conn
        .query_row(
            "SELECT MAX(total, done, 0) FROM job_progress WHERE kind = ?1 AND account_id = ?2",
            rusqlite::params![kind, account_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    job_progress_upsert(conn, kind, account_id, total, total, message);
}

/// ジョブ失敗を記録する(active を即時解消するため done = total に揃え、
/// メッセージにエラー内容を残す)。
pub fn job_progress_fail(conn: &rusqlite::Connection, kind: &str, account_id: i64, message: &str) {
    job_progress_finish(conn, kind, account_id, message);
}

/// updated_at がこの秒数以内なら「実行中」とみなす単純規則の閾値。
pub const JOB_ACTIVE_WINDOW_SECS: i64 = 300;

/// active 判定の単純規則: 未完了(done < total)かつ更新が新しい。
pub fn job_is_active(done: i64, total: i64, updated_at: i64, now: i64) -> bool {
    done < total && updated_at >= now - JOB_ACTIVE_WINDOW_SECS
}

/// 指定アカウントの進捗一覧。model_download は全アカウント共通(account_id=0)
/// のジョブなので必ず含める。
pub fn job_progress_list(conn: &rusqlite::Connection, account_id: i64) -> Vec<JobProgress> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut stmt = match conn.prepare(
        "SELECT kind, done, total, message, updated_at FROM job_progress
         WHERE account_id = ?1 OR account_id = 0
         ORDER BY kind",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([account_id], |row| {
        let done: i64 = row.get(1)?;
        let total: i64 = row.get(2)?;
        let updated_at: i64 = row.get(4)?;
        Ok(JobProgress {
            kind: row.get(0)?,
            done,
            total,
            message: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            updated_at,
            active: job_is_active(done, total, updated_at, now),
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// エンコード対象テキストの構築(純粋ロジック)
// ---------------------------------------------------------------------------

/// 空白類を1スペースに畳み、先頭 max_chars 文字(マルチバイト安全)に切り詰める。
pub fn collapse_and_truncate(text: &str, max_chars: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

/// エンコード対象テキスト = 件名 + 本文先頭 VECTORIZE_BODY_CHARS 文字。
pub fn build_document_text(subject: &str, text_body: &str) -> String {
    let body = collapse_and_truncate(text_body, VECTORIZE_BODY_CHARS);
    let subject = subject.trim();
    if body.is_empty() {
        subject.to_string()
    } else if subject.is_empty() {
        body
    } else {
        format!("{}\n{}", subject, body)
    }
}

// ---------------------------------------------------------------------------
// コサイン類似度・RRF 融合(純粋ロジック)
// ---------------------------------------------------------------------------

/// コサイン類似度。どちらかが零ベクトルなら 0。
/// (encode() の出力は L2 正規化済みなので実質内積だが、
///   DB 復元時の丸め誤差を吸収するため毎回正規化して計算する)
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0f64;
    let mut na = 0f64;
    let mut nb = 0f64;
    for i in 0..a.len() {
        let x = a[i] as f64;
        let y = b[i] as f64;
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    (dot / (na.sqrt() * nb.sqrt())) as f32
}

/// RRF(Reciprocal Rank Fusion, k=60)で2つのランキングを融合する。
/// スコアは 1/(k + rank)。ベクトル側・FTS 側双方の順位を加算し、
/// 降順ソートして上位 limit 件の message_id を返す。
pub fn rrf_fuse(
    vector_ranked: &[i64],
    fts_ranked: &[i64],
    k: f64,
    limit: usize,
) -> Vec<i64> {
    use std::collections::HashMap;
    let mut scores: HashMap<i64, f64> = HashMap::new();
    for (rank, id) in vector_ranked.iter().enumerate() {
        *scores.entry(*id).or_default() += 1.0 / (k + rank as f64 + 1.0);
    }
    for (rank, id) in fts_ranked.iter().enumerate() {
        *scores.entry(*id).or_default() += 1.0 / (k + rank as f64 + 1.0);
    }
    let mut ids: Vec<(i64, f64)> = scores.into_iter().collect();
    // 同点時は id 昇順で安定化
    ids.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    ids.into_iter().take(limit).map(|(id, _)| id).collect()
}

// ---------------------------------------------------------------------------
// VectorStore トレイト + SQLite 実装
// ---------------------------------------------------------------------------

/// ベクトルストアの抽象化。将来 LanceDB 等に差し替える場合は
/// このトレイトの別実装を用意すればよい。
pub trait VectorStore {
    /// ベクトルを保存する(model_version 違いの古い行は上書き対象)。
    fn upsert(&self, message_id: i64, model_version: &str, vector: &[f32]) -> Result<(), String>;
    /// クエリベクトルとのコサイン類似度で上位 limit 件の
    /// (message_id, similarity) を類似度降順で返す。
    fn search_cosine(
        &self,
        query: &[f32],
        account_id: Option<i64>,
        model_version: &str,
        limit: usize,
    ) -> Result<Vec<(i64, f32)>, String>;
    /// 指定 model_version のベクトル数。
    fn count(&self, model_version: &str) -> Result<i64, String>;
}

/// f32 スライス → リトルエンディアン BLOB。
pub fn vector_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

/// リトルエンディアン BLOB → f32 スライス(長さが4の倍数でない場合は None)。
pub fn blob_to_vector(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.len() % 4 != 0 {
        return None;
    }
    Some(
        blob.chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
    )
}

/// SQLite BLOB による VectorStore 実装(総当たりコサイン)。
pub struct SqliteVectorStore<'c> {
    pub conn: &'c rusqlite::Connection,
}

impl VectorStore for SqliteVectorStore<'_> {
    fn upsert(&self, message_id: i64, model_version: &str, vector: &[f32]) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO vectors (message_id, model_version, dim, vector, updated_at)
                 VALUES (?1, ?2, ?3, ?4, strftime('%s','now'))
                 ON CONFLICT(message_id) DO UPDATE SET
                     model_version = excluded.model_version,
                     dim = excluded.dim,
                     vector = excluded.vector,
                     updated_at = excluded.updated_at",
                rusqlite::params![message_id, model_version, vector.len() as i64, vector_to_blob(vector)],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn search_cosine(
        &self,
        query: &[f32],
        account_id: Option<i64>,
        model_version: &str,
        limit: usize,
    ) -> Result<Vec<(i64, f32)>, String> {
        // 現行モデルのベクトルのみ対象(古い model_version は無視)
        let sql = match account_id {
            Some(_) => {
                "SELECT v.message_id, v.vector FROM vectors v
                 JOIN messages m ON m.id = v.message_id
                 WHERE v.model_version = ?1 AND m.account_id = ?2"
            }
            None => "SELECT v.message_id, v.vector FROM vectors v WHERE v.model_version = ?1",
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows: Vec<(i64, Vec<u8>)> = match account_id {
            Some(account_id) => stmt
                .query_map(rusqlite::params![model_version, account_id], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect(),
            None => stmt
                .query_map(rusqlite::params![model_version], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect(),
        };

        let mut scored: Vec<(i64, f32)> = rows
            .into_iter()
            .filter_map(|(id, blob)| {
                blob_to_vector(&blob).map(|v| (id, cosine_similarity(query, &v)))
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }

    fn count(&self, model_version: &str) -> Result<i64, String> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM vectors WHERE model_version = ?1",
                [model_version],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// ベクトル化バックグラウンドジョブ
// ---------------------------------------------------------------------------

/// ベクトル化を 1 サイクル分だけ進める。
/// message_bodies はあるのに現行モデルの vectors が無いメールを新しい順に
/// バッチ(VECTORIZE_BATCH_SIZE 通)エンコードし、1 サイクル
/// VECTORIZE_MAX_BATCHES_PER_CYCLE バッチまで進める。
/// セマンティックが有効でモデル完備のときだけ呼ぶこと(sync_all_accounts から)。
pub async fn run_vectorize_step(account_id: i64, db: &DbState) -> Result<(), String> {
    // セマンティック無効 or モデル未完備なら何もしない(sync_all_accounts から
    // 無条件にフックされるため、ここで早期リターンする)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if !crate::embed::semantic_ready(&conn) {
            return Ok(());
        }
    }

    // サイクル開始時点の未ベクトル化件数(進捗の分母)
    let total_missing: i64 = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        missing_vector_count(&conn, account_id)
    };
    if total_missing == 0 {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        job_progress_finish(&conn, JOB_VECTORIZE, account_id, "ベクトル化は完了しています");
        return Ok(());
    }

    let mut processed = 0i64;
    for _ in 0..VECTORIZE_MAX_BATCHES_PER_CYCLE {
        let candidates: Vec<(i64, String, String)> = {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT m.id, COALESCE(m.subject, ''), COALESCE(mb.text_body, '')
                     FROM messages m
                     JOIN message_bodies mb ON mb.message_id = m.id
                     LEFT JOIN vectors v ON v.message_id = m.id AND v.model_version = ?2
                     WHERE m.account_id = ?1
                       AND v.message_id IS NULL
                       AND mb.text_body IS NOT NULL AND mb.text_body != ''
                     ORDER BY m.date_ts DESC, m.id DESC
                     LIMIT ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(
                    rusqlite::params![account_id, crate::embed::MODEL_VERSION, VECTORIZE_BATCH_SIZE as i64],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        if candidates.is_empty() {
            break;
        }

        let texts: Vec<String> = candidates
            .iter()
            .map(|(_, subject, body)| build_document_text(subject, body))
            .collect();

        // ONNX 推論はブロッキングするので専用スレッドで実行する
        let vectors = tokio::task::spawn_blocking(move || {
            crate::embed::encode(&texts, crate::embed::EncodeKind::Document)
        })
        .await
        .map_err(|e| format!("vectorize worker failed: {}", e))??;

        {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let store = SqliteVectorStore { conn: &conn };
            for ((message_id, _, _), vector) in candidates.iter().zip(vectors.iter()) {
                store.upsert(*message_id, crate::embed::MODEL_VERSION, vector)?;
            }
            processed += candidates.len() as i64;
            job_progress_upsert(
                &conn,
                JOB_VECTORIZE,
                account_id,
                processed,
                total_missing,
                &format!("メールをベクトル化中 ({}/{})", processed, total_missing),
            );
        }

        if (candidates.len()) < VECTORIZE_BATCH_SIZE {
            break; // もう残りが無い
        }
    }

    let remaining: i64 = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        missing_vector_count(&conn, account_id)
    };
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    if remaining == 0 {
        job_progress_finish(&conn, JOB_VECTORIZE, account_id, "ベクトル化が完了しました");
    }
    // 残りがあれば done < total のまま(active) — 次のサイクルで続きを処理する
    Ok(())
}

/// 未ベクトル化(現行モデルの vectors 行が無い)メール数。
fn missing_vector_count(conn: &rusqlite::Connection, account_id: i64) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM messages m
         JOIN message_bodies mb ON mb.message_id = m.id
         LEFT JOIN vectors v ON v.message_id = m.id AND v.model_version = ?2
         WHERE m.account_id = ?1 AND v.message_id IS NULL
           AND mb.text_body IS NOT NULL AND mb.text_body != ''",
        rusqlite::params![account_id, crate::embed::MODEL_VERSION],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn test_conn() -> rusqlite::Connection {
        crate::db::open_connection(Path::new(":memory:")).unwrap()
    }

    // --- 純粋ロジック: コサイン類似度 ---

    #[test]
    fn cosine_basics() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![1.0f32, 0.0, 0.0];
        let c = vec![0.0f32, 1.0, 0.0];
        let d = vec![-1.0f32, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 1e-6);
        assert!(cosine_similarity(&a, &c).abs() < 1e-6);
        assert!((cosine_similarity(&a, &d) + 1.0).abs() < 1e-6);
        // 零ベクトル・長さ不一致は 0
        assert_eq!(cosine_similarity(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
        assert_eq!(cosine_similarity(&[1.0], &[1.0, 0.0]), 0.0);
        // 非正規化ベクトルでも正しく正規化される
        let e = vec![2.0f32, 0.0, 0.0];
        assert!((cosine_similarity(&a, &e) - 1.0).abs() < 1e-6);
    }

    // --- 純粋ロジック: RRF 融合 ---

    #[test]
    fn rrf_prefers_items_in_both_rankings() {
        // id=1 は両方に登場、id=2 はベクトルのみ、id=3 は FTS のみ
        let fused = rrf_fuse(&[2, 1], &[3, 1], RRF_K, 10);
        assert_eq!(fused[0], 1, "両方に登場する id が最上位: {:?}", fused);
        assert!(fused.contains(&2) && fused.contains(&3));
    }

    #[test]
    fn rrf_respects_limit_and_dedup() {
        let fused = rrf_fuse(&[1, 2, 3], &[3, 2, 1], RRF_K, 2);
        assert_eq!(fused.len(), 2, "limit が効く: {:?}", fused);
        let mut sorted = fused.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), fused.len(), "重複しない");
    }

    #[test]
    fn rrf_single_side_only() {
        let fused = rrf_fuse(&[5, 4], &[], RRF_K, 10);
        assert_eq!(fused, vec![5, 4], "片側だけでも順位が保たれる");
        assert!(rrf_fuse(&[], &[], RRF_K, 10).is_empty());
    }

    // --- 純粋ロジック: テキスト切り詰め ---

    #[test]
    fn collapse_and_truncate_is_multibyte_safe() {
        let body = "あ".repeat(2000);
        let out = collapse_and_truncate(&body, 1000);
        assert_eq!(out.chars().count(), 1000, "文字数で切る(バイト数ではない)");
        // 空白畳み込み
        assert_eq!(collapse_and_truncate("a\n \t b  c", 100), "a b c");
    }

    #[test]
    fn build_document_text_combines_subject_and_body() {
        let doc = build_document_text("件名テスト", &"本文".repeat(2000));
        assert!(doc.starts_with("件名テスト\n"));
        // 件名 + 改行 + 本文 1000 文字
        assert_eq!(doc.chars().count(), 5 + 1 + 1000);
        // 本文なしなら件名だけ
        assert_eq!(build_document_text("件名のみ", ""), "件名のみ");
        assert_eq!(build_document_text("", "本文のみ"), "本文のみ");
    }

    // --- BLOB 変換 ---

    #[test]
    fn blob_roundtrip() {
        let v = vec![0.5f32, -1.25, 3.0];
        let blob = vector_to_blob(&v);
        assert_eq!(blob_to_vector(&blob), Some(v));
        assert_eq!(blob_to_vector(&[0u8; 3]), None, "4の倍数でない長さは None");
    }

    // --- 進捗 upsert / active 規則 ---

    #[test]
    fn job_progress_upsert_updates_single_row() {
        let conn = test_conn();
        job_progress_upsert(&conn, JOB_VECTORIZE, 1, 3, 10, "working");
        job_progress_upsert(&conn, JOB_VECTORIZE, 1, 5, 10, "working");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM job_progress", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "同じ kind+account_id は1行に upsert される");
        let done: i64 = conn
            .query_row("SELECT done FROM job_progress", [], |r| r.get(0))
            .unwrap();
        assert_eq!(done, 5);
    }

    #[test]
    fn job_progress_finish_marks_inactive() {
        let conn = test_conn();
        job_progress_upsert(&conn, JOB_PREFETCH, 1, 5, 10, "working");
        job_progress_finish(&conn, JOB_PREFETCH, 1, "done");
        let list = job_progress_list(&conn, 1);
        let row = list.iter().find(|j| j.kind == JOB_PREFETCH).unwrap();
        assert_eq!(row.done, row.total);
        assert!(!row.active, "完了後は active=false");
    }

    #[test]
    fn job_progress_active_rule() {
        let conn = test_conn();
        job_progress_upsert(&conn, JOB_VECTORIZE, 1, 3, 10, "working");
        let list = job_progress_list(&conn, 1);
        let row = list.iter().find(|j| j.kind == JOB_VECTORIZE).unwrap();
        assert!(row.active, "未完了かつ更新直後は active=true");
        // model_download(account_id=0)は任意のアカウントの一覧に出る
        job_progress_upsert(&conn, JOB_MODEL_DOWNLOAD, 0, 1, 2, "dl");
        let list = job_progress_list(&conn, 99);
        assert!(list.iter().any(|j| j.kind == JOB_MODEL_DOWNLOAD));
    }

    #[test]
    fn job_is_active_pure() {
        let now = 100_000;
        assert!(job_is_active(1, 2, now - 10, now));
        assert!(!job_is_active(2, 2, now - 10, now), "完了は inactive");
        assert!(
            !job_is_active(1, 2, now - JOB_ACTIVE_WINDOW_SECS - 1, now),
            "古い更新は inactive"
        );
    }

    // --- VectorStore(SQLite 実装) ---

    #[test]
    fn sqlite_vector_store_upsert_and_search() {
        let conn = test_conn();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, email) VALUES (1, 't', 't@example.com');
             INSERT INTO folders (id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX');
             INSERT INTO messages (id, account_id, folder_id, uid, subject, date_ts)
             VALUES (1, 1, 1, 1, 'a', 1), (2, 1, 1, 2, 'b', 2);",
        )
        .unwrap();
        let store = SqliteVectorStore { conn: &conn };
        store.upsert(1, "m1", &[1.0, 0.0]).unwrap();
        store.upsert(2, "m1", &[0.0, 1.0]).unwrap();
        assert_eq!(store.count("m1").unwrap(), 2);
        assert_eq!(store.count("other").unwrap(), 0);

        let hits = store.search_cosine(&[0.9, 0.1], Some(1), "m1", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].0, 1, "類似度1位は id=1: {:?}", hits);
        assert!(hits[0].1 > hits[1].1, "降順: {:?}", hits);

        // アカウント絞り込み: 存在しないアカウントなら 0 件
        let none = store.search_cosine(&[1.0, 0.0], Some(999), "m1", 10).unwrap();
        assert!(none.is_empty());

        // 上書き(モデル差し替え相当)で count は増えない
        store.upsert(1, "m2", &[0.0, 1.0]).unwrap();
        assert_eq!(store.count("m2").unwrap(), 1);
        assert_eq!(store.count("m1").unwrap(), 1);
        // 現行モデル(m2)だけが検索対象になる
        let hits = store.search_cosine(&[1.0, 0.0], None, "m2", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, 1);
    }

    #[test]
    fn missing_vector_count_ignores_empty_bodies() {
        let conn = test_conn();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, email) VALUES (1, 't', 't@example.com');
             INSERT INTO folders (id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX');
             INSERT INTO messages (id, account_id, folder_id, uid, subject, date_ts)
             VALUES (1, 1, 1, 1, 'a', 1), (2, 1, 1, 2, 'b', 2), (3, 1, 1, 3, 'c', 3);
             INSERT INTO message_bodies (message_id, text_body) VALUES (1, '本文あり'), (2, '');",
        )
        .unwrap();
        // id=1: 本文あり・ベクトル無し → 対象 / id=2: 空本文 → 対象外 / id=3: 本文無し → 対象外
        assert_eq!(missing_vector_count(&conn, 1), 1);
        let store = SqliteVectorStore { conn: &conn };
        store
            .upsert(1, crate::embed::MODEL_VERSION, &[1.0, 0.0])
            .unwrap();
        assert_eq!(missing_vector_count(&conn, 1), 0);
    }
}
