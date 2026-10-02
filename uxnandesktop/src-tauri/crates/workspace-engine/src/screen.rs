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
//! The history *above* the screen is carried only when asked: a viewer that
//! stayed in this app session still has its own (sending it again would print
//! it twice), while one that starts fresh — the app restarted — gets it first,
//! so it lands in that viewer's own scrollback, and then the screen.

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
    /// mouse reporting). With `history`, the lines above the screen come first,
    /// with their colours, so they end up in the viewer's scrollback.
    pub fn snapshot(&mut self, history: bool) -> Vec<u8> {
        let mut out = Vec::new();
        let alternate = self.parser.screen().alternate_screen();
        // The history belongs to the main buffer; while a full-screen program
        // holds the alternate one, what is on screen is all there is to show.
        if history && !alternate {
            out.extend_from_slice(b"\x1b[?1049l\x1b[H\x1b[2J");
            self.write_history(&mut out);
        }
        let screen = self.parser.screen();
        // Leave or enter the alternate buffer first, so the contents land on
        // the buffer the program is actually drawing on.
        if alternate {
            out.extend_from_slice(b"\x1b[?1049h");
        } else {
            out.extend_from_slice(b"\x1b[?1049l");
        }
        out.extend_from_slice(b"\x1b[H\x1b[2J");
        out.extend_from_slice(&screen.state_formatted());
        out
    }

    /// Every line above the screen, oldest first, each on a line of its own;
    /// then enough line feeds to scroll the last of them off the screen, so
    /// all of them are in the viewer's scrollback and none of its blank lines
    /// are. (A line that wrapped arrives as the rows it wrapped into.)
    fn write_history(&mut self, out: &mut Vec<u8>) {
        let (rows, cols) = self.parser.screen().size();
        let rows = usize::from(rows);
        let screen = self.parser.screen_mut();
        // Clamped to what the model holds.
        screen.set_scrollback(usize::MAX);
        let mut above = screen.scrollback();
        if above == 0 {
            return;
        }
        while above > 0 {
            screen.set_scrollback(above);
            let take = above.min(rows);
            for row in screen.rows_formatted(0, cols).take(take) {
                out.extend_from_slice(b"\x1b[m");
                out.extend_from_slice(&row);
                out.extend_from_slice(b"\x1b[m\r\n");
            }
            above -= take;
        }
        screen.set_scrollback(0);
        // Wherever the cursor stopped, `rows - 1` more line feeds scroll every
        // history line still on screen into the scrollback, and nothing else.
        for _ in 1..rows {
            out.push(b'\n');
        }
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

    /// Every line a screen holds, history first, as text.
    fn all_lines(screen: &mut Screen) -> Vec<String> {
        let (rows, cols) = screen.size();
        let rows = usize::from(rows);
        let s = screen.parser.screen_mut();
        s.set_scrollback(usize::MAX);
        let mut above = s.scrollback();
        let mut lines = Vec::new();
        while above > 0 {
            s.set_scrollback(above);
            let take = above.min(rows);
            lines.extend(s.rows(0, cols).take(take));
            above -= take;
        }
        s.set_scrollback(0);
        lines.extend(s.rows(0, cols));
        lines
    }

    #[test]
    fn a_fresh_viewer_gets_the_history_in_its_scrollback_then_the_screen() {
        let mut screen = Screen::new(5, 20);
        for i in 0..40 {
            screen.feed(format!("\x1b[3{}mline {i}\x1b[0m\r\n", i % 8).as_bytes());
        }
        screen.feed(b"$ ");
        let mut copy = replay(&screen.snapshot(true), 5, 20);
        assert_eq!(all_lines(&mut copy), all_lines(&mut screen));
        assert_eq!(copy.text(), screen.text(), "the screen is the same");
        assert_eq!(
            copy.parser.screen().cursor_position(),
            screen.parser.screen().cursor_position()
        );
        // Colours survive in the history too: line 3 was drawn in colour 3.
        let s = copy.parser.screen_mut();
        s.set_scrollback(usize::MAX);
        let oldest = s.scrollback();
        s.set_scrollback(oldest);
        assert_eq!(s.cell(3, 0).unwrap().fgcolor(), vt100::Color::Idx(3));
    }

    #[test]
    fn a_short_history_leaves_no_blank_lines_behind() {
        let mut screen = Screen::new(10, 20);
        for i in 0..12 {
            screen.feed(format!("l{i}\r\n").as_bytes());
        }
        let mut copy = replay(&screen.snapshot(true), 10, 20);
        assert_eq!(all_lines(&mut copy), all_lines(&mut screen));
    }

    #[test]
    fn without_history_only_the_screen_is_sent() {
        let mut screen = Screen::new(3, 20);
        for i in 0..10 {
            screen.feed(format!("line {i}\r\n").as_bytes());
        }
        let mut copy = replay(&screen.snapshot(false), 3, 20);
        assert_eq!(copy.text(), screen.text());
        assert_eq!(all_lines(&mut copy).len(), 3, "nothing above the screen");
    }

    #[test]
    fn a_snapshot_reproduces_the_screen_on_a_fresh_terminal() {
        let mut screen = Screen::new(5, 20);
        screen.feed(b"\x1b[31mred\x1b[0m line one\r\nline two\r\n$ ");
        let copy = replay(&screen.snapshot(false), 5, 20);
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
        let copy = replay(&screen.snapshot(false), 4, 30);
        assert!(copy.parser.screen().alternate_screen());
        assert!(copy.text().contains("agent is thinking"));
        assert!(!copy.text().contains("shell history"));
    }

    #[test]
    fn input_modes_the_program_asked_for_come_back() {
        let mut screen = Screen::new(4, 30);
        screen.feed(b"\x1b[?2004h"); // bracketed paste
        let copy = replay(&screen.snapshot(false), 4, 30);
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
