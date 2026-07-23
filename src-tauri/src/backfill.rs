//! バックフィル(全メールのヘッダを過去方向へ段階的にローカル化)と
//! 本文プリフェッチの純粋ロジック。IMAP / DB に依存しない計算だけを
//! ここに集め、単体テスト可能にする。

/// 1フォルダ1同期サイクルあたりに過去方向へ取得するヘッダの件数。
pub const BACKFILL_CHUNK_SIZE: u32 = 500;

/// 1アカウント1同期サイクルあたりにプリフェッチする本文の最大通数。
pub const PREFETCH_PER_CYCLE: i64 = 20;

/// プリフェッチ対象とする直近メール数の上限(アカウントあたり)。
/// これより古いメールの本文は開封時の従来経路に任せる。
pub const PREFETCH_LOOKBACK_LIMIT: i64 = 2000;

/// 本文プリフェッチ1通あたりの取得バイト上限。
/// `BODY.PEEK[TEXT]<0.N>` の部分取得で帯域を制限する。
pub const PREFETCH_TEXT_MAX_BYTES: u32 = 512 * 1024;

/// フォルダ単位のバックフィル状態。DB の folders テーブル
/// (oldest_uid_synced / backfill_done)に永続化される。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackfillState {
    /// ローカルに取得済みの最古 UID。0 = バックフィル未開始(未シード)。
    pub oldest_uid_synced: u32,
    /// true = サーバー上の全履歴を取得し終えた。
    pub done: bool,
}

impl BackfillState {
    pub fn not_started() -> Self {
        BackfillState {
            oldest_uid_synced: 0,
            done: false,
        }
    }
}

/// 初回のバックフィル状態を決める(シード)。
///
/// - `local_min_uid`: ローカルに既にある最古 UID(uid > 0 のみ対象)。
///   既存の初回同期(最新 N 件)済みフォルダはここから過去へ遡る。
/// - `server_exists` / `server_uid_next`: SELECT したサーバー側の状態。
///   ローカルに1通も無い(まだ同期されたことのない)フォルダは
///   uid_next(最新 UID + 1)を起点に過去へ遡る。
pub fn seed(
    local_min_uid: Option<u32>,
    server_exists: u32,
    server_uid_next: Option<u32>,
) -> BackfillState {
    if server_exists == 0 {
        // サーバー上にメールが無い = 遡るものが無い
        return BackfillState {
            oldest_uid_synced: 0,
            done: true,
        };
    }
    match local_min_uid {
        Some(min) if min <= 1 => BackfillState {
            oldest_uid_synced: 1,
            done: true, // 既に UID 1 まで持っている
        },
        Some(min) => BackfillState {
            oldest_uid_synced: min,
            done: false,
        },
        None => match server_uid_next {
            Some(next) if next > 1 => BackfillState {
                oldest_uid_synced: next,
                done: false,
            },
            // UIDNEXT を取れないサーバーでは進捗を保証できないため完了扱い
            // (無限リトライを避ける)。RFC 3501 上 UIDNEXT は必須応答。
            _ => BackfillState {
                oldest_uid_synced: 0,
                done: true,
            },
        },
    }
}

/// 次に UID FETCH すべき範囲 (low, high)(両端含む)を返す。
/// 取得不要(完了済み / 未シード / UID 1 到達)なら None。
pub fn next_chunk_range(state: BackfillState) -> Option<(u32, u32)> {
    if state.done || state.oldest_uid_synced <= 1 {
        return None;
    }
    let high = state.oldest_uid_synced - 1;
    let low = high.saturating_sub(BACKFILL_CHUNK_SIZE - 1).max(1);
    Some((low, high))
}

