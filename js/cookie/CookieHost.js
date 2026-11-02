/**
 * Yoshi's Cookie link host. The player's Game Boy runs as player 2 and this page
 * plays player 1 for it. The page links as soon as the game is found and the
 * player sets up on the Game Boy (name, time speed, handicap) before there is an
 * opponent; the music is the page's. In a match the page passes on what the
 * other player's Game Boy sends (that one is player 2 on its own page too).
 *
 * out() returns the next byte to clock and got(byte) takes the Game Boy's reply
 * (null or 0xFF: none). 0xFA is idle both ways. Yoshi's Cookie and Yoshi no
 * Cookie (Japan) differ only in the link request and play each other.
 *
 * Protocol:
 * - Link: on its title, opening and demo the Game Boy answers 0xFA to every
 *   byte. Player 1's 0xF9 (Yoshi's Cookie) or 0xFC (Yoshi no Cookie) opens its
 *   name entry; the other release ignores the byte. Nothing shows the link until
 *   the player confirms a name. The name entry reads 4-byte chunks and drops any
 *   that don't start with 0x83, so a request goes out as 0xF2 0xF2 0xF2 0xF9 or
 *   0xF2 0xF2 0xF2 0xFC (alternating; 0xF2 is ignored everywhere) and a started
 *   block is always finished: the byte that links is the last of its block and
 *   later blocks are whole chunks.
 * - Names: 0x83 and three letters (A = 0x60). The Game Boy sends its player's
 *   name when they press START; after a match it offers the last one again.
 *   Player 1's name, MAR, goes out four times with 0xF2 between, so one copy
 *   starts a chunk whatever is buffered. Then 0x40.
 * - Settings: 64 frames after 0x40 the Game Boy is on its settings screen and
 *   sends its player's time speed 0x6n (0-2) and handicap 0x80 + h (0-20), and
 *   again on every change. It waits there as long as needed. Player 1 sends
 *   0x70 + music (A, B, C, off), a time speed (only shown) and a handicap: in a
 *   match the other player's, because each Game Boy keeps its own copy of the
 *   other's meter, which starts at that handicap and decides when the other
 *   wins. Each Game Boy times itself with its own speed. 0x05 starts a set
 *   (0x40 and 0x04 would too).
 * - Player 1 paces each set's start: 0xF7 x3, 0xF8 a second apart, then
 *   0xF8 0xF8. A set's winner sends 0xE0, running out of time sends 0xF0. After
 *   a set both send 0xF5, then player 1 sends 0xF5 and 0xF3 x3. The next set
 *   starts with 0xF4 0xF3 0xF4 0xF3 0xF4. Three set wins take the match; on the
 *   champion screen player 1's 0xF6 sends the Game Boy back to its title,
 *   unlinked, and the page links again.
 * - During a set both Game Boys send their moves and results. Moves (below
 *   0xC0) carry a player number in bits 3-4, swapped between 0 and 1: both Game
 *   Boys are player 2 and see the other as player 1.
 * - Leaving a match: player 1's 0xF0 (its time is over) wins each remaining set
 *   for the Game Boy, with a short countdown, up to the champion screen.
 *
 * Messages to and from the other page (n: the match number since match(), s: the set).
 * Each carries sid, a random id the sender picks in match(); messages from before the
 * other page's last match() (still in flight when a match was restarted) are dropped.
 *   { t: 'hcap', v }        our player's handicap byte (null: not known yet), on match()
 *                           and on every change
 *   { t: 'm', v, n, s }     bytes our Game Boy sent in a set
 *   { t: 'at', v, n, s }    our Game Boy is 'between' sets or on the 'champion' screen
 *   { t: 'next', n, s }     leader: start the set after s
 *   { t: 'end', n }         leader: leave the champion screen
 */
