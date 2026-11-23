#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // WebKitGTK disables native HLS by default. Wave can use it when MSE is unavailable.
        if std::env::var_os("WEBKIT_GST_ENABLE_HLS_SUPPORT").is_none() {
            std::env::set_var("WEBKIT_GST_ENABLE_HLS_SUPPORT", "1");
        }
    }

    wave_lib::run()
}
