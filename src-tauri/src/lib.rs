use serde_json::{json, Map, Value};
use tauri::{Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;

#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

/// 保存前端 window.atlasAPI.inspect() 生成的历史地理考据报告
#[tauri::command]
async fn save_inspection_report(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    // blocking_save_file 不能在主线程调用，放到阻塞线程池执行
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&filename)
            .add_filter("JSON 历史地理元数据", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(path) = picked {
        if let Some(p) = path.as_path() {
            std::fs::write(p, content).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// 把 jiangshan:// Deep Link 翻译为前端可执行的跳转脚本
fn build_navigate_script(url: &Url) -> String {
    let mode = url.host_str().unwrap_or("locate");
    let mut payload = Map::new();

    if mode == "locate" {
        payload.insert("mode".into(), json!("locate"));
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "year" => {
                    if let Ok(year) = value.parse::<i64>() {
                        payload.insert("year".into(), json!(year));
                    }
                }
                "place" => {
                    payload.insert("place".into(), json!(value.to_string()));
                }
                "zoom" => {
                    if let Ok(zoom) = value.parse::<f64>() {
                        payload.insert("zoom".into(), json!(zoom));
                    }
                }
                _ => {}
            }
        }
    } else {
        // 其余形式统一降级为应用内 URL 查询参数
        let query: Vec<String> = url
            .query_pairs()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();
        if query.is_empty() {
            return String::new();
        }
        payload.insert("urlParams".into(), json!(format!("?{}", query.join("&"))));
    }

    format!(
        "window.dispatchEvent(new CustomEvent('tauri://navigate-atlas', {{ detail: {} }}))",
        Value::Object(payload)
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder = builder.plugin(tauri_plugin_haptics::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![save_inspection_report])
        .setup(|app| {
            // 仅在桌面端构建原生顶部菜单栏
            #[cfg(desktop)]
            {
                let era_submenu = SubmenuBuilder::new(app, "时空穿越")
                    .item(
                        &MenuItemBuilder::with_id("era_403bce", "前403年 · 三家分晋（战国开篇）")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::with_id("era_121bce", "前121年 · 汉武帝霍去病开河西")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::with_id("era_208ce", "208年 · 赤壁之战与三国鼎立")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::with_id("era_741ce", "741年 · 盛唐开元与长安沿革")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::with_id("era_1080ce", "1080年 · 苏轼贬谪黄州行迹")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::with_id("era_1415ce", "1415年 · 明永乐两京十三省")
                            .build(app)?,
                    )
                    .separator()
                    .item(
                        &MenuItemBuilder::with_id("mode_quiz", "开启「舆图寻址 · 古地名小试」")
                            .build(app)?,
                    )
                    .build()?;

                let lang_submenu = SubmenuBuilder::new(app, "语言 / Language")
                    .item(&MenuItemBuilder::with_id("lang_zh", "简体中文").build(app)?)
                    .item(&MenuItemBuilder::with_id("lang_zhtw", "繁體中文").build(app)?)
                    .item(&MenuItemBuilder::with_id("lang_en", "English").build(app)?)
                    .build()?;

                let tools_submenu = SubmenuBuilder::new(app, "考据工具")
                    .item(
                        &MenuItemBuilder::with_id("export_inspect", "导出当前地点 2400 年沿革 JSON...")
                            .build(app)?,
                    )
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[&era_submenu, &lang_submenu, &tools_submenu])
                    .build()?;

                app.set_menu(menu)?;

                app.on_menu_event(move |app_handle, event| {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let script = match event.id().as_ref() {
                            "era_403bce" => "window.location.search = '?year=-403'",
                            "era_121bce" => "window.location.search = '?year=-121'",
                            "era_208ce" => "window.location.search = '?year=208&place=赤壁'",
                            "era_741ce" => "window.location.search = '?year=741&place=长安'",
                            "era_1080ce" => "window.location.search = '?person=sushi'",
                            "era_1415ce" => "window.location.search = '?year=1415&place=应天府'",
                            "mode_quiz" => "window.location.search = '?year=-121&quiz=locate'",
                            "lang_zh" => "window.location.search = '?lang=zh'",
                            "lang_zhtw" => "window.location.search = '?lang=zh-tw'",
                            "lang_en" => "window.location.search = '?lang=en'",
                            "export_inspect" => {
                                "window.dispatchEvent(new CustomEvent('tauri://export-current-inspection'))"
                            }
                            _ => "",
                        };
                        if !script.is_empty() {
                            let _ = window.eval(script);
                        }
                    }
                });
            }

            // Deep Link：jiangshan://locate?year=741&place=长安
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(window) = handle.get_webview_window("main") {
                    for url in event.urls() {
                        let script = build_navigate_script(&url);
                        if !script.is_empty() {
                            let _ = window.eval(&script);
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动江山时序 Tauri 应用失败");
}