const IDLE = 0xFA;
const NO_REPLY = 0xFF;
const REQUESTS = [0xF9, 0xFC];
const FILL = 0xF2;
const NAME = 0x83;
const P1_NAME = [0x83, 0x6C, 0x60, 0x71];
const NAMES_DONE = 0x40;
const SPEED = 0x60;
const MUSIC = 0x70;
const HANDICAP = 0x80;
const SET_START = 0x05;
const COUNT_A = 0xF7;
const COUNT_B = 0xF8;
const ROUND_START = 0xF1;
const SET_WON = 0xE0;
const TIME_OVER = 0xF0;
const ROUND_ACK = 0xF5;
const SET_OVER = 0xF3;
const NEXT_SET = [0xF4, 0xF3, 0xF4, 0xF3, 0xF4];
const MATCH_OVER = 0xF6;
const WINS_FOR_MATCH = 3;
// Player 1's time speed on the settings screen (MED)
const P1_SPEED = 1;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?';

// Timing in frames (one byte a frame)
const REQUEST_GAP = 8;
const NAMES_DONE_DELAY = 90;
// After 0x40, go on without the Game Boy's settings bytes after this long
const SETTINGS_WAIT = 240;
// start() waits this long for the other page's handicap
const HANDICAP_WAIT = 120;
// After 0x05 the Game Boy can still send a change made just before it, and it still
// takes player 1's handicap until the set starts (80 frames)
const OWN_LATE = 8;
const THEIR_LATE = 60;
// [frames, bytes] steps after 0x05 or the next-set bytes
const COUNTDOWN = [[178, [COUNT_A, COUNT_A, COUNT_A]], [58, [COUNT_B]], [60, [COUNT_B]], [60, [COUNT_B, COUNT_B]]];
const SET_OVER_DELAY = 167;
// The leader's page moves both on after this long between sets and on the champion screen
const NEXT_FRAMES = 150;
const END_FRAMES = 478;
// From 0xF6 until the Game Boy is back on its title
const TITLE_DELAY = 30;
// Leaving a match: shorter countdown and steps
const LEAVE_COUNTDOWN = [[60, [COUNT_A, COUNT_A, COUNT_A]], [20, [COUNT_B]], [20, [COUNT_B]], [20, [COUNT_B, COUNT_B]]];
const LEAVE_STEP = 30;
// No 0xF1 this long after a leaving countdown: the Game Boy was on its champion screen
const LEAVE_START_WAIT = 150;

const isHandicap = (byte) => (byte & 0xE0) === HANDICAP && (byte & 0x1F) <= 20;
const SETTINGS_STAGES = ['hold', 'start'];
const MATCH_STAGES = ['countdown', 'round', 'between', 'champion'];

export class CookieHost {
    /**
     * send(msg): sends to the other page. music: 0-3 (A, B, C, off).
     * onEvent(name, data):
     *   'phase'  link, names, hold, start, countdown, round, between, champion, leave
     *   'ready'  true while the Game Boy is on its settings screen and a match can start
     *   'round'  { mine, theirs, won, draw } after each set
     *   'match'  { won } when a match is over
     */
    constructor({ send, onEvent = () => {}, music = 0 }) {
        this.send = send;
        this.onEvent = onEvent;
        this.music = music & 3;
        this.leader = false;
        this.matched = false;
        this.ready = false;
        this.inMatch = false;
        this.leaving = false;
        this.matchNo = 0;
        this.clock = 0;
        this.timers = [];
        this.queue = [];
        this.requests = 0;
        this.handicap = null;       // our player's handicap byte
        this.speed = null;          // our player's time speed (stays here)
        this.name = null;           // our player's name: 0x83 + 3 letters
        this.sid = null;
        this.last = IDLE;
        this._clearRemote();
        this._toLink();
    }

    /** True from start() until the match is over or left and the Game Boy is back in setup. */
    get playing() {
        return this.inMatch;
    }

    /** Our player's name as text, once the Game Boy sent it. */
    get playerName() {
        if (!this.name) return null;
        return this.name.slice(1).map((b) => (b >= 0xD0 && b <= 0xD9 ? String(b - 0xD0)
            : b >= 0x60 && b < 0x60 + LETTERS.length ? LETTERS[b - 0x60] : ' ')).join('').trim();
    }

    /** An opponent joined. leader: this page moves both Game Boys on between sets. */
    match(leader) {
        this.leader = leader;
        this.matched = true;
        this.matchNo = 0;
        this.sid = Math.random().toString(36).slice(2, 10);
        this._clearRemote();
        this._tell({ t: 'hcap', v: this.handicap });
    }

