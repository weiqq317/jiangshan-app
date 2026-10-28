// Windows 发布构建时隐藏控制台黑框
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jiangshan_map_lib::run();
}
