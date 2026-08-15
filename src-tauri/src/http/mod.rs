pub mod bridge;
pub mod server;

/// Единый HTTP-клиент с таймаутами (используется во всех местах сети:
/// tools, lastfm, http_fetch_*, vk_search). GitHub переадресует загрузки
/// на S3 — редиректы включены по умолчанию.
pub fn client() -> &'static reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(600))
            .user_agent(concat!("wave/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("failed to build shared http client")
    })
}
