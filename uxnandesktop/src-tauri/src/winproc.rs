//! Spawning a child that never pops a console window on Windows and carries
//! no inherited terminal identity — the workspace engine's
//! (`uxnan_workspace_engine::winproc`), which its git layer spawns through.

pub use uxnan_workspace_engine::winproc::*;
