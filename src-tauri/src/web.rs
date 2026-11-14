//! Network helpers (spec 007): opt-in grammar check (LanguageTool) and, later, DOI lookup.
//! Nothing here runs unless the user asked for it; responses are size-capped and parsed defensively.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const MAX_GRAMMAR_REQUEST: usize = 20 * 1024;
const MAX_RESPONSE: u64 = 1024 * 1024;

/// One HTTPS agent per request: Windows' certificate store, explicit timeouts (as in setup.rs).
fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_global(Some(timeout))
        .http_status_as_error(true)
        .build()
        .new_agent()
}

fn host_of(url: &str) -> &str {
    url.split("://").nth(1).and_then(|rest| rest.split('/').next()).unwrap_or(url)
}

/// LanguageTool "annotated text" parts (research R5).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum AnnotatedPart {
    Text { text: String },
    Markup {
        markup: String,
        #[serde(rename = "interpretAs", skip_serializing_if = "Option::is_none")]
        interpret_as: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrammarIssue {
    pub offset: usize,
    pub length: usize,
    pub message: String,
    pub replacements: Vec<String>,
    pub rule: String,
}

#[derive(Deserialize)]
struct LtResponse {
    #[serde(default)]
    matches: Vec<LtMatch>,
}

#[derive(Deserialize)]
struct LtMatch {
    offset: usize,
    length: usize,
    #[serde(default)]
    message: String,
    #[serde(default)]
    replacements: Vec<LtReplacement>,
    rule: Option<LtRule>,
}

#[derive(Deserialize)]
struct LtReplacement {
    value: String,
}

#[derive(Deserialize)]
struct LtRule {
    id: String,
}

/// POST the annotated text to `<server>/v2/check` and map the matches (no https check: the command does it).
pub fn grammar_request(server: &str, lang: &str, parts: &[AnnotatedPart], timeout: Duration) -> Result<Vec<GrammarIssue>, String> {
    let data = serde_json::to_string(&serde_json::json!({ "annotation": parts })).map_err(|error| error.to_string())?;
    if data.len() > MAX_GRAMMAR_REQUEST {
        return Err("This file is too long for one grammar check (20 KB). Check a shorter part.".into());
    }
    let url = format!("{}/v2/check", server.trim_end_matches('/'));
    let language = if lang.is_empty() { "auto" } else { lang };
    let mut response = agent(timeout).post(&url).send_form([("language", language), ("data", data.as_str())]).map_err(|error| match error {
        ureq::Error::StatusCode(code) => format!("{} answered HTTP {code}.", host_of(&url)),
        other => format!("Could not reach {}. ({other})", host_of(&url)),
    })?;
    let text = response
        .body_mut()
        .with_config()
        .limit(MAX_RESPONSE)
        .read_to_string()
        .map_err(|error| format!("Could not read the answer from {}: {error}", host_of(&url)))?;
    let parsed: LtResponse = serde_json::from_str(&text).map_err(|_| format!("{} sent an answer Lexy can't read.", host_of(&url)))?;
    Ok(parsed
        .matches
        .into_iter()
        .map(|m| GrammarIssue {
            offset: m.offset,
            length: m.length,
            message: m.message.chars().take(500).collect(),
            replacements: m.replacements.into_iter().take(5).map(|r| r.value).collect(),
            rule: m.rule.map(|r| r.id).unwrap_or_default(),
        })
        .collect())
}

const MAX_BIBTEX: u64 = 64 * 1024;
const DOI_FAILED: &str = "Could not fetch this DOI";

/// `10.1000/xyz` from a bare DOI, `doi:…` or a `https://doi.org/…` link; None if it isn't a DOI.
pub fn normalize_doi(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let lower = trimmed.to_ascii_lowercase();
    let rest = ["https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"]
        .iter()
        .find(|prefix| lower.starts_with(*prefix))
        .map_or(trimmed, |prefix| trimmed[prefix.len()..].trim());
    let (prefix, suffix) = rest.split_once('/')?;
    let valid = prefix.starts_with("10.") && prefix.len() > 3 && prefix[3..].chars().all(|c| c.is_ascii_digit() || c == '.') && !suffix.is_empty() && !rest.chars().any(char::is_whitespace);
    valid.then(|| rest.to_string())
}

/// Percent-encode everything but unreserved characters and `/`, so the DOI stays one path.
fn encode_path(doi: &str) -> String {
    doi.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// BibTeX for `doi` from `<base>/<doi>` via content negotiation (doi.org follows the redirect).
pub fn doi_request(base: &str, doi: &str, timeout: Duration) -> Result<String, String> {
    let doi = normalize_doi(doi).ok_or_else(|| format!("{DOI_FAILED}: that is not a DOI (they start with 10.)"))?;
    let url = format!("{}/{}", base.trim_end_matches('/'), encode_path(&doi));
    let mut response = agent(timeout).get(&url).header("Accept", "application/x-bibtex; charset=utf-8").call().map_err(|error| match error {
        ureq::Error::StatusCode(404) => format!("{DOI_FAILED}: doi.org doesn't know it."),
        ureq::Error::StatusCode(code) => format!("{DOI_FAILED}: {} answered HTTP {code}.", host_of(&url)),
        _ => format!("{DOI_FAILED}. Check your internet connection."),
    })?;
    let text = response.body_mut().with_config().limit(MAX_BIBTEX).read_to_string().map_err(|_| DOI_FAILED.to_string())?;
    let text = text.trim();
    if !text.starts_with('@') {
        return Err(format!("{DOI_FAILED}: the answer wasn't BibTeX."));
    }
    Ok(text.to_string())
}

/// Sends only the DOI to doi.org (FR-024).
#[tauri::command]
pub async fn fetch_doi(doi: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || doi_request("https://doi.org", &doi, Duration::from_secs(10)))
        .await
        .map_err(|error| format!("DOI lookup failed: {error}"))?
}

#[tauri::command]
pub async fn grammar_check(server: String, lang: String, annotated: Vec<AnnotatedPart>) -> Result<Vec<GrammarIssue>, String> {
    if !crate::settings::load_at(&crate::settings::settings_dir()?).grammar_check {
        return Err("Grammar check is off".into());
    }
    if !server.starts_with("https://") {
        return Err("The grammar server must use https://".into());
    }
    tauri::async_runtime::spawn_blocking(move || grammar_request(&server, &lang, &annotated, Duration::from_secs(15)))
        .await
        .map_err(|error| format!("grammar check failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    /// One-shot local HTTP server; sends the raw request text back through the channel.
    fn serve(status: &'static str, body: String, delay: Duration) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            if let Some(Ok(mut stream)) = listener.incoming().next() {
                // Read the headers and the whole body before answering, or the client sees a reset.
                let mut request = Vec::new();
                let mut chunk = [0u8; 8192];
                loop {
                    let Ok(read) = stream.read(&mut chunk) else { break };
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    let text = String::from_utf8_lossy(&request).to_string();
                    if let Some(head_end) = text.find("\r\n\r\n") {
                        let length = text[..head_end]
                            .lines()
                            .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if request.len() >= head_end + 4 + length {
                            break;
                        }
                    }
                }
                let _ = tx.send(String::from_utf8_lossy(&request).to_string());
                thread::sleep(delay);
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        (format!("http://{address}"), rx)
    }

    fn parts() -> Vec<AnnotatedPart> {
        vec![
            AnnotatedPart::Text { text: "This are wrong ".into() },
            AnnotatedPart::Markup { markup: "$x$".into(), interpret_as: Some("x".into()) },
        ]
    }

    #[test]
    fn grammar_request_sends_annotated_text_and_maps_matches() {
        let body = r#"{"matches":[{"offset":5,"length":3,"message":"Use \"is\".","replacements":[{"value":"is"},{"value":"was"}],"rule":{"id":"AGREEMENT"}}]}"#;
        let (server, request) = serve("200 OK", body.into(), Duration::ZERO);
        let issues = grammar_request(&server, "en-US", &parts(), Duration::from_secs(5)).unwrap();
        assert_eq!(issues, [GrammarIssue { offset: 5, length: 3, message: "Use \"is\".".into(), replacements: vec!["is".into(), "was".into()], rule: "AGREEMENT".into() }]);
        let sent = request.recv().unwrap();
        assert!(sent.starts_with("POST /v2/check"), "{sent}");
        assert!(sent.contains("language=en-US"), "{sent}");
        assert!(sent.contains("interpretAs"), "{sent}");
    }

    #[test]
    fn grammar_request_reports_http_errors_bad_bodies_and_timeouts() {
        let (server, _rx) = serve("500 Internal Server Error", "oops".into(), Duration::ZERO);
        assert!(grammar_request(&server, "en-US", &parts(), Duration::from_secs(5)).unwrap_err().contains("HTTP 500"));
        let (server, _rx) = serve("200 OK", "not json".into(), Duration::ZERO);
        assert!(grammar_request(&server, "en-US", &parts(), Duration::from_secs(5)).unwrap_err().contains("can't read"));
        let (server, _rx) = serve("200 OK", "{}".into(), Duration::from_secs(3));
        assert!(grammar_request(&server, "en-US", &parts(), Duration::from_millis(500)).unwrap_err().contains("Could not reach"));
    }

    #[test]
    fn doi_request_asks_for_bibtex_and_checks_the_answer() {
        let (server, request) = serve("200 OK", "  @article{x, title={T}}\n".into(), Duration::ZERO);
        assert_eq!(doi_request(&server, "https://doi.org/10.1038/nphys1170", Duration::from_secs(5)).unwrap(), "@article{x, title={T}}");
        let sent = request.recv().unwrap();
        assert!(sent.starts_with("GET /10.1038/nphys1170 "), "{sent}");
        assert!(sent.to_ascii_lowercase().contains("accept: application/x-bibtex"), "{sent}");

        let (server, _rx) = serve("404 Not Found", "".into(), Duration::ZERO);
        assert!(doi_request(&server, "10.1/none", Duration::from_secs(5)).unwrap_err().contains("doesn't know"));
        let (server, _rx) = serve("200 OK", "<html>".into(), Duration::ZERO);
        assert!(doi_request(&server, "10.1/x", Duration::from_secs(5)).unwrap_err().contains("wasn't BibTeX"));
        assert!(doi_request("http://127.0.0.1:1", "not a doi", Duration::from_secs(1)).unwrap_err().contains("not a DOI"));
    }

    #[test]
    fn dois_are_normalized_and_encoded() {
        assert_eq!(normalize_doi(" doi:10.1000/ABC(1) ").as_deref(), Some("10.1000/ABC(1)"));
        assert_eq!(normalize_doi("https://dx.doi.org/10.5555/x").as_deref(), Some("10.5555/x"));
        assert_eq!(normalize_doi("11.1/x"), None);
        assert_eq!(normalize_doi("10.1/"), None);
        assert_eq!(normalize_doi("10.1/a b"), None);
        assert_eq!(encode_path("10.1000/a<b>#c"), "10.1000/a%3Cb%3E%23c");
    }

    #[test]
    fn grammar_request_refuses_oversized_text() {
        let big = vec![AnnotatedPart::Text { text: "a".repeat(MAX_GRAMMAR_REQUEST) }];
        assert!(grammar_request("http://127.0.0.1:1", "en-US", &big, Duration::from_secs(1)).unwrap_err().contains("too long"));
    }
}
