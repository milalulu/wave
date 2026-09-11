pub mod bridge;
pub mod server;

use std::net::IpAddr;

/// Режим прокси для обхода региональных блокировок (напр. РФ без VPN):
/// - Off: всегда напрямую.
/// - Always: всё через прокси.
/// - Auto: сначала напрямую, при ошибке — повтор через прокси.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProxyMode {
    Off,
    Auto,
    Always,
}

pub fn parse_proxy_mode(s: &str) -> ProxyMode {
    match s.trim().to_lowercase().as_str() {
        "auto" => ProxyMode::Auto,
        "always" | "on" | "true" | "1" => ProxyMode::Always,
        _ => ProxyMode::Off,
    }
}

#[derive(Clone, Debug)]
pub struct ProxyConf {
    pub url: String,
    pub mode: ProxyMode,
}

/// Проверка URL прокси: http/https/socks5(h) + хост. Возвращает норму.
pub fn validate_proxy_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("empty proxy url".to_string());
    }
    let with_scheme = if url.contains("://") {
        url.to_string()
    } else {
        format!("http://{url}")
    };
    let parsed = reqwest::Url::parse(&with_scheme).map_err(|e| format!("bad proxy url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" | "socks5" | "socks5h" => {}
        other => return Err(format!("proxy scheme not supported: {other}")),
    }
    if parsed.host_str().is_none_or(|h| h.is_empty()) {
        return Err("proxy url has no host".to_string());
    }
    reqwest::Proxy::all(parsed.clone()).map_err(|e| format!("bad proxy: {e}"))?;
    Ok(parsed.to_string())
}

pub fn proxy_conf_from_parts(url: Option<String>, mode: Option<String>) -> Option<ProxyConf> {
    let url = url.filter(|s| !s.trim().is_empty())?;
    let validated = validate_proxy_url(&url).ok()?;
    let mode = mode.map(|m| parse_proxy_mode(&m)).unwrap_or(ProxyMode::Auto);
    if mode == ProxyMode::Off {
        return None;
    }
    Some(ProxyConf { url: validated, mode })
}

fn build_client(proxy: Option<&str>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .user_agent(concat!("wave/", env!("CARGO_PKG_VERSION")));
    if let Some(p) = proxy {
        if let Ok(pr) = reqwest::Proxy::all(p) {
            builder = builder.proxy(pr);
        }
    }
    builder
        .build()
        .expect("failed to build shared http client")
}

use std::sync::RwLock;

static DIRECT_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
static PROXIED_CLIENT: RwLock<Option<&'static reqwest::Client>> = RwLock::new(None);
static PROXY_MODE: RwLock<ProxyMode> = RwLock::new(ProxyMode::Off);

pub fn proxy_mode() -> ProxyMode {
    *PROXY_MODE.read().unwrap_or_else(|e| e.into_inner())
}

/// Прямой доступ к прокси-клиенту (для проверки соединения).
pub fn proxied_client() -> Option<&'static reqwest::Client> {
    *PROXIED_CLIENT.read().unwrap_or_else(|e| e.into_inner())
}

/// Перенастроить прокси (вызывается на старте и после save_app_config).
/// Общий клиент пересоздаётся — все существующие вызовы `client()` подхватят.
pub fn configure_proxy(conf: Option<ProxyConf>) {
    let mut mode = PROXY_MODE.write().unwrap_or_else(|e| e.into_inner());
    let mut proxied = PROXIED_CLIENT.write().unwrap_or_else(|e| e.into_inner());
    match conf {
        Some(c) => {
            *mode = c.mode;
            let client: &'static reqwest::Client = Box::leak(Box::new(build_client(Some(&c.url))));
            *proxied = Some(client);
        }
        None => {
            *mode = ProxyMode::Off;
            *proxied = None;
        }
    }
}

pub fn client() -> &'static reqwest::Client {
    if proxy_mode() == ProxyMode::Always {
        if let Some(p) = *PROXIED_CLIENT.read().unwrap_or_else(|e| e.into_inner()) {
            return p;
        }
    }
    DIRECT_CLIENT.get_or_init(|| build_client(None))
}

/// Отправить запрос: напрямую, а в режиме Auto при ошибке — повторить через прокси.
/// `build` вызывается заново для повтора (RequestBuilder одноразовый).
pub async fn send_auto<F>(build: F) -> Result<reqwest::Response, reqwest::Error>
where
    F: Fn(&reqwest::Client) -> reqwest::RequestBuilder,
{
    let direct = client();
    match build(direct).send().await {
        Ok(resp) => Ok(resp),
        Err(e) => {
            if proxy_mode() != ProxyMode::Auto {
                return Err(e);
            }
            let proxied = *PROXIED_CLIENT.read().unwrap_or_else(|e| e.into_inner());
            match proxied {
                Some(p) => build(p).send().await,
                None => Err(e),
            }
        }
    }
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

#[cfg(test)]
mod proxy_tests {
    use super::*;

    #[test]
    fn proxy_mode_parsing() {
        assert_eq!(parse_proxy_mode("off"), ProxyMode::Off);
        assert_eq!(parse_proxy_mode(""), ProxyMode::Off);
        assert_eq!(parse_proxy_mode("bogus"), ProxyMode::Off);
        assert_eq!(parse_proxy_mode("auto"), ProxyMode::Auto);
        assert_eq!(parse_proxy_mode("AUTO"), ProxyMode::Auto);
        assert_eq!(parse_proxy_mode("always"), ProxyMode::Always);
        assert_eq!(parse_proxy_mode("on"), ProxyMode::Always);
    }

    #[test]
    fn proxy_url_validation() {
        assert!(validate_proxy_url("http://127.0.0.1:8080").is_ok());
        assert!(validate_proxy_url("https://user:pass@proxy.example.com:3128").is_ok());
        assert!(validate_proxy_url("socks5h://127.0.0.1:1080").is_ok());
        assert!(validate_proxy_url("127.0.0.1:8080").is_ok());
        assert!(validate_proxy_url("").is_err());
        assert!(validate_proxy_url("ftp://host:21").is_err());
        assert!(validate_proxy_url("http://").is_err());
    }

    #[test]
    fn proxy_conf_assembly() {
        assert!(proxy_conf_from_parts(None, None).is_none());
        assert!(proxy_conf_from_parts(Some("".to_string()), Some("auto".to_string())).is_none());
        assert!(proxy_conf_from_parts(
            Some("http://127.0.0.1:8080".to_string()),
            Some("off".to_string())
        )
        .is_none());
        let c = proxy_conf_from_parts(
            Some("http://127.0.0.1:8080".to_string()),
            Some("auto".to_string()),
        )
        .expect("conf");
        assert_eq!(c.mode, ProxyMode::Auto);
        // Режим по умолчанию при URL без режима — auto.
        let c2 = proxy_conf_from_parts(Some("http://127.0.0.1:8080".to_string()), None).expect("conf");
        assert_eq!(c2.mode, ProxyMode::Auto);
    }
}
