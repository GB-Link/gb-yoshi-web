import { CookieHost } from './CookieHost.js';

export const COOKIE_GAME = 'cookie';
const TITLE = "Yoshi's Cookie";
// One byte per Game Boy frame
const FRAME_MS = 1000 / 59.7275;
// Matchmaking: the first match starts by itself this long after both Game Boys are ready
const AUTO_START_MS = 1500;
// What the player does on the Game Boy at each step of the host
const STEPS = {
    link: (host, game) => (game.played
        ? 'Your Game Boy goes back to its name entry: press START to keep your name.'
        : 'Leave Yoshi\'s Cookie on its title screen. When the name entry appears, enter your name and press START.'),
    names: 'Linking with your Game Boy...',
    hold: 'Pick your time speed and handicap on the Game Boy. Choose the music here.',
    start: 'Starting...',
    countdown: 'Get ready!',
    round: 'Playing against {other}.',
    between: 'Next set in a moment...',
    champion: (host, game) => (game.result && game.result.won ? 'You won the match!' : '{other} won the match.'),
    leave: 'Finishing the match on your Game Boy...',
};

const $ = (id) => document.getElementById(id);

export class CookieGame {
    /** app: the page (js/app.js). serial: the link to the Game Boy (adapter or emulator). */
    constructor(app, serial) {
        this.app = app;
        this.serial = serial;
        this.onAdapter = !(app.emulator && serial === app.emulator.serial);
        this.gb = null;
        this.host = null;
        this.matchmaking = false;
        this.opponent = null;
        this.left = null;
        this.ended = false;
        this.theirReady = false;
        this.inMatch = false;
        this.played = false;
        this.score = null;
        this.result = null;
        this.running = false;
        this.music = 0;
        this._start();
    }

    get leader() {
        return !!(this.gb && this.gb.admin);
    }

    findMatch(name) {
        this.open(GBWebsocket.findMatch(name, COOKIE_GAME), true);
        this.app.setState(this.app.StateMatchmaking);
    }

    create(name) {
        this.open(GBWebsocket.initiateGame(name, COOKIE_GAME), false);
        this.app.setState(this.app.StateJoiningGame);
    }

    join(name, code) {
        this.open(GBWebsocket.joinGame(name, code, COOKIE_GAME), false);
        this.app.setState(this.app.StateJoiningGame);
    }

    /** Leaves the lobby or the queue. The Game Boy stays linked and set up. */
    close() {
        if (this.gb) {
            this.gb._closedByUs = true;
            if (this.matchmaking && this.gb.ws.readyState === 1 && !this.opponent) this.gb.cancelMatchmaking();
            else this.gb.ws.close();
        }
        if (this.opponent) this._unmatch();
        this.gb = null;
        this.opponent = null;
        this.left = null;
    }

    dispose() {
        this.close();
        this._stop();
    }

    open(gb, matchmaking) {
        this.close();
        this.gb = gb;
        this.matchmaking = matchmaking;
        this.ended = false;
        gb.onconnected = () => {};
        gb.onuserinfo = () => {
            if (!gb.relay) this.fail('The game server doesn\'t support Yoshi\'s Cookie yet.');
        };
        gb.oninfoupdate = () => this.update();
        gb.onmatchfound = () => this.update();
        gb.onrelay = (_, data) => this.onRemote(data);
        gb.onerror = (_, message) => this.error(message);
        gb.onopponentdisconnect = () => this.gone();
        for (const name of ['ongamestart', 'ongameupdate', 'ongameend', 'onlines', 'onwin', 'onlose', 'onplayerready', 'oncountdownstarted']) gb[name] = () => {};
    }

    // The lobby changed: who's in it, who leads
    update() {
        const gb = this.gb;
        // Matchmaking: who leads comes with the lobby info that follows the match
        if (!gb || gb.game_status === gb.GAME_STATE_NONE) return;
        const opponent = gb.users.find((u) => u.uuid !== gb.uuid) || null;
        if ((opponent && opponent.uuid) !== (this.opponent && this.opponent.uuid)) {
            if (this.opponent) {
                this.left = this.opponent.name;
                this._unmatch();
            }
            this.opponent = opponent;
            this.played = false;
            this.score = null;
            this.result = null;
            if (opponent) {
                this.left = null;
                this.host.match(this.leader);
                this._sendReady();
            }
        }
        this.app.setState(this.app.StateCookie);
        this._autoStart();
        this.render();
    }

