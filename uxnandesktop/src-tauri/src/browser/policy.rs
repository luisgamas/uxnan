//! What an agent may do in a browser page without asking the person.
//!
//! Two questions decide it, both pure so they are tested here:
//!
//! 1. **Where** — a page on this machine (loopback: the agent's own dev server,
//!    an SSH-forwarded port) or a site outside it.
//! 2. **How risky** — reading the page, or an action: low (scrolling, keys that
//!    only move focus), medium (following a link, pressing an ordinary button,
//!    typing into an ordinary field) or high (submitting a form, anything whose
//!    name says it deletes, pays, publishes, signs in…).
//!
//! | | reads | low / medium actions | high actions |
//! |---|---|---|---|
//! | this machine | allowed | allowed | the person approves each one |
//! | another site, not allowed in Settings | refused | refused | refused |
//! | another site, allowed in Settings | the person approves the site once | the person approves the site once | the person approves each one |
//!
//! Typing into a password or file field is refused everywhere, always: the app
//! never lets an agent handle a credential or a file on the person's behalf.
//! The classification is a heuristic over what the page says an element is — a
//! page can lie about its own buttons — which is why the high-risk side is
//! generous and a site outside the machine is off until the person turns it on.

use serde::Serialize;

/// How risky an action is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Risk {
    Low,
    Medium,
    High,
}

/// What the page says the target element is (from `page.js` `describe`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Target {
    pub tag: String,
    pub role: String,
    pub input_type: String,
    pub name: String,
    pub is_submit: bool,
}

impl Target {
    /// Read the fields the policy needs from a `describe` answer.
    pub fn from_describe(v: &serde_json::Value) -> Self {
        let s = |k: &str| {
            v.get(k)
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string()
        };
        let b = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
        Target {
            tag: s("tag"),
            role: s("role"),
            input_type: s("type"),
            name: s("name"),
            is_submit: b("isSubmit"),
        }
    }
}

/// An action on a page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Scroll,
    Click(Target),
    Type(Target),
    /// A key. `submits`: it would submit a form (Enter in a form field);
    /// `activates`: it would click the focused element.
    Press {
        key: String,
        submits: bool,
        activates: Option<Target>,
    },
}

/// Words in an element's name that mark an action the person should see first.
/// English and Spanish, lowercase; matched as whole words or word prefixes.
const SENSITIVE: [&str; 44] = [
    "delete",
    "remove",
    "destroy",
    "drop",
    "erase",
    "wipe",
    "pay",
    "purchase",
    "buy",
    "checkout",
    "order",
    "subscribe",
    "unsubscribe",
    "publish",
    "deploy",
    "release",
    "send",
    "transfer",
    "confirm",
    "sign in",
    "log in",
    "login",
    "sign up",
    "register",
    "reset",
    "revoke",
    "grant",
    "authorize",
    "approve",
    "merge",
    "eliminar",
    "borrar",
    "pagar",
    "comprar",
    "enviar",
    "publicar",
    "confirmar",
    "iniciar sesión",
    "registrar",
    "suscribir",
    "transferir",
    "aprobar",
    "desplegar",
    "autorizar",
];

/// Whether an element's accessible name reads as a sensitive action.
fn sensitive_name(name: &str) -> bool {
    let name = name.to_lowercase();
    SENSITIVE.iter().any(|word| {
        name.match_indices(word).any(|(at, _)| {
            let before = name[..at].chars().next_back();
            before.is_none_or(|c| !c.is_alphanumeric())
        })
    })
}

/// Why an action is refused outright.
pub const REFUSE_SECRET: &str =
    "an agent never types into a password or file field — ask the person to do it";

/// How risky `action` is, or why it may never run.
pub fn classify(action: &Action) -> Result<Risk, &'static str> {
    match action {
        Action::Scroll => Ok(Risk::Low),
        Action::Type(t) => {
            if t.tag == "input" && matches!(t.input_type.as_str(), "password" | "file") {
                return Err(REFUSE_SECRET);
            }
            Ok(Risk::Medium)
        }
        Action::Click(t) => Ok(click_risk(t)),
        Action::Press {
            submits,
            activates,
            key,
        } => {
            if *submits {
                Ok(Risk::High)
            } else if let Some(t) = activates {
                Ok(click_risk(t))
            } else if key == "Enter" || key == "Space" {
                Ok(Risk::Medium)
            } else {
                Ok(Risk::Low)
            }
        }
    }
}

fn click_risk(t: &Target) -> Risk {
    if t.is_submit || sensitive_name(&t.name) {
        return Risk::High;
    }
    match t.role.as_str() {
        "checkbox" | "radio" | "switch" | "tab" | "option" | "treeitem" | "menuitemcheckbox"
        | "menuitemradio" => Risk::Low,
        _ if t.tag == "summary" => Risk::Low,
        _ => Risk::Medium,
    }
}

/// Where a page is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    /// This machine: a loopback address, or the empty page.
    Local,
    /// Somewhere else; the host, which approvals are scoped to.
    External(String),
}

/// Where the page at `url` is.
pub fn origin_of(url: &str) -> Origin {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return Origin::External(String::new());
    };
    if parsed.scheme() == "about" {
        return Origin::Local;
    }
    let host = parsed
        .host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    let local = match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback() || ip.is_unspecified(),
        Err(_) => host == "localhost" || host.ends_with(".localhost"),
    };
    if local {
        Origin::Local
    } else {
        Origin::External(host)
    }
}

/// What a request needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    /// The person approves this one action.
    AskOnce,
    /// The person approves the site for this page's session (reads and
    /// low/medium actions there stop asking).
    AskSite,
    Refuse(&'static str),
}