    /** The opponent left. A match in progress is played out on our Game Boy, which then links again. */
    unmatch() {
        this.matched = false;
        this.leader = false;
        this._clearRemote();
        if (!this.inMatch) {
            if (SETTINGS_STAGES.includes(this.stage)) this.queue.push(HANDICAP);
            return;
        }
        if (this.stage === 'start') {
            // 0x05 hasn't gone out: back to the settings screen
            this.inMatch = false;
            this.queue.push(HANDICAP);
            this._phase('hold');
            this._setReady(true);
            return;
        }
        if (this.leaving) return;
        this.leaving = true;
        this.acks.theirs = true;
        switch (this.stage) {
        case 'round':
            if (this.started) this.queue.push(TIME_OVER);
            this._acked();
            break;
        case 'between':
            this._later(LEAVE_STEP, () => this._nextSet());
            break;
        case 'champion':
            this._end();
            return;
        }
        this._phase(this.stage);
    }

    /** Starts the match (both pages, while both are ready). Waits briefly for the other page's handicap. */
    start() {
        if (!this.ready) return false;
        this.matchNo++;
        this.inMatch = true;
        this.leaving = false;
        this.mine = 0;
        this.theirs = 0;
        this.set = 0;
        this.sets = {};
        for (const msg of this.early.filter((m) => m.n === this.matchNo)) this._keep(msg);
        this.early = this.early.filter((m) => m.n > this.matchNo);
        this.handicapWait = HANDICAP_WAIT;
        this._setReady(false);
        this._phase('start');
        this._go();
        return true;
    }

    /** Our Game Boy was reset: link again from its title. */
    relink() {
        this.timers = [];
        this.queue = [];
        this.leaving = false;
        this._toLink();
    }

    /** 0-3: A, B, C, off. Changes the music on the settings screen at once. */
    setMusic(music) {
        this.music = music & 3;
        if (SETTINGS_STAGES.includes(this.stage)) this.queue.push(MUSIC | this.music);
    }

    onRemote(msg) {
        if (!this.matched) return;
        if (msg.t === 'hcap' && msg.sid !== this.theirSid) {
            // The other page (re)started: answer, in case ours came before it was matched
            this.theirSid = msg.sid;
            this._tell({ t: 'hcap', v: this.handicap });
        } else if (msg.sid !== this.theirSid) return;
        switch (msg.t) {
        case 'hcap':
            if (!isHandicap(msg.v)) return;
            this.theirHandicap = msg.v;
            if (SETTINGS_STAGES.includes(this.stage) || this._lateSetting(THEIR_LATE)) this.queue.push(msg.v);
            if (this.stage === 'start') this._go();
            return;
        case 'm':
            if (msg.n > this.matchNo) this.early.push(msg);
            else if (msg.n === this.matchNo && this.inMatch) {
                this._keep(msg);
                this._deliver();
            }
            return;
        case 'at':
            if (msg.n !== this.matchNo) return;
            this.theirAt = msg;
            this._leaderGo();
            return;
        case 'next':
            if (msg.n !== this.matchNo || msg.s !== this.set) return;
            if (this.stage === 'between') this._nextSet();
            else this.pendingGo = 'next';
            return;
        case 'end':
            if (msg.n !== this.matchNo) return;
            if (this.stage === 'champion') this._end();
            else this.pendingGo = 'end';
            return;
        }
    }

    /** The byte to clock next. */
    out() {
        this.clock++;
        const due = this.timers.filter((t) => t.at <= this.clock);
        if (due.length) {
            this.timers = this.timers.filter((t) => t.at > this.clock);
            for (const t of due) t.fn();
        }
        if (this.stage === 'start') this._go();
        if (this.stage === 'link' && !this.queue.length && !this.collect) this._request();
        this.last = this.queue.length ? this.queue.shift() : IDLE;
        return this.last;
    }