    /** Our Game Boy was reset: it links again and the player sets up again. */
    restarted() {
        if (!this.host) return;
        this.host.relink();
        this._left();
        this.render();
    }

    // The server closed the game (matched opponent left) or the connection dropped
    gone() {
        if (!this.gb) return;
        const name = this.opponent ? this.opponent.name : null;
        const matchmaking = this.matchmaking;
        this.close();
        this.matchmaking = matchmaking;
        this.left = name;
        this.ended = true;
        this.app.setState(this.app.StateCookie);
        this.render();
    }

    error(message) {
        const text = {
            'Game not found.': 'Lobby not found. Please check the code and try again.',
            'Wrong game.': 'That lobby plays another game.',
            'Lobby is full.': 'That lobby already has two players.',
        }[message];
        if (!text) {
            this.fail(message);
            return;
        }
        this.close();
        this.app.setState(this.app.StateSelectGame);
        const joinError = $('join-error');
        joinError.textContent = text;
        joinError.style.display = 'block';
    }

    fail(message) {
        this.close();
        $('error-message').textContent = message;
        this.app.setState(this.app.StateError);
    }

    // ---- Player 1 for our Game Boy ----

    _start() {
        this.host = new CookieHost({
            send: (msg) => this.opponent && this.gb && this.gb.sendRelay(msg),
            onEvent: (name, data) => this._onHost(name, data),
            music: this.music,
        });
        this.running = true;
        this._pump(this.host);
    }

    _stop() {
        this.running = false;
        this.host = null;
        clearTimeout(this._autoTimer);
    }

    // One byte per frame to the Game Boy, its reply back to the host
    async _pump(host) {
        let next = performance.now();
        while (this.running && this.host === host) {
            try {
                await this.serial.send(new Uint8Array([host.out()]));
                const reply = await this.serial.read(64);
                if (this.host !== host) return;
                host.got(reply.data.getUint8(0));
            } catch (e) {
                if (!this.serial.ready) return;
            }
            next += FRAME_MS;
            const wait = next - performance.now();
            if (wait < -10 * FRAME_MS) next = performance.now();
            await new Promise((r) => setTimeout(r, Math.max(0, wait)));
        }
    }

    // The opponent left or their Game Boy was reset: a match in progress is abandoned
    _unmatch() {
        this.inMatch = false;
        this.theirReady = false;
        clearTimeout(this._autoTimer);
        if (this.host) this.host.unmatch();
    }

    _sendReady() {
        if (this.gb && this.opponent) this.gb.sendRelay({ t: 'ready', v: !!(this.host && this.host.ready) });
    }

    onRemote(msg) {
        if (!this.opponent) return;
        switch (msg.t) {
        case 'ready':
            this.theirReady = msg.v;
            this._autoStart();
            this.render();
            return;
        case 'go':
            this._begin();
            return;
        case 'restart':
            this._rematch();
            this.render();
            return;
        }
        if (this.host) this.host.onRemote(msg);
    }

    _onHost(name, data) {
        if (name === 'ready') {
            this._sendReady();
            this._autoStart();
        }
        if (name === 'round') this.score = data;
        if (name === 'match') {
            this.result = data;
            this.inMatch = false;
            this.played = true;
        }
        if (name === 'reset' || (name === 'phase' && data === 'link')) this._left();
        // A match that ended without a result
        else if (name === 'phase' && this.inMatch && !this.host.playing) this.inMatch = false;
        this.render();
    }

    // Our Game Boy left a match (reset or switched off): the other one leaves it too
    _left() {
        if (!this.inMatch || !this.opponent) return;
        this.gb.sendRelay({ t: 'restart' });
        this._rematch();
    }

    // A match ended early: both pages start again from the same point with the same opponent
    _rematch() {
        this._unmatch();
        if (this.host) this.host.match(this.leader);
        this._sendReady();
    }

    get canStart() {
        return !!(this.leader && this.opponent && this.host && this.host.ready && !this.host.playing && !this.inMatch && this.theirReady);
    }

    // Matchmaking: the leader's page starts the first match once both are ready
    _autoStart() {
        clearTimeout(this._autoTimer);
        if (!this.matchmaking || this.played || !this.canStart) return;
        this._autoTimer = setTimeout(() => this.startMatch(), AUTO_START_MS);
    }

