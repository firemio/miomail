fn main() {
    println!("cargo:rustc-env=MIOMAIL_BUILD_ID=20260629-120430");
    println!("cargo:rustc-env=MIOMAIL_COMMIT=7baa092");
    tauri_build::build()
}
