//! A project's files on this host, for the app's file tree, editor and search —
//! the workspace engine's own `fs`, the code the app runs on its own disk, so
//! a project here lists, saves and searches exactly as one there.
//!
//! One difference, on purpose: deleting is for good, since a host has no trash
//! the app could move a file to (the app's dialog says so).

use serde::Serialize;
use uxnan_host_protocol::{ErrorCode, FsCall, Outcome, Reply};
use uxnan_workspace_engine::fs;
use uxnan_workspace_engine::Error;

/// Answer one `Fs` call.
pub async fn serve(call: FsCall) -> Outcome {
    match run(call).await {
        Ok(value) => Outcome::Ok {
            reply: Reply::Value { value },
        },
        Err(e) => Outcome::Error {
            code: match e {
                Error::NotFound(_) => ErrorCode::NotFound,
                _ => ErrorCode::Invalid,
            },
            message: e.to_string(),
        },
    }
}

fn value<T: Serialize>(answer: T) -> Result<serde_json::Value, Error> {
    serde_json::to_value(answer).map_err(Error::from)
}

fn parsed<T: serde::de::DeserializeOwned>(raw: serde_json::Value) -> Result<T, Error> {
    serde_json::from_value(raw).map_err(Error::from)
}

async fn run(call: FsCall) -> Result<serde_json::Value, Error> {
    match call {
        FsCall::List { path } => value(fs::list_dir(&path).await?),
        FsCall::Read { path } => value(fs::read_file(&path).await?),
        FsCall::ReadDataUrl { path } => value(fs::read_data_url(&path).await?),
        FsCall::Write { path, content } => value(fs::write_file(&path, &content).await?),
        FsCall::CreateFile { dir, path } => value(fs::create_file(&dir, &path).await?),
        FsCall::CreateDir { dir, path } => value(fs::create_dir(&dir, &path).await?),
        FsCall::Rename { path, new_name } => value(fs::rename_path(&path, &new_name).await?),
        FsCall::Delete { path } => value(fs::delete_permanently(&path).await?),
        FsCall::Duplicate { path } => value(fs::duplicate_file(&path).await?),
        // A walk of the whole tree: off the connection's thread.
        FsCall::SearchFiles {
            root,
            query,
            include_hidden,
            filters,
            limit,
        } => {
            let filters: fs::SearchFilters = parsed(filters)?;
            let found = tokio::task::spawn_blocking(move || {
                fs::search_files(&root, &query, include_hidden, &filters, limit)
            })
            .await
            .map_err(|e| Error::Invalid(e.to_string()))?;
            value(found)
        }
        FsCall::SearchContent {
            root,
            query,
            include_hidden,
            filters,
            limit,
        } => {
            let filters: fs::SearchFilters = parsed(filters)?;
            let query: fs::ContentQuery = parsed(query)?;
            let found = tokio::task::spawn_blocking(move || {
                fs::search_content(&root, &query, include_hidden, &filters, limit)
            })
            .await
            .map_err(|e| Error::Invalid(e.to_string()))??;
            value(found)
        }
    }
}