    /** Leader only: starts a match on both Game Boys. */
    startMatch() {
        if (!this.canStart) return;
        clearTimeout(this._autoTimer);
        this.gb.sendRelay({ t: 'go' });
        this._begin();
    }

    _begin() {
        this.inMatch = true;
        this.score = null;
        this.result = null;
        if (this.host) this.host.start();
        this.render();
    }

    setMusic(music) {
        this.music = music;
        if (this.host) this.host.setMusic(music);
        this.render();
    }

    // ---- Screen ----

    render() {
        for (const el of document.querySelectorAll('.cookie-reset')) el.style.display = this.onAdapter ? 'block' : 'none';
        if (this.app.currentState === this.app.StateCookieSetup) this._renderSetup();
        else if (this.app.currentState === this.app.StateCookie) this._renderLobby();
    }

    // The music buttons move to the screen that shows them
    _renderControls(screen, show) {
        const controls = $('cookie-controls');
        const slot = $(screen).querySelector('.cookie-controls-slot');
        if (controls.parentNode !== slot) slot.appendChild(controls);
        controls.style.display = show ? 'block' : 'none';
        for (const button of controls.querySelectorAll('[data-music]')) button.classList.toggle('active', +button.dataset.music === this.music);
    }

    _renderSetup() {
        $('cookie-setup-status').textContent = this._step();
        this._renderControls('screen-cookie-setup', true);
        $('btn-cookie-next').disabled = !(this.host && this.host.ready);
    }

    _renderLobby() {
        const gb = this.gb;
        $('cookie-heading').textContent = !gb && this.ended ? TITLE
            : this.matchmaking ? `${TITLE}: matched` : `${TITLE}: lobby ${gb ? gb.game_name : ''}`;
        const players = $('cookie-players');
        players.innerHTML = '';
        for (const user of gb ? gb.users : []) {
            const li = document.createElement('li');
            li.textContent = user.uuid === gb.uuid ? `${user.name} (you)` : user.name;
            players.appendChild(li);
        }
        const [status, note] = this.describe();
        $('cookie-status').textContent = status;
        $('cookie-note').textContent = note;
        const between = !!(gb && this.opponent && this.host && !this.host.playing && !this.inMatch);
        this._renderControls('screen-cookie', between);
        const start = $('btn-cookie-start');
        start.style.display = between && this.leader && (this.played || !this.matchmaking) ? 'inline-block' : 'none';
        start.textContent = this.played ? 'Play again' : 'Start the match';
        start.disabled = !this.canStart;
        $('btn-cookie-again').style.display = !gb && this.ended && this.matchmaking ? 'inline-block' : 'none';
        $('btn-leave-cookie').textContent = gb ? 'Leave Lobby' : 'Back to Menu';
    }

    // What the player does now on the Game Boy
    _step(other = 'the other player') {
        const host = this.host;
        if (!host) return '';
        let step = STEPS[host.phase];
        if (typeof step === 'function') step = step(host, this);
        if (step) return step.replace('{other}', other);
        return host.playing ? `Playing against ${other}.` : '';
    }

    describe() {
        const other = this.opponent ? this.opponent.name : null;
        // With nobody to play, still say what to do on the Game Boy
        const step = this.host && !this.host.ready ? this._step() : '';
        if (!this.gb) return [this.left ? `${this.left} left the game.` : 'The connection to the game server was lost.', step];
        if (!other) {
            return [this.left ? `${this.left} left the lobby. Waiting for another player...` : 'Waiting for a second player...',
                step || (this.matchmaking ? '' : `Share the lobby code ${this.gb.game_name} with them.`)];
        }
        const host = this.host;
        if (this.inMatch || host.playing) {
            return [this._step(other), this.score ? `Sets: you ${this.score.mine}, ${other} ${this.score.theirs}` : ''];
        }
        let line;
        if (!host.ready) line = this._step(other);
        else if (!this.theirReady) line = `Waiting for ${other}'s Game Boy...`;
        else if (!this.leader) line = `${other} starts the match.`;
        else line = this.matchmaking && !this.played ? 'Starting...' : 'Start the match when you are both set.';
        if (!this.result) return [line, ''];
        const won = this.result.won;
        return [won ? 'You won the match!' : won === false ? `${other} won the match.` : 'The match is over.', line];
    }
}