    /** The Game Boy's reply to the last byte. */
    got(byte) {
        if (byte === null || byte === IDLE || byte === NO_REPLY) return;
        if (this.collect) {
            this.collect.push(byte);
            if (this.collect.length === P1_NAME.length) {
                this.name = this.collect;
                this.collect = null;
            }
            return;
        }
        switch (this.stage) {
        case 'link':
            if (byte === NAME) this.collect = [byte];
            return;
        case 'names':
        case 'hold':
        case 'start':
            this._setting(byte);
            return;
        case 'countdown':
            if (this._lateSetting(OWN_LATE)) this._setting(byte);
            return;
        case 'round':
            this._fromOurs(byte);
            return;
        }
    }

    // Our player changed a setting (the Game Boy also sends both on entering the settings screen)
    _setting(byte) {
        if ((byte & 0xF0) === SPEED) {
            this.speed = byte & 0x0F;
        } else if (isHandicap(byte)) {
            this.handicap = byte;
            this._tell({ t: 'hcap', v: byte });
            if (this.stage === 'names' && this.namesSent) this._toHold();
        }
    }

    // Link requests until the Game Boy sends its player's name, then player 1's name
    _request() {
        if (this.name) {
            this._names();
        } else if (this.gap > 0) {
            this.gap--;
        } else {
            this.queue.push(FILL, FILL, FILL, REQUESTS[this.requests++ % REQUESTS.length]);
            this.gap = REQUEST_GAP;
        }
    }

    _names() {
        this._phase('names');
        this.namesSent = false;
        const name = P1_NAME;
        this.queue.push(...name, FILL, ...name, FILL, ...name, FILL, ...name);
        this._later(NAMES_DONE_DELAY, () => {
            this.queue.push(NAMES_DONE);
            this.namesSent = true;
            this._later(SETTINGS_WAIT, () => {
                if (this.stage === 'names') this._toHold();
            });
        });
    }

    // On the settings screen: player 1's music, speed and handicap
    _toHold() {
        this.queue.push(MUSIC | this.music, SPEED | P1_SPEED, this.theirHandicap ?? HANDICAP);
        this._phase('hold');
        this._setReady(true);
    }

    // Starts the first set once the other page's handicap is here (or after a short wait)
    _go() {
        if (this.stage !== 'start') return;
        if (this.matched && this.theirHandicap === null && this.handicapWait-- > 0) return;
        this.queue.push(this.theirHandicap ?? HANDICAP, SET_START);
        this.lockAt = this.clock;
        this._startSet(COUNTDOWN);
    }

    // Just after the match's 0x05, a handicap change still counts
    _lateSetting(frames) {
        return this.stage === 'countdown' && this.set === 1 && this.clock - this.lockAt <= frames;
    }

    _nextSet() {
        if (this.stage !== 'between') return;
        this.queue.push(...NEXT_SET);
        this._startSet(this.leaving ? LEAVE_COUNTDOWN : COUNTDOWN);
    }

    _startSet(countdown) {
        this.set++;
        this.acks = { mine: false, theirs: this.leaving };
        this.won = { mine: false, theirs: false };
        this.started = false;
        this.pendingGo = null;
        this._phase('countdown');
        const s = this.set;
        const steps = countdown.slice();
        const step = () => {
            const [frames, bytes] = steps.shift();
            this._later(frames, () => {
                this.queue.push(...bytes);
                if (steps.length) {
                    step();
                    return;
                }
                this._phase('round');
                this._deliver();
                if (this.leaving) {
                    this._later(LEAVE_START_WAIT, () => {
                        if (this.leaving && this.set === s && !this.started) this._end();
                    });
                }
            });
        };
        step();
    }

    _fromOurs(byte) {
        if (!this.leaving) this._tell({ t: 'm', v: [byte], n: this.matchNo, s: this.set });
        if (byte === ROUND_START && !this.started) {
            this.started = true;
            if (this.leaving) this.queue.push(TIME_OVER);
        }
        if (byte === SET_WON) this.won.mine = true;
        if (byte === ROUND_ACK && !this.acks.mine) {
            this.acks.mine = true;
            this._acked();
        }
    }

    _fromThem(byte) {
        if (byte === SET_WON) this.won.theirs = true;
        if (byte === ROUND_ACK) {
            if (!this.acks.theirs) {
                this.acks.theirs = true;
                this._acked();
            }
            return;
        }
        // Moves carry a player number: swap 0 and 1
        if (byte < 0xC0) {
            const player = (byte >> 3) & 3;
            if (player < 2) byte = (byte & ~0x18) | ((player ^ 1) << 3);
        }
        this.queue.push(byte);
    }