/// Why an outside site is refused.
pub const REFUSE_EXTERNAL: &str = "this page is on a site outside this machine, and agents may only read and act on local pages (their dev servers) — the person can allow other sites in Settings → Browser";

/// The decision for a read (`risk = None`) or an action of `risk` on a page
/// at `origin`. `external` is the Settings switch for sites outside the
/// machine; `site_approved` whether the person already approved this site for
/// the page's session.
pub fn decide(
    origin: &Origin,
    risk: Option<Risk>,
    external: bool,
    site_approved: bool,
) -> Decision {
    match (origin, risk) {
        (Origin::Local, None | Some(Risk::Low | Risk::Medium)) => Decision::Allow,
        (Origin::Local, Some(Risk::High)) => Decision::AskOnce,
        (Origin::External(_), _) if !external => Decision::Refuse(REFUSE_EXTERNAL),
        (Origin::External(_), Some(Risk::High)) => Decision::AskOnce,
        (Origin::External(_), _) if site_approved => Decision::Allow,
        (Origin::External(_), _) => Decision::AskSite,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn button(name: &str) -> Target {
        Target {
            tag: "button".into(),
            role: "button".into(),
            input_type: "button".into(),
            name: name.into(),
            ..Default::default()
        }
    }

    #[test]
    fn secrets_are_never_typed() {
        for ty in ["password", "file"] {
            let t = Target {
                tag: "input".into(),
                input_type: ty.into(),
                ..Default::default()
            };
            assert_eq!(classify(&Action::Type(t)), Err(REFUSE_SECRET));
        }
        let text = Target {
            tag: "input".into(),
            input_type: "email".into(),
            ..Default::default()
        };
        assert_eq!(classify(&Action::Type(text)), Ok(Risk::Medium));
    }

    #[test]
    fn submits_and_sensitive_names_are_high() {
        let mut submit = button("Save");
        submit.is_submit = true;
        assert_eq!(classify(&Action::Click(submit)), Ok(Risk::High));
        for name in [
            "Delete account",
            "Pay now",
            "Sign in",
            "Publicar",
            "Iniciar sesión",
            "deploy",
        ] {
            assert_eq!(
                classify(&Action::Click(button(name))),
                Ok(Risk::High),
                "{name}"
            );
        }
        // A word inside another word is not a match.
        assert_eq!(classify(&Action::Click(button("Dropdown"))), Ok(Risk::High));
        assert_eq!(
            classify(&Action::Click(button("Undelete"))),
            Ok(Risk::Medium)
        );
        assert_eq!(
            classify(&Action::Click(button("Open menu"))),
            Ok(Risk::Medium)
        );
    }

    #[test]
    fn an_ordinary_button_in_a_login_form_is_not_a_submit() {
        // `type="button"` beside a password field: medium, like any button.
        assert_eq!(
            classify(&Action::Click(button("Show password"))),
            Ok(Risk::Medium)
        );
    }

    #[test]
    fn local_toggles_are_low() {
        let checkbox = Target {
            tag: "input".into(),
            role: "checkbox".into(),
            ..Default::default()
        };
        assert_eq!(classify(&Action::Click(checkbox)), Ok(Risk::Low));
        assert_eq!(classify(&Action::Scroll), Ok(Risk::Low));
    }

    #[test]
    fn keys_take_the_risk_of_what_they_do() {
        let press = |key: &str, submits, activates| Action::Press {
            key: key.into(),
            submits,
            activates,
        };
        assert_eq!(classify(&press("Tab", false, None)), Ok(Risk::Low));
        assert_eq!(classify(&press("Enter", true, None)), Ok(Risk::High));
        assert_eq!(
            classify(&press("Enter", false, Some(button("Delete")))),
            Ok(Risk::High)
        );
        assert_eq!(classify(&press("Enter", false, None)), Ok(Risk::Medium));
    }

    #[test]
    fn loopback_is_local() {
        for url in [
            "http://localhost:5173/",
            "http://app.localhost:3000",
            "http://127.0.0.1:8080",
            "http://127.1.2.3",
            "http://[::1]:4000/x",
            "http://0.0.0.0:3000",
            "about:blank",
        ] {
            assert_eq!(origin_of(url), Origin::Local, "{url}");
        }
        assert_eq!(
            origin_of("https://Example.com/login"),
            Origin::External("example.com".into())
        );
        assert_eq!(
            origin_of("http://localhost.evil.com"),
            Origin::External("localhost.evil.com".into())
        );
        assert_eq!(
            origin_of("http://192.168.1.10:3000"),
            Origin::External("192.168.1.10".into())
        );
    }

    #[test]
    fn the_decision_table() {
        let ext = Origin::External("example.com".into());
        assert_eq!(decide(&Origin::Local, None, false, false), Decision::Allow);
        assert_eq!(
            decide(&Origin::Local, Some(Risk::Medium), false, false),
            Decision::Allow
        );
        assert_eq!(
            decide(&Origin::Local, Some(Risk::High), true, true),
            Decision::AskOnce
        );
        assert_eq!(
            decide(&ext, None, false, true),
            Decision::Refuse(REFUSE_EXTERNAL)
        );
        assert_eq!(
            decide(&ext, Some(Risk::Low), false, true),
            Decision::Refuse(REFUSE_EXTERNAL)
        );
        assert_eq!(decide(&ext, None, true, false), Decision::AskSite);
        assert_eq!(
            decide(&ext, Some(Risk::Medium), true, true),
            Decision::Allow
        );
        assert_eq!(
            decide(&ext, Some(Risk::High), true, true),
            Decision::AskOnce
        );
    }
}
