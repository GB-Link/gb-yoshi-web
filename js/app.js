/**
 * GB Yoshi Web Application
 * Converted from React to vanilla JavaScript
 */

class OnlineYoshi {
    // Application states
    StateConnect = "Connect";
    StateConnecting = "Connecting";
    StateConnectingYoshi = "ConnectingYoshi";
    StateSelectGame = "SelectGame";
    StateJoiningGame = "JoiningGame";
    StateLobby = "Lobby";
    StateStartingGame = "StartingGame";
    StateJoinGame = "SelectJoinGame";
    StateInGame = "InGame";
    StateFinished = "StateFinished";
    StateError = "StateError";
    StateModeSelect = "ModeSelect";
    StateMatchmaking = "Matchmaking";
    StateOpponentDisconnect = "OpponentDisconnect";

    // Player states (sync with server)
    STATE_ALIVE = 0;
    STATE_DEAD = 1;
    STATE_WINNER = 2;

    constructor() {
        this.currentState = this.StateConnect;
        this.name = "Foo";
        this.gameCode = "";
        this.users = [];
        this.height = 0;
        this.localDifficulty = 0x00;
        this.uuid = "";
        this.isAdmin = false;
        this.isMatchmaking = false;
        this.serial = null;
        this.gb = null;

        // Game loop state
        this.gameLoopActive = false;
        this.countdownInterval = null;

        // Yoshi-specific protocol state
        this.hatchQueue = [];           // bytes 0x41-0x47 to send to local GB once each
        this.lastSentMaxSlots = 0;       // last partner-slot byte we wrote (avoid duplicate sends)
        this.difficultyTimerActive = false; // poll the GB for level/speed changes pre-match
        // End-of-round handshake state (BGB-debugged per Yoshi protocol).
        this.lossPending = false;        // local GB lost — reply 0x81 until GB stops sending 0x80
        this.winPending = false;         // local GB won or server-told win — send 0x80 until GB leaves win-state
        this.winTickCount = 0;           // ticks elapsed since winPending started
        this.forceLossPending = false;   // server-told loss — send 0xC3 until GB enters loss-state (0x80)
        this.winsThisSeries = 0;
        this.lossesThisSeries = 0;
        this.needsRehandshake = false;   // true once series hits 3 wins or 3 losses

        this.init();
    }

    init() {
        // Check for WebUSB support
        if (!navigator.usb) {
            this.showScreen('screen-no-webusb');
            return;
        }

        // Load saved username or generate a random one
        var savedName = localStorage.getItem('yoshi_username');
        document.getElementById('username').value = savedName || this.generateName();

        // Save username when changed; regenerate random name if blanked out
        document.getElementById('username').addEventListener('change', () => {
            var val = document.getElementById('username').value.trim();
            if (val) {
                localStorage.setItem('yoshi_username', val);
            } else {
                localStorage.removeItem('yoshi_username');
                document.getElementById('username').value = this.generateName();
            }
        });

        // Bind event listeners
        this.bindEvents();

        // Show initial screen
        this.updateUI();
    }

    generateName() {
        const prefixes = ["Green", "Yellow", "Red", "Purple", "Blue", "Orange"];
        const suffixes = ["Yoshi", "Egg", "Cookie", "Boo", "Goomba", "Piranha", "Shy-Guy"];
        return prefixes[Math.floor(Math.random() * prefixes.length)] + " " +
            suffixes[Math.floor(Math.random() * suffixes.length)];
    }

