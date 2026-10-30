# GB-Yoshi-Web

Web frontend for online Game Boy Yoshi multiplayer. Connects to a Game Boy via WebUSB or WebSerial, or runs Yoshi in the browser, and to the game server via WebSockets.

## Requirements

- Chrome or Edge browser (for WebUSB support)
- [GB-Link firmware](https://github.com/starlarkus/GBLink-Firmware) or [reconfigurable firmware (legacy)](https://github.com/starlarkus/gb-link-firmware-reconfigurable)
- Game Boy with Yoshi cartridge, or your Yoshi ROM to play in the browser

## Playing in the browser (no Game Boy needed)

- Press **Use emulator** instead of Connect USB and choose your Yoshi ROM (.gb). The game runs on the left of the page (above it on phones), and the site links up with it just as with a Game Boy on the adapter. Your ROM stays on your device.
- Pick your level and speed on the game's screen, then find a match or create or join a private lobby as usual.
- You play with players on real Game Boys and with other emulator players alike.
- Keys: arrows, X or A for A, Z or S for B, Enter for Start, Shift for Select. Gamepads work too, and phones get on-screen buttons. The buttons above the screen switch the sound and fullscreen.
- The browser keeps the ROMs you load, so next time the game is one click away under **Kept in this browser**. **Change game** pauses the game and shows that list. **Reset** restarts the game like switching the Game Boy off and on, and **Close** stops the emulator. These three wait while a match is on.
- It also works in browsers that can't use the USB adapter, such as phone browsers.
- Supported ROMs: Yoshi (USA) and Mario & Yoshi (Europe).
- The emulator is [mGBA](https://mgba.io) 0.10.5 by Jeffrey Pfau and contributors, used under the Mozilla Public License 2.0 (`emulator/LICENSE-mGBA.txt`). Its source is at [github.com/mgba-emu/mgba](https://github.com/mgba-emu/mgba/tree/0.10.5).

## HTTPS Note

WebUSB requires HTTPS. For local development, `localhost` is allowed without HTTPS but will only allow connections to a ws:// backend server

## Configuration

WebSocket server settings are in `js/gbwebsocket.js`:

## Troubleshooting
- Currently when refreshing the web page most of the time the pico/usb device needs to be reset. Unplugging or pressing reset on the USB adapter should acomplish this
- If on linux you may need to edit Udev rules. See here https://stackoverflow.com/questions/30983221/chrome-app-fails-to-open-usb-device

---

# Backend Server

WebSocket server for this client lives in the `server/` subdirectory.

## Requirements

- **Python 3.11+**
- **SSL/TLS**: Server must either be configured with an SSL certificate or run behind a reverse proxy with SSL termination (recommended)
  > Browsers require `wss://` for WebSocket connections from `https://` pages — plain `ws://` will be blocked.

## Installation

From a clean Debian environment:

```bash
# Install dependencies
apt install python3 python3-pip git

# Install Python packages
pip install websockets

# Clone and run
cd ~
git clone --depth 1 https://github.com/starlarkus/gb-yoshi-web
cd gb-yoshi-web/server
python3 server.py
```

## Usage

The server runs on port `5678` by default. Configure your reverse proxy (nginx, caddy, etc.) to forward WebSocket connections to this port. If running alongside the gb-tetris-server on the same host, change the port in `server.py` (`websockets.serve(... 5678 ...)`) to a free port (e.g. `5679`).

Copy `server/template.env` to `server/.env`. `REPORT_TOKEN` is the shared secret for `GET` status reports on WebSocket path `/report`. If it is missing or blank, `/report` does not exist (HTTP 404 before the handshake). A request is `{"type":"get_report","token":"..."}`.

## Auto-start

```bash
apt install screen
chmod +x server/startdetached.sh
crontab -e
@reboot ~/gb-yoshi-web/server/startdetached.sh
```

Access the running server window with `screen -r yoshiserver`
