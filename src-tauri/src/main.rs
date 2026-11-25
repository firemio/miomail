#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{IpAddr, Ipv4Addr};

const HELP: &str = "MioMail

使い方:
  miomail                 画面を開く(ふつうの使い方)
  miomail --serve         画面をブラウザーから開けるようにする

--serve のときに使えるもの:
  --port <番号>           待ち受けるポート(既定: 7272)
  --host <アドレス>       待ち受けるアドレス(既定: 127.0.0.1 — この機械の中だけ)
  --token <合言葉>        URL に付ける合言葉(既定: 起動のたびに作る)
  --no-token              合言葉を求めない(この機械の中だけに見せるとき)
  --single-file           `/` でも1ファイル完結の画面を返す
                          (Muse のスペースのような、外部ファイルを取りに
                           行けない枠に埋め込むとき)

環境変数:
  MIOMAIL_DB              データベースの場所を指定する
  MIOMAIL_WEB_TOKEN       --token と同じ
";

fn main() {
    // 画面一式を埋め込むマクロなので、呼ぶのはここ一箇所だけ。
    let context = tauri::generate_context!();

    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{HELP}");
        return;
    }
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("MioMail {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    if args.iter().any(|a| a == "--serve") {
        attach_parent_console();
        match parse_serve_options(&args) {
            Ok(options) => {
                if let Err(error) = miomail_lib::web::run(context, options) {
                    eprintln!("miomail --serve: {error}");
                    std::process::exit(1);
                }
            }
            Err(error) => {
                eprintln!("miomail --serve: {error}");
                eprintln!();
                eprintln!("{HELP}");
                std::process::exit(2);
            }
        }
        return;
    }

    miomail_lib::run_with_context(context);
}

/// Windows の release ビルドは GUI サブシステムなので、そのままでは
/// println! が どこにも出ない。--serve のときだけ呼び出し元のコンソールへ繋ぐ。
#[cfg(windows)]
fn attach_parent_console() {
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
    }
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
fn attach_parent_console() {}

fn parse_serve_options(args: &[String]) -> Result<miomail_lib::web::ServeOptions, String> {
    let mut host = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let mut port = 7272u16;
    let mut token = std::env::var("MIOMAIL_WEB_TOKEN").ok().filter(|t| !t.is_empty());
    let mut single_file = false;
    let mut require_token = true;

    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--serve" => {}
            "--port" => {
                index += 1;
                let raw = args.get(index).ok_or("--port には番号が要ります")?;
                port = raw
                    .parse()
                    .map_err(|_| format!("ポート番号として読めません: {raw}"))?;
            }
            "--host" => {
                index += 1;
                let raw = args.get(index).ok_or("--host にはアドレスが要ります")?;
                host = raw
                    .parse()
                    .map_err(|_| format!("アドレスとして読めません: {raw}"))?;
            }
            "--token" => {
                index += 1;
                let raw = args.get(index).ok_or("--token には合言葉が要ります")?;
                token = Some(raw.clone());
            }
            "--no-token" => require_token = false,
            "--single-file" => single_file = true,
            other => return Err(format!("知らないオプションです: {other}")),
        }
        index += 1;
    }

    if !require_token && !host.is_loopback() {
        return Err(
            "--no-token は 127.0.0.1 で待ち受けるときだけ使えます(他からも丸見えになるため)"
                .to_string(),
        );
    }

    Ok(miomail_lib::web::ServeOptions {
        host,
        port,
        token,
        single_file,
        require_token,
    })
}