/// チャンク取得の結果を反映して状態を進める。
///
/// - `fetched_min_uid`: このチャンクで実際に取得できた最小 UID(0件なら None)。
/// - サーバー応答が空、または UID 1 に到達したら完了。
/// - 状態が後退しないこと(単調減少)をここで保証する。
pub fn advance(state: BackfillState, fetched_min_uid: Option<u32>) -> BackfillState {
    if state.done || state.oldest_uid_synced == 0 {
        return state;
    }
    match fetched_min_uid {
        None => BackfillState {
            done: true,
            ..state
        },
        Some(min) if min <= 1 => BackfillState {
            oldest_uid_synced: 1,
            done: true,
        },
        Some(min) if min < state.oldest_uid_synced => BackfillState {
            oldest_uid_synced: min,
            done: false,
        },
        // 想定外の応答(範囲外 UID)では進捗を更新せず完了扱いにし、
        // 同じ範囲を永久に取り直すループを防ぐ。
        Some(_) => BackfillState {
            done: true,
            ..state
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_marks_empty_server_done() {
        let s = seed(None, 0, Some(1));
        assert!(s.done);
    }

    #[test]
    fn seed_uses_local_min_uid_when_present() {
        // 最新200件(UID 801..1000)だけローカルにあるフォルダ
        let s = seed(Some(801), 1000, Some(1001));
        assert_eq!(
            s,
            BackfillState {
                oldest_uid_synced: 801,
                done: false
            }
        );
    }

    #[test]
    fn seed_with_uid1_already_local_is_done() {
        let s = seed(Some(1), 1000, Some(1001));
        assert!(s.done);
        assert_eq!(s.oldest_uid_synced, 1);
    }

    #[test]
    fn seed_without_local_messages_uses_server_uid_next() {
        // まだ一度も同期されていないフォルダ: サーバー最新から遡る
        let s = seed(None, 3000, Some(3001));
        assert_eq!(
            s,
            BackfillState {
                oldest_uid_synced: 3001,
                done: false
            }
        );
        assert_eq!(next_chunk_range(s), Some((2501, 3000)));
    }

    #[test]
    fn seed_without_uid_next_gives_up_safely() {
        let s = seed(None, 100, None);
        assert!(s.done);
    }

    #[test]
    fn next_chunk_range_steps_backwards_by_chunk_size() {
        let s = BackfillState {
            oldest_uid_synced: 801,
            done: false,
        };
        assert_eq!(next_chunk_range(s), Some((301, 800)));
    }

    #[test]
    fn next_chunk_range_clamps_at_uid_1() {
        let s = BackfillState {
            oldest_uid_synced: 300,
            done: false,
        };
        assert_eq!(next_chunk_range(s), Some((1, 299)));

        let s = BackfillState {
            oldest_uid_synced: 2,
            done: false,
        };
        assert_eq!(next_chunk_range(s), Some((1, 1)));
    }

    #[test]
    fn next_chunk_range_is_none_when_done_or_unstarted() {
        assert_eq!(next_chunk_range(BackfillState::not_started()), None);
        assert_eq!(
            next_chunk_range(BackfillState {
                oldest_uid_synced: 100,
                done: true
            }),
            None
        );
        assert_eq!(
            next_chunk_range(BackfillState {
                oldest_uid_synced: 1,
                done: false
            }),
            None
        );
    }

    #[test]
    fn advance_moves_oldest_to_fetched_min() {
        let s = BackfillState {
            oldest_uid_synced: 801,
            done: false,
        };
        let s2 = advance(s, Some(301));
        assert_eq!(
            s2,
            BackfillState {
                oldest_uid_synced: 301,
                done: false
            }
        );
    }

    #[test]
    fn advance_empty_response_completes() {
        let s = BackfillState {
            oldest_uid_synced: 801,
            done: false,
        };
        let s2 = advance(s, None);
        assert!(s2.done);
        // oldest は保持する(再シードを防ぐ)
        assert_eq!(s2.oldest_uid_synced, 801);
    }

    #[test]
    fn advance_reaching_uid1_completes() {
        let s = BackfillState {
            oldest_uid_synced: 300,
            done: false,
        };
        let s2 = advance(s, Some(1));
        assert!(s2.done);
        assert_eq!(s2.oldest_uid_synced, 1);
    }

    #[test]
    fn advance_never_moves_backwards() {
        // 範囲外の UID が返ってきた場合は進捗を更新せず完了扱い
        let s = BackfillState {
            oldest_uid_synced: 100,
            done: false,
        };
        let s2 = advance(s, Some(500));
        assert!(s2.done);
        assert_eq!(s2.oldest_uid_synced, 100);
    }

    #[test]
    fn full_walk_covers_every_uid_exactly_once() {
        // UID 1..=1000 のフォルダで、ローカルは最新200件(801..=1000)を
        // 持つ状態からチャンク取得を繰り返すシミュレーション。
        // サーバーには UID 1..=1000 が存在する(一部欠番 555 を含む)。
        let server: Vec<u32> = (1..=1000u32).filter(|u| *u != 555).collect();

        let mut state = seed(Some(801), server.len() as u32, Some(1001));
        let mut covered: Vec<u32> = (801..=1000u32).collect();
        let mut cycles = 0;

        while let Some((low, high)) = next_chunk_range(state) {
            cycles += 1;
            assert!(cycles < 10, "チャンク数が見積もりを超えた(ループの疑い)");
            assert_eq!(high, state.oldest_uid_synced - 1, "範囲が既取得分と重なる");
            let fetched: Vec<u32> = server
                .iter()
                .copied()
                .filter(|u| *u >= low && *u <= high)
                .collect();
            let fetched_min = fetched.iter().copied().min();
            covered.extend(fetched);
            state = advance(state, fetched_min);
        }

        assert!(state.done);
        assert_eq!(cycles, 2); // (301..800) と (1..300)
        covered.sort_unstable();
        // 欠番 555 以外の全 UID を過不足なく取得できている
        assert_eq!(covered, server);
    }

    #[test]
    fn deleted_tail_range_terminates_via_empty_response() {
        // 過去方向の範囲がサーバー側で全削除されていた場合、
        // 空応答で完了となり無限ループしない。
        let mut state = BackfillState {
            oldest_uid_synced: 801,
            done: false,
        };
        let (low, high) = next_chunk_range(state).unwrap();
        assert_eq!((low, high), (301, 800));
        state = advance(state, None); // 空応答
        assert!(state.done);
        assert_eq!(next_chunk_range(state), None);
    }
}