    _keep(msg) {
        (this.sets[msg.s] = this.sets[msg.s] || []).push(...msg.v);
    }

    // The other Game Boy's bytes for the set ours is playing
    _deliver() {
        if (this.stage !== 'round' || this.leaving) return;
        const bytes = this.sets[this.set];
        if (!bytes) return;
        delete this.sets[this.set];
        for (const byte of bytes) this._fromThem(byte);
    }

    // Both Game Boys acknowledged the set: player 1 does too, then the set is over
    _acked() {
        if (!this.acks.mine || !this.acks.theirs || this.acks.done) return;
        this.acks.done = true;
        this.queue.push(ROUND_ACK);
        if (this.won.mine) this.mine++;
        if (this.won.theirs) this.theirs++;
        const { mine, theirs } = this;
        if (!this.leaving) this.onEvent('round', { mine, theirs, won: this.won.mine, draw: !this.won.mine && !this.won.theirs });
        const s = this.set;
        this._later(this.leaving ? LEAVE_STEP : SET_OVER_DELAY, () => {
            if (this.set !== s || !this.inMatch) return;
            this.queue.push(SET_OVER, SET_OVER, SET_OVER);
            const over = this.mine >= WINS_FOR_MATCH || this.theirs >= WINS_FOR_MATCH;
            if (over && !this.leaving) this.onEvent('match', { won: this.mine >= WINS_FOR_MATCH });
            this._phase(over ? 'champion' : 'between');
            if (this.leaving) {
                this._later(LEAVE_STEP, () => (over ? this._end() : this._nextSet()));
                return;
            }
            this._tell({ t: 'at', v: this.stage, n: this.matchNo, s });
            if (this.pendingGo === 'next' && !over) this._nextSet();
            else if (this.pendingGo === 'end' && over) this._end();
            else this._leaderGo();
        });
    }

    // Leader: once both Game Boys are between sets or on the champion screen, move both on
    _leaderGo() {
        const at = this.theirAt;
        if (!this.leader || this.leaving || !at || at.s !== this.set || at.v !== this.stage) return;
        const key = `${this.matchNo}:${this.set}:${this.stage}`;
        if (this.goKey === key) return;
        this.goKey = key;
        const [n, s] = [this.matchNo, this.set];
        if (this.stage === 'between') {
            this._later(NEXT_FRAMES, () => {
                if (this.leaving || this.stage !== 'between' || this.set !== s) return;
                this._tell({ t: 'next', n, s });
                this._nextSet();
            });
        } else if (this.stage === 'champion') {
            this._later(END_FRAMES, () => {
                if (this.leaving || this.stage !== 'champion' || this.matchNo !== n) return;
                this._tell({ t: 'end', n });
                this._end();
            });
        }
    }

    // Leaves the champion screen: the Game Boy goes back to its title and links again
    _end() {
        this.queue.push(MATCH_OVER);
        this.leaving = false;
        this._toLink();
        this.gap = TITLE_DELAY;
    }

    _tell(msg) {
        if (this.matched) this.send({ ...msg, sid: this.sid });
    }

    _later(frames, fn) {
        this.timers.push({ at: this.clock + frames, fn });
    }

    _clearRemote() {
        this.theirSid = null;
        this.theirHandicap = null;
        this.theirAt = null;
        this.early = [];
        this.sets = {};
        this.pendingGo = null;
        this.goKey = null;
    }

    _toLink() {
        this.inMatch = false;
        this.name = null;
        this.collect = null;
        this.gap = 0;
        this._setReady(false);
        this._phase('link');
    }

    _setReady(ready) {
        if (this.ready === ready) return;
        this.ready = ready;
        this.onEvent('ready', ready);
    }

    // stage: the host's own step; phase: what the page shows ('leave' while a match is played out)
    _phase(stage) {
        const phase = this.leaving && MATCH_STAGES.includes(stage) ? 'leave' : stage;
        this.stage = stage;
        if (phase === this.phase) return;
        this.phase = phase;
        this.onEvent('phase', phase);
    }
}
