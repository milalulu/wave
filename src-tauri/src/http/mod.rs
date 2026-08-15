pub mod bridge;
pub mod server;

use std::net::IpAddr;

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

/// Разрешённые адреса для http_fetch_*: публичные, приватные (LAN-музыка)
/// и unique-local. Запрещены loopback, link-local (включая метаданные
/// облака 169.254.169.254), unspecified, multicast, broadcast и
/// test-диапазоны — защита от SSRF. Приватные диапазоны разрешены
/// намеренно: локальные серверы музыки/радио — легитимный сценарий.
fn ip_allowed(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(v4) => {
            !(v4.is_unspecified()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_documentation())
        }
        IpAddr::V6(v6) => {
            !(v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || v6.is_unicast_link_local())
        }
    }
}

/// Валидация URL перед запросом из renderer'а: только http(s) и хосты,
/// резолвящиеся в разрешённые адреса.
pub async fn validate_http_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("scheme not allowed: {scheme}"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("no host: {url}"))?
        .to_string();
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !ip_allowed(ip) {
            return Err(format!("blocked address: {host}"));
        }
        return Ok(parsed);
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    let mut addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| format!("resolve {host}: {e}"))?;
    let mut any = false;
    for addr in addrs.by_ref() {
        any = true;
        if !ip_allowed(addr.ip()) {
            return Err(format!("blocked address for {host}: {}", addr.ip()));
        }
    }
    if !any {
        return Err(format!("no addresses for {host}"));
    }
    Ok(parsed)
}

/// URL без query/fragment для сообщений об ошибках — не светим токены
/// (client_id/подписанные ссылки) в логах.
pub fn redact_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(u) => {
            let mut out = format!("{}://{}", u.scheme(), u.host_str().unwrap_or(""));
            if let Some(p) = u.port() {
                out.push_str(&format!(":{p}"));
            }
            out.push_str(u.path());
            out
        }
        Err(_) => url.chars().take(80).collect(),
    }
}