    bindEvents() {
        // Connect button
        document.getElementById('btn-connect').addEventListener('click', () => this.handleConnectClick());

        // Create/Join game buttons
        document.getElementById('btn-create-game').addEventListener('click', () => {
            const name = document.getElementById('username').value;
            this.handleCreateGame(name);
        });
        document.getElementById('btn-join-game').addEventListener('click', () => {
            const name = document.getElementById('username').value;
            const code = document.getElementById('game-code-input').value;
            this.handleJoinGame(name, code);
        });

        // Game code input - Enter key
        document.getElementById('game-code-input').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const name = document.getElementById('username').value;
                const code = document.getElementById('game-code-input').value;
                this.handleJoinGame(name, code);
            }
        });

        // Lobby buttons
        document.getElementById('btn-start-game').addEventListener('click', () => this.handleStartGame());

        // Finished screen - next game button
        document.getElementById('btn-finished-next').addEventListener('click', () => this.handleStartGame());

        // Matchmaking ready-up button
        document.getElementById('btn-ready-next').addEventListener('click', () => this.handleReadyNext());

        // Mode selection buttons
        document.getElementById('btn-find-match').addEventListener('click', () => this.handleFindMatch());
        document.getElementById('btn-private-lobby').addEventListener('click', () => this.handlePrivateLobby());

        // Matchmaking buttons
        document.getElementById('btn-cancel-matchmaking').addEventListener('click', () => this.handleCancelMatchmaking());

        // Opponent disconnect buttons
        document.getElementById('btn-rematch').addEventListener('click', () => this.handleRematch());
        document.getElementById('btn-back-to-menu').addEventListener('click', () => this.handleBackToMenu());

        // Leave lobby buttons (lobby and finished screens)
        document.getElementById('btn-leave-lobby-pre').addEventListener('click', () => this.handleLeaveLobby());
        document.getElementById('btn-leave-lobby').addEventListener('click', () => this.handleLeaveLobby());

        // Back to menu from create/join screen
        document.getElementById('btn-back-to-mode-select').addEventListener('click', () => {
            this.setState(this.StateModeSelect);
        });

        // Reconnect Game Boy button (mode select screen)
        document.getElementById('btn-reinit-gameboy').addEventListener('click', () => this.handleReinitGameboy());
    }

    // Hide all screens
    hideAllScreens() {
        const screens = document.querySelectorAll('.screen');
        screens.forEach(screen => screen.style.display = 'none');
    }

    // Show a specific screen
    showScreen(screenId) {
        this.hideAllScreens();
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.style.display = 'block';
        }
    }

    // Update UI based on current state
    updateUI() {
        switch (this.currentState) {
            case this.StateConnect:
                this.showScreen('screen-connect');
                break;
            case this.StateConnecting:
                this.showScreen('screen-connecting');
                break;
            case this.StateConnectingYoshi:
                this.showScreen('screen-connecting-yoshi');
                break;
            case this.StateSelectGame:
                this.showScreen('screen-select-game');
                break;
            case this.StateJoiningGame:
                this.showScreen('screen-joining');
                break;
            case this.StateLobby:
                this.showScreen('screen-lobby');
                this.updateLobbyUI();
                break;
            case this.StateStartingGame:
                this.showScreen('screen-starting');
                break;
            case this.StateInGame:
                this.showScreen('screen-ingame');
                this.updateInGameUI();
                break;
            case this.StateFinished:
                this.showScreen('screen-finished');
                this.updateFinishedUI();
                break;
            case this.StateError:
                this.showScreen('screen-error');
                break;
            case this.StateModeSelect:
                this.showScreen('screen-mode-select');
                break;
            case this.StateMatchmaking:
                this.showScreen('screen-matchmaking');
                break;
            case this.StateOpponentDisconnect:
                this.showScreen('screen-opponent-disconnect');
                break;
            default:
                console.error("Invalid state:", this.currentState);
        }
    }

    // Set state and update UI
    setState(newState) {
        this.currentState = newState;
        this.updateUI();
    }

    // Update lobby display
    updateLobbyUI() {
        document.getElementById('lobby-game-code').textContent = this.isMatchmaking ? 'Matchmaking' : this.gameCode;
        this.renderPlayers('lobby-players', this.users);

        // Show/hide admin controls
        if (this.isAdmin) {
            document.getElementById('lobby-admin-controls').style.display = 'block';
            document.getElementById('lobby-waiting').style.display = 'none';
            document.getElementById('btn-start-game').disabled = this.users.length < 2;
        } else {
            document.getElementById('lobby-admin-controls').style.display = 'none';
            document.getElementById('lobby-waiting').style.display = 'block';
        }
    }

    updateInGameUI() {
        document.getElementById('ingame-game-code').textContent = this.isMatchmaking ? 'Matchmaking' : this.gameCode;
        this.renderPlayers('ingame-players', this.users);
    }

    updateFinishedUI() {
        document.getElementById('finished-game-code').textContent = this.isMatchmaking ? 'Matchmaking' : this.gameCode;
        this.renderPlayers('finished-players', this.users);

        // Clear any previous countdown interval
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        document.getElementById('btn-leave-lobby').style.display = 'inline-block';

        if (this.isMatchmaking) {
            // Matchmaking: both players get ready-up controls
            document.getElementById('finished-admin-controls').style.display = 'none';
            document.getElementById('finished-waiting').style.display = 'none';
            document.getElementById('finished-matchmaking-controls').style.display = 'block';

            // Show greyed out, enable after 5 seconds — but keep disabled
            // while a series-end rehandshake is still in flight.
            document.getElementById('btn-ready-next').disabled = true;
            document.getElementById('btn-ready-next').textContent = 'Start Next Round';
            document.getElementById('finished-countdown').style.display = 'none';
            document.getElementById('finished-ready-status').textContent = '';

            setTimeout(() => {
                if (this.currentState === this.StateFinished && !this.needsRehandshake) {
                    document.getElementById('btn-ready-next').disabled = false;
                }
            }, 5000);
        } else {
            // Private lobby: host-only start
            document.getElementById('finished-matchmaking-controls').style.display = 'none';
            if (this.isAdmin) {
                document.getElementById('finished-admin-controls').style.display = 'block';
                document.getElementById('finished-waiting').style.display = 'none';

                // Only allow starting next game when the round is fully over
                // (server reports BETWEEN state) and there are enough players
                var roundOver = this.gb && this.gb.game_status === this.gb.GAME_STATE_BETWEEN;
                if (!roundOver) {
                    // Round still in progress — keep button disabled
                    document.getElementById('btn-finished-next').disabled = true;
                } else {
                    // Round is over — enable after a short delay (but keep
                    // disabled until any series-end rehandshake completes).
                    document.getElementById('btn-finished-next').disabled = true;
                    setTimeout(() => {
                        if (this.currentState === this.StateFinished && !this.needsRehandshake) {
                            document.getElementById('btn-finished-next').disabled = this.users.length < 2;
                        }
                    }, 5000);
                }
            } else {
                document.getElementById('finished-admin-controls').style.display = 'none';
                document.getElementById('finished-waiting').style.display = 'block';
            }
        }
    }

    // Render player cards
    renderPlayers(containerId, users) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        users.forEach(user => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'col-3';

            let imgSrc, statusText;
            if (user.state === this.STATE_ALIVE) {
                imgSrc = 'images/animation.gif';
                statusText = `Slots: ${user.height}<br/>Wins: ${user.num_wins}`;
            } else if (user.state === this.STATE_DEAD) {
                imgSrc = 'images/dead.png';
                statusText = `Game Over<br/>Wins: ${user.num_wins}`;
            } else if (user.state === this.STATE_WINNER) {
                imgSrc = 'images/win.png';
                statusText = `Winner!!!<br/>Wins: ${user.num_wins}`;
            } else {
                imgSrc = 'images/animation.gif';
                statusText = `Wins: ${user.num_wins || 0}`;
            }

            // For our own card, prefer the locally-known difficulty over the
            // server-side value: the matchmaking wait loop on the server can
            // discard the difficulty message we send on connect, so the server
            // may report null even though we know what we picked.
            const displayDifficulty = (user.uuid === this.uuid)
                ? this.localDifficulty
                : user.difficulty;
            const difficultyText = (displayDifficulty !== null && displayDifficulty !== undefined)
                ? `<br/>${this.formatDifficulty(displayDifficulty)}`
                : '';

            playerDiv.innerHTML = `
        <img src="${imgSrc}" class="gameboy" alt="${user.name}" />
        <p>
          <b>${user.name}</b><br/>
          ${statusText}${difficultyText}
        </p>
      `;

            container.appendChild(playerDiv);
        });
    }

    formatDifficulty(byte) {
        const level = ((byte >> 4) & 0x0f) + 1; // 0-4 displayed as 1-5
        const speed = (byte & 0x0f) === 1 ? 'High' : 'Low';
        return `Lv ${level} / ${speed}`;
    }

    // Connection handling
    handleConnectClick() {
        this.serial = new Serial();
        this.setState(this.StateConnecting);

        this.serial.getDevice().then(() => {
            console.log("USB connected, updating status.");
            this.setState(this.StateConnectingYoshi);
            this.attemptYoshiConnection();
        }).catch(c => {
            console.log("Connection cancelled or failed");
            this.setState(this.StateConnect);
        });
    }

    attemptYoshiConnection() {
        console.log("Attempt connection...");
        this.serial.sendHex("01");
        this.serial.readHex(64).then(result => {
            if (result === "02") {
                console.log("SUCCESS!");
                // Series counters reset on every fresh handshake
                this.winsThisSeries = 0;
                this.lossesThisSeries = 0;
                this.needsRehandshake = false;
                // Start polling the GB for difficulty selection. The timer
                // runs continuously (across mode-select / lobby / matchmaking)
                // until a game starts or the user disconnects.
                this.difficultyTimerActive = true;
                this.startDifficultyTimer();
                // If we got here from a rematch flow, jump straight back into
                // matchmaking; otherwise land on the mode-select menu.
                if (this.isMatchmaking) {
                    this.handleFindMatch();
                } else {
                    this.setState(this.StateModeSelect);
                }
            } else {
                console.log("Fail");
                setTimeout(() => {
                    this.attemptYoshiConnection();
                }, 100);
            }
        },
            error => {
                this.currentState = this.StateError;
                document.getElementById('error-message').textContent = error;
                this.updateUI();
                console.log("ERROR");
                console.log(error);
            });
    }

    startDifficultyTimer() {
        setTimeout(() => {
            if (!this.difficultyTimerActive) {
                return;
            }
            this.serial.sendHex("00");
            this.serial.read(1).then(result => {
                if (!this.difficultyTimerActive) return;
                var byte = result.data.getUint8(0);
                if (byte !== this.localDifficulty) {
                    this.localDifficulty = byte;
                    var label = this.formatDifficulty(byte);
                    document.querySelectorAll('.js-difficulty-display').forEach(el => {
                        el.textContent = label;
                    });
                    if (this.gb) this.gb.sendDifficulty(byte);
                }
                this.startDifficultyTimer();
            });
        }, 100);
    }

    // Mode selection handlers
    handleFindMatch() {
        console.log("Find Match clicked");
        this.isMatchmaking = true;
        this.name = document.getElementById('username')?.value || this.generateName();
        this.setState(this.StateMatchmaking);
        this.gb = GBWebsocket.findMatch(this.name);
        this.setGbCallbacks();
    }

    handlePrivateLobby() {
        console.log("Private Lobby clicked");
        this.isMatchmaking = false;
        this.setState(this.StateSelectGame);
    }

    handleCancelMatchmaking() {
        console.log("Cancel matchmaking");
        if (this.gb) {
            this.gb.cancelMatchmaking();
            this.gb = null;
        }
        this.setState(this.StateModeSelect);
    }

    handleRematch() {
        console.log("Rematch - reinitializing Yoshi connection");
        if (this.gb) {
            this.gb._closedByUs = true;
            this.gb.ws.close();
            this.gb = null;
        }
        this.isMatchmaking = true;
        this.setState(this.StateConnectingYoshi);
        this.attemptYoshiConnection();
    }

    handleLeaveLobby() {
        console.log("Leaving lobby");
        if (this.gb) {
            this.gb._closedByUs = true;
            this.gb.ws.close();
            this.gb = null;
        }
        this.gameLoopActive = false;
        // Don't touch difficultyTimerActive: pre-game it's already running,
        // post-game the GB is on its match-result screen waiting for 0x55,
        // not on the difficulty menu — polling 0x00 there isn't meaningful.
        // Re-handshake (Reconnect Game Boy) is the path back to selection.
        this.setState(this.StateModeSelect);
    }

    handleReinitGameboy() {
        console.log("Reconnecting Game Boy");
        this.setState(this.StateConnectingYoshi);
        this.attemptYoshiConnection();
    }

    handleBackToMenu() {
        console.log("Back to menu - reinitializing Yoshi connection");
        if (this.gb) {
            this.gb._closedByUs = true;
            this.gb.ws.close();
            this.gb = null;
        }
        this.isMatchmaking = false;
        this.setState(this.StateConnectingYoshi);
        this.attemptYoshiConnection();
    }

    // Game creation/joining
    handleCreateGame(name) {
        console.log("Create new game");
        console.log(name);
        this.isAdmin = true;
        this.name = name;
        this.setState(this.StateJoiningGame);
        this.gb = GBWebsocket.initiateGame(name);
        this.setGbCallbacks();
    }

    handleJoinGame(name, gameCode) {
        if (!gameCode || gameCode.length < 1 || gameCode.length > 4) {
            console.error('not a valid input. must have length 1-4');
            return;
        }
        // Clear any previous error message
        var joinError = document.getElementById('join-error');
        if (joinError) joinError.style.display = 'none';
        console.log("Join game");
        console.log(name);
        console.log(gameCode);
        this.isAdmin = false;
        this.name = name;
        this.gameCode = gameCode;
        this.setState(this.StateJoiningGame);
        this.gb = GBWebsocket.joinGame(name, gameCode);
        this.setGbCallbacks();
    }

    setGbCallbacks() {
        this.gb.onconnected = this.gbConnected.bind(this);
        this.gb.oninfoupdate = this.gbInfoUpdate.bind(this);
        this.gb.ongamestart = this.gbGameStart.bind(this);
        this.gb.ongameupdate = this.gbGameUpdate.bind(this);
        this.gb.ongameend = this.gbGameEnd.bind(this);
        this.gb.onuserinfo = this.gbUserInfo.bind(this);
        this.gb.onlines = this.gbLines.bind(this);
        this.gb.onwin = this.gbWin.bind(this);
        this.gb.onlose = this.gbLose.bind(this);
        this.gb.onerror = this.gbError.bind(this);
        this.gb.onmatchfound = this.gbMatchFound.bind(this);
        this.gb.onopponentdisconnect = this.gbOpponentDisconnect.bind(this);
        this.gb.onplayerready = this.gbPlayerReady.bind(this);
        this.gb.oncountdownstarted = this.gbCountdownStarted.bind(this);
    }

    // WebSocket callbacks
    gbConnected(gb) {
        console.log("We're connected!");
        console.log(gb.users);
        this._handlingDisconnect = false;
        // Tell the server our chosen difficulty so other players see it on
        // their lobby roster. Safe to call on every (re)connect.
        gb.sendDifficulty(this.localDifficulty);
        // For matchmaking, stay on the "Finding Opponent..." screen
        // until match_found arrives with actual game data
        if (this.isMatchmaking) {
            return;
        }
        this.gameCode = gb.game_name;
        this.users = gb.users;
        this.setState(this.StateLobby);
    }

    gbInfoUpdate(gb) {
        console.log("Got game update.");
        console.log(gb.users);
        this.gameCode = gb.game_name;
        this.users = gb.users;
        this.isAdmin = gb.admin;

        // Check if game ended (status 2 = finished)
        // This handles the case where we didn't receive an explicit win/lose message
        if (gb.game_status === gb.GAME_STATE_FINISHED && this.currentState === this.StateInGame) {
            console.log("Game ended via status update - transitioning to Finished");
            this.setState(this.StateFinished);
        } else {
            this.updateUI();
        }
    }

    gbUserInfo(gb) {
        console.log("userinfo");
        this.uuid = gb.uuid;
    }

    gbError(gb, errorMsg) {
        console.error("Game error:", errorMsg);
        // If lobby not found, show a friendly message and return to join screen
        if (errorMsg === "Game not found." || errorMsg === "Cannot join game") {
            if (this.gb) {
                this.gb._closedByUs = true;
                this.gb.ws.close();
                this.gb = null;
            }
            this.setState(this.StateSelectGame);
            var joinError = document.getElementById('join-error');
            if (joinError) {
                joinError.textContent = 'Lobby not found. Please check the code and try again.';
                joinError.style.display = 'block';
            }
            return;
        }
        document.getElementById('error-message').textContent = errorMsg;
        this.setState(this.StateError);
    }

    gbMatchFound(gb) {
        console.log("Match found!");
        console.log(gb.users);
        this._handlingDisconnect = false;
        this.gameCode = gb.game_name;
        this.users = gb.users;
        this.isAdmin = gb.admin;
        // The matchmaking wait loop on the server discards messages other
        // than cancel_matchmaking, so the difficulty we sent in gbConnected
        // was dropped. Re-send now that we're in an active game.
        gb.sendDifficulty(this.localDifficulty);
        // Go straight to in-game - matchmaking auto-starts the game
        // The game will start via gbGameStart callback
        this.setState(this.StateLobby);
    }

    gbOpponentDisconnect(gb) {
        // Guard against being called twice (from opponent_disconnect msg AND onclose)
        if (this._handlingDisconnect) return;
        this._handlingDisconnect = true;
        console.log("Opponent disconnected!");

        // Clear any running countdown
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        const wasInGame = this.currentState === this.StateInGame;

        // If we were mid-game, drive the win handshake on the local GB
        // (sending 0x80 until the GB leaves win-state). Don't stop the
        // game loop — it owns the byte-exchange cadence.
        if (wasInGame && !this.winPending && !this.lossPending && !this.forceLossPending) {
            this.winPending = true;
            this.winTickCount = 0;
        }
        if (!wasInGame) {
            this.gameLoopActive = false;
        }

        if (!this.isMatchmaking) {
            // Private lobby: server's "win" message will follow. Loop will
            // finalize the win and transition to Finished.
            return;
        }

        // Matchmaking: server deliberately skips the "win" message on
        // opponent disconnect, but the loop's win-handshake completion
        // (in startGameTimer) still increments winsThisSeries — same path
        // as a normal win. Just close the WS and auto-reconnect.
        if (this.gb) {
            this.gb._closedByUs = true;
            this.gb.ws.close();
            this.gb = null;
        }

        const reconnect = () => {
            this.setState(this.StateMatchmaking);
            this.gb = GBWebsocket.findMatch(this.name);
            this.setGbCallbacks();
        };

        if (wasInGame) {
            this.setState(this.StateOpponentDisconnect);
            setTimeout(reconnect, 5000);
        } else {
            reconnect();
        }
    }

    gbGameStart(gb) {
        console.log("Got game start.");

        // Clear any running countdown from ready-up
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        // Reset per-round protocol state. Stop the difficulty poller — the
        // GB's serial register is now driven by gameplay, not selection bytes.
        this.difficultyTimerActive = false;
        this.gameLoopActive = false;
        this.height = 0;
        this.hatchQueue = [];
        this.lastSentMaxSlots = 0;
        this.lossPending = false;
        this.winPending = false;
        this.winTickCount = 0;
        this.forceLossPending = false;
        this._handlingDisconnect = false;

        for (var user of this.users) {
            user.height = 0;
        }

        this.setState(this.StateInGame);
        this.updateInGameUI();
        this.gb.sendHeight(0);

        // Yoshi: a single 0x55 starts each round. Both clients send it to
        // their own slave GB; the GBs coordinate the round start internally.
        this.serial.clearBuffer();
        this.serial.bufSendHex("55", 50);

        setTimeout(() => {
            this.gameLoopActive = true;
            this.startGameTimer();
        }, 500);
    }

    gbGameUpdate(gb) {
        console.log("game update");
    }

    gbGameEnd(gb) {
        console.log("game end");
    }

    gbLines(gb, size) {
        // Server relays opponent hatch events as `lines` with size 0-7.
        // Translate to 0x40-0x47 and queue one send to the local GB.
        // Size 0 is the smallest Yoshi (top+bottom only, clears no slots)
        // and still needs to be forwarded as an offensive move.
        if (this.currentState !== this.StateInGame) {
            console.log("Ignoring hatch - game not in progress");
            return;
        }
        if (size < 0 || size > 7) {
            console.log("Ignoring out-of-range hatch size:", size);
            return;
        }
        console.log("Queue hatch size", size);
        this.hatchQueue.push(0x40 | size);
    }

    gbWin(gb) {
        console.log("WIN! Starting win-handshake to local GB.");
        // Don't transition yet. Trigger the loop to send 0x80 to the
        // local GB until it leaves its win-state (no longer C3/81). The
        // win handshake completion (in startGameTimer) will increment
        // winsThisSeries and setState(Finished).
        if (!this.winPending && !this.lossPending && !this.forceLossPending) {
            this.winPending = true;
            this.winTickCount = 0;
        }
    }

    gbLose(gb) {
        // Server says opponent won (sent reached_30_lines because they
        // cleared all slots). Drive our local GB into loss-state by
        // sending 0xC3; once GB responds with 0x80 we hand off to
        // the existing lossPending ack handshake.
        console.log("Server says we lost - entering force-loss handshake");
        if (!this.forceLossPending && !this.lossPending && !this.winPending) {
            this.forceLossPending = true;
        }
    }

    updateSlots(slots) {
        if (this.height !== slots) {
            console.log("Slot count changed:", slots);
            this.height = slots;
            if (this.gb) this.gb.sendHeight(slots);
        }
    }

    startGameTimer() {
        setTimeout(() => {
            if (!this.gameLoopActive) {
                console.log("Game loop stopped");
                return;
            }

            // Decide what byte to send to the local GB this tick.
            // Priority: loss-ack 0x81 > force-loss 0xC3 > win-ack 0x80 >
            // hatch > changed max-slots > idle 0x00. End-of-round
            // handshakes are BGB-debugged byte sequences driven by the loop.
            let byteToSend;
            if (this.lossPending) {
                byteToSend = 0x81;
            } else if (this.forceLossPending) {
                byteToSend = 0xC3;
            } else if (this.winPending) {
                byteToSend = 0x80;
            } else if (this.hatchQueue.length > 0) {
                byteToSend = this.hatchQueue.shift();
                console.log("Sending hatch byte to GB:", byteToSend.toString(16));
            } else {
                var maxSlots = 0;
                if (this.gb) {
                    var aliveOpponents = this.gb.getOtherUsers().filter(u => u.state === this.STATE_ALIVE);
                    for (var u of aliveOpponents) {
                        var h = u.height || 0;
                        if (h > maxSlots) maxSlots = h;
                    }
                }
                if (maxSlots > 28) maxSlots = 28;
                if (maxSlots !== this.lastSentMaxSlots) {
                    byteToSend = 0x20 + maxSlots;
                    this.lastSentMaxSlots = maxSlots;
                    console.log("Sending max-slots update to GB:", byteToSend.toString(16));
                } else {
                    byteToSend = 0x00;
                }
            }

            this.serial.send(new Uint8Array([byteToSend]));
            this.serial.read(64).then(result => {
                if (!this.gameLoopActive) {
                    return;
                }
                // The firmware can buffer multiple GB slave-out bytes between
                // our reads (e.g. slot-count transitions during animation).
                // Process every byte; handshake states use the last byte for
                // their transition check.
                var bytes = new Uint8Array(result.data.buffer);
                if (bytes.length === 0) {
                    if (this.gameLoopActive) this.startGameTimer();
                    return;
                }
                var lastByte = bytes[bytes.length - 1];

                // -- End-of-round handshake handling --

                if (this.lossPending) {
                    // We replied 0x81 this tick. Keep replying until the GB
                    // stops sending 0x80 — that's our signal that the GB has
                    // counted enough acks and transitioned to its loss screen.
                    if (lastByte !== 0x80) {
                        console.log("Loss handshake complete (GB stopped sending 0x80)");
                        this.lossPending = false;
                        this.gameLoopActive = false;
                        this.lossesThisSeries++;
                        if (this.gb) this.gb.sendDead();
                        this.setState(this.StateFinished);
                        if (this.lossesThisSeries >= 3) {
                            this.needsRehandshake = true;
                            this.performSeriesEndRehandshake();
                        }
                        return;
                    }
                    if (this.gameLoopActive) this.startGameTimer();
                    return;
                }

                if (this.forceLossPending) {
                    // We sent 0xC3 to make the GB think the peer won. Once
                    // the GB transitions to loss-state it starts sending 0x80;
                    // hand off to the existing lossPending ack handshake.
                    var sawLoss = false;
                    for (var i = 0; i < bytes.length; i++) {
                        if (bytes[i] === 0x80) { sawLoss = true; break; }
                    }
                    if (sawLoss) {
                        console.log("Force-loss complete - GB now in loss-state");
                        this.forceLossPending = false;
                        this.lossPending = true;
                    }
                    if (this.gameLoopActive) this.startGameTimer();
                    return;
                }

                if (this.winPending) {
                    // We just sent 0x80 this tick. The protocol minimum is
                    // three acked exchanges; after that we wait for the GB
                    // to leave its win-state (no longer responding C3 or 81).
                    // Both paths converge here: remote-win flows through 0x81
                    // ticks, local-win flows through 0xC3 ticks.
                    this.winTickCount++;
                    const stillInWinState = (lastByte === 0xC3 || lastByte === 0x81);
                    const handshakeDone = this.winTickCount >= 3 && !stillInWinState;
                    const timedOut = this.winTickCount >= 30; // ~3s safety
                    if (handshakeDone || timedOut) {
                        if (timedOut) console.warn("Win handshake timed out at tick " + this.winTickCount);
                        else console.log("Win handshake complete after " + this.winTickCount + " ticks");
                        this.winPending = false;
                        this.winTickCount = 0;
                        this.gameLoopActive = false;
                        this.winsThisSeries++;
                        // Don't override an OpponentDisconnect screen that
                        // gbOpponentDisconnect set; let it run its 5s timer.
                        if (this.currentState !== this.StateOpponentDisconnect) {
                            this.setState(this.StateFinished);
                        }
                        if (this.winsThisSeries >= 3) {
                            this.needsRehandshake = true;
                            this.performSeriesEndRehandshake();
                        }
                        return;
                    }
                    if (this.gameLoopActive) this.startGameTimer();
                    return;
                }

                // -- Normal in-round handling: process EVERY byte --
                // The firmware can pack several slot/hatch/idle bytes into
                // one read when the GB has been emitting faster than 100ms.
                for (var i = 0; i < bytes.length; i++) {
                    var value = bytes[i];
                    if (value === 0x00 || value === 0x81) {
                        // idle / residual win-ack byte — silently ignore
                    } else if (value >= 0x21 && value <= 0x3C) {
                        // local slot count update (0x21=1 slot ... 0x3C=28 slots)
                        this.updateSlots(value - 0x20);
                    } else if (value >= 0x40 && value <= 0x47) {
                        // local player hatched a yoshi of size (value & 0x0f);
                        // size 0 (0x40) is the smallest yoshi and clears no slots
                        // but is still an offensive move to forward to opponents.
                        var hatchSize = value & 0x0f;
                        console.log("Local hatch size:", hatchSize);
                        if (this.gb) this.gb.sendLines(hatchSize);
                    } else if (value === 0x80) {
                        // Local GB lost. Enter the loss-ack handshake; subsequent
                        // ticks reply 0x81 until the GB stops sending 0x80.
                        console.log("Local GB lost - entering loss handshake");
                        this.lossPending = true;
                        break;
                    } else if (value === 0xC3) {
                        // Local GB won (cleared all slots). Tell the server so
                        // the opponent gets a reached_30_lines, then enter the
                        // win-ack handshake to feed our own GB its 0x80 acks.
                        console.log("Local GB won - entering win handshake");
                        if (this.gb) this.gb.sendReached30Lines();
                        if (!this.winPending && !this.lossPending && !this.forceLossPending) {
                            this.winPending = true;
                            this.winTickCount = 0;
                        }
                        break;
                    } else {
                        console.log("Unhandled byte from GB:", value.toString(16));
                    }
                }

                if (this.gameLoopActive) this.startGameTimer();
            });
        }, 100);
    }

    performSeriesEndRehandshake() {
        // After 3 wins or 3 losses the GB has stopped at a series-end
        // screen. Per BGB notes: wait ~1s, send 0x55 (returns GB to main
        // menu), then start the 0x01/0x02 handshake (returns GB to
        // difficulty-select). Once the 0x02 reply arrives the user has
        // until the next round starts to change their difficulty.
        console.log("Series-end rehandshake scheduled (1s delay)");
        setTimeout(() => {
            if (!this.needsRehandshake) {
                console.log("Series-end rehandshake aborted (flag cleared)");
                return;
            }
            console.log("Series-end: sending 0x55 to leave the win/loss screen");
            this.serial.clearBuffer();
            this.serial.bufSendHex("55", 50);
            // Give the buffered 0x55 time to flush before driving 0x01/0x02
            setTimeout(() => {
                if (!this.needsRehandshake) return;
                this.attemptSeriesEndHandshake();
            }, 300);
        }, 1000);
    }

    attemptSeriesEndHandshake() {
        if (!this.needsRehandshake) return;
        this.serial.sendHex("01");
        this.serial.readHex(64).then(result => {
            if (!this.needsRehandshake) return;
            if (result === "02") {
                console.log("Series-end rehandshake SUCCESS - GB on difficulty screen");
                this.winsThisSeries = 0;
                this.lossesThisSeries = 0;
                this.needsRehandshake = false;
                // Re-enable the difficulty poller; the user can now tweak
                // level/speed on the GB until the next round starts.
                this.difficultyTimerActive = true;
                this.startDifficultyTimer();
                // Re-render the Finished screen so any "Next" button that
                // was gated on the rehandshake becomes available.
                if (this.currentState === this.StateFinished) {
                    this.updateUI();
                }
            } else {
                setTimeout(() => this.attemptSeriesEndHandshake(), 100);
            }
        }, error => {
            console.error("Series-end rehandshake transferIn error:", error);
            setTimeout(() => this.attemptSeriesEndHandshake(), 100);
        });
    }

    handleStartGame() {
        // Series-end rehandshake (0x55 + 0x01/0x02) auto-runs on the way to
        // StateFinished. If it's still in flight when the user clicks, just
        // wait — the Finished-screen "Next" button is gated on this flag too.
        if (this.needsRehandshake) {
            console.log("Rehandshake still in progress, ignoring start click");
            return;
        }
        this.gb.sendStart();
        this.setState(this.StateStartingGame);
    }

    handleReadyNext() {
        if (this.needsRehandshake) {
            console.log("Rehandshake still in progress, ignoring ready-next click");
            return;
        }
        this.gb.sendReadyNext();
        document.getElementById('btn-ready-next').disabled = true;
        document.getElementById('btn-ready-next').textContent = 'Waiting for opponent...';
    }

    gbPlayerReady(gb, uuid) {
        var readyUser = this.users.find(u => u.uuid === uuid);
        var name = readyUser ? readyUser.name : 'A player';
        document.getElementById('finished-ready-status').textContent = name + ' is ready!';
    }

    gbCountdownStarted(gb, seconds) {
        var countdown = seconds;
        var countdownEl = document.getElementById('finished-countdown');
        countdownEl.style.display = 'block';
        countdownEl.textContent = 'Game starting in ' + countdown + 's...';

        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        this.countdownInterval = setInterval(() => {
            countdown--;
            if (countdown <= 0) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                countdownEl.textContent = 'Starting...';
            } else {
                countdownEl.textContent = 'Game starting in ' + countdown + 's...';
            }
        }, 1000);
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new OnlineYoshi();
});
