# GB-Yoshi-Web

Web frontend for online Game Boy Yoshi multiplayer. Connects to a Game Boy via WebUSB and to the game server via WebSockets.

## Requirements

- Chrome or Edge browser (for WebUSB support)
- [GBLink firmware](https://github.com/starlarkus/GBLink-Firmware) or [reconfigurable firmware (legacy)](https://github.com/starlarkus/gb-link-firmware-reconfigurable)
- Game Boy with Yoshi cartridge

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

## Auto-start

```bash
apt install screen
chmod +x server/startdetached.sh
crontab -e
@reboot ~/gb-yoshi-web/server/startdetached.sh
```

Access the running server window with `screen -r yoshiserver`
