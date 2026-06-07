#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_window_state::Builder as WindowStateBuilder;

fn main() {
    tauri::Builder::default()
        .plugin(WindowStateBuilder::default().build())
        .run(tauri::generate_context!())
        .expect("Lỗi khi khởi động XMĐ ERP");
}
