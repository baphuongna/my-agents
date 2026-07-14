# mya gateway — systemd deployment

## Quick start

```bash
# 1. Copy service file
sudo cp deploy/mya-gateway.service /etc/systemd/system/

# 2. Edit to add your API keys
sudo nano /etc/systemd/system/mya-gateway.service

# 3. Reload + enable + start
sudo systemctl daemon-reload
sudo systemctl enable mya-gateway
sudo systemctl start mya-gateway

# 4. Check status
sudo systemctl status mya-gateway
```

## Commands

```bash
# View logs (real-time)
sudo journalctl -u mya-gateway -f

# View last 50 lines
sudo journalctl -u mya-gateway -n 50

# Restart after config change
sudo systemctl restart mya-gateway

# Stop
sudo systemctl stop mya-gateway

# Disable (remove from boot)
sudo systemctl disable mya-gateway
```

## Configuration

Edit the service file to set:
- **API keys**: Uncomment `MINIMAX_API_KEY`, `OPENAI_API_KEY`, etc.
- **Port**: Change `MYA_PORT` and `--port`
- **Model**: Change `MYA_MODEL`
- **Channels**: Uncomment `TELEGRAM_BOT_TOKEN`, etc.

After editing:
```bash
sudo systemctl daemon-reload
sudo systemctl restart mya-gateway
```

## Endpoints

Once running, the gateway is available at:
- **Web dashboard**: http://localhost:3000/
- **API**: http://localhost:3000/status
- **Health**: http://localhost:3000/health/live
- **WebSocket**: ws://localhost:3000/events
