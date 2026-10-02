//! The screen a terminal shows, kept so it can be shown again.
//!
//! A terminal whose viewer went away — a closed app, a dropped connection —
//! keeps running, and its program keeps drawing. When a viewer comes back it
//! needs **what is on the screen now**, not the bytes that produced it: a raw
//! replay can start in the middle of an escape sequence and paints a full-screen
//! program as garbage. So every byte the terminal emits is also fed to a terminal
//! model here, and a returning viewer is sent a [`Screen::snapshot`] — the escape
//! sequences that reproduce the current screen, cursor and input modes on a
//! fresh terminal of the same size.
//!
//! What it does not carry is the scrollback *above* the screen: a viewer that
//! stayed in this app session still has its own; one that starts fresh sees the
//! screen as it is now, which is what a program like an agent's interface needs.

/// Lines of history the model keeps above the screen. The model is a cost paid
/// for every terminal, viewed or not, so it is kept modest.
pub const SCROLLBACK_LINES: usize = 2_000;

pub struct Screen {
    parser: vt100::Parser,
}

impl Screen {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows.max(1), cols.max(1), SCROLLBACK_LINES),
        }
    }

    /// Take in what the terminal just emitted.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.screen_mut().set_size(rows.max(1), cols.max(1));
    }

    pub fn size(&self) -> (u16, u16) {
        self.parser.screen().size()
    }

    /// The escape sequences that turn a fresh terminal of this size into what
    /// this one shows now: the right buffer (a full-screen program draws on the
    /// alternate one), the contents with their colours, the cursor, and the
    /// input modes the program asked for (bracketed paste, application keys,
    /// mouse reporting).
    pub fn snapshot(&self) -> Vec<u8> {
        let screen = self.parser.screen();
        let mut out = Vec::new();
        // Leave or enter the alternate buffer first, so the contents land on
        // the buffer the program is actually drawing on.
        if screen.alternate_screen() {
            out.extend_from_slice(b"\x1b[?1049h");
        } else {
            out.extend_from_slice(b"\x1b[?1049l");
        }
        out.extend_from_slice(b"\x1b[H\x1b[2J");
        out.extend_from_slice(&screen.state_formatted());
        out
    }

    /// The text on the screen, for tests and for diagnostics.
    pub fn text(&self) -> String {
        self.parser.screen().contents()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn replay(snapshot: &[u8], rows: u16, cols: u16) -> Screen {
        let mut fresh = Screen::new(rows, cols);
        fresh.feed(snapshot);
        fresh
    }

    #[test]
    fn a_snapshot_reproduces_the_screen_on_a_fresh_terminal() {
        let mut screen = Screen::new(5, 20);
        screen.feed(b"\x1b[31mred\x1b[0m line one\r\nline two\r\n$ ");
        let copy = replay(&screen.snapshot(), 5, 20);
        assert_eq!(copy.text(), screen.text());
        assert_eq!(
            copy.parser.screen().cursor_position(),
            screen.parser.screen().cursor_position(),
            "the cursor comes back where it was"
        );
        assert_eq!(
            copy.parser.screen().cell(0, 0).unwrap().fgcolor(),
            vt100::Color::Idx(1),
            "colours come back too"
        );
    }

    #[test]
    fn a_full_screen_program_is_restored_on_its_own_buffer() {
        // An agent's interface draws on the alternate screen; the snapshot must
        // put the viewer there, or the program's next redraw lands on top of
        // the shell's history.
        let mut screen = Screen::new(4, 30);
        screen.feed(b"shell history\r\n");
        screen.feed(b"\x1b[?1049h\x1b[H\x1b[2J  agent is thinking...");
        let copy = replay(&screen.snapshot(), 4, 30);
        assert!(copy.parser.screen().alternate_screen());
        assert!(copy.text().contains("agent is thinking"));
        assert!(!copy.text().contains("shell history"));
    }

    #[test]
    fn input_modes_the_program_asked_for_come_back() {
        let mut screen = Screen::new(4, 30);
        screen.feed(b"\x1b[?2004h"); // bracketed paste
        let copy = replay(&screen.snapshot(), 4, 30);
        assert!(copy.parser.screen().bracketed_paste());
    }

    #[test]
    fn resizing_follows_the_terminal() {
        let mut screen = Screen::new(4, 30);
        screen.resize(10, 80);
        assert_eq!(screen.size(), (10, 80));
        // A zero size (a hidden pane) is clamped rather than breaking the model.
        screen.resize(0, 0);
        assert_eq!(screen.size(), (1, 1));
    }
}
