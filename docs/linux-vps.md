# Linux VPS deployment

This setup assumes the repository is installed at `/opt/42space` and runs under a dedicated `42space` user. Use a small hot wallet only.

## 1. Prepare the server

```bash
sudo adduser --system --group --home /opt/42space 42space
sudo mkdir -p /opt/42space /etc/42space
sudo chown -R 42space:42space /opt/42space
```

Install Node.js 20+ or 22+ using your VPS package manager or NodeSource. Then deploy the repo into `/opt/42space` and install dependencies:

```bash
cd /opt/42space
sudo -u 42space npm ci
sudo -u 42space npm run check
sudo -u 42space mkdir -p data
sudo -u 42space touch data/bot-config.env
sudo chmod 600 data/bot-config.env
```

## 2. Configure secrets

Create the real environment file on the VPS:

```bash
sudo install -m 700 -o root -g root -d /etc/42space
sudo cp /opt/42space/ops/event-bot.env.example /etc/42space/event-bot.env
sudo chmod 600 /etc/42space/event-bot.env
sudo nano /etc/42space/event-bot.env
```

Fill in `PRIVATE_KEY`, `WALLET_ADDRESS`, `BSC_RPC_URL`, `BSC_WS_URL`, `DASHBOARD_PASSWORD`, and `DASHBOARD_AUTH_SECRET`. Do not commit this file.

This deployment template has `DRY_RUN=0`, `EXECUTE=1`, and `AUTO_SELL_ENABLED=1`. Per-strategy automatic exits are controlled separately, for example `AUTO_SELL_ORIGINAL_ENABLED`, `AUTO_SELL_FIXED_TRAILING_ENABLED`, `AUTO_SELL_ADAPTIVE_TRAILING_ENABLED`, `AUTO_SELL_WEAK_EXIT_ENABLED`, and `AUTO_SELL_BREAKEVEN_ENABLED`.

The dashboard saves non-secret strategy overrides to `/opt/42space/data/bot-config.env`. Both systemd services read that file through `BOT_CONFIG_FILE`, so after changing strategy in the dashboard, restart the event bot service for the running watcher to pick up the new values.

When the watcher starts, it writes a secret-free runtime snapshot to `/opt/42space/data/runtime-status.json`. The dashboard shows this snapshot so you can compare the config file with the values the running watcher actually loaded.

## 3. Preflight before real trading

```bash
cd /opt/42space
sudo bash -lc 'set -a; source /etc/42space/event-bot.env; set +a; cd /opt/42space; sudo -E -u 42space npm run event:doctor'
sudo bash -lc 'set -a; source /etc/42space/event-bot.env; set +a; cd /opt/42space; sudo -E -u 42space npm run event:funding -- --wallet 0xYOUR_WALLET'
sudo bash -lc 'set -a; source /etc/42space/event-bot.env; set +a; cd /opt/42space; sudo -E -u 42space npm run event:preflight'
sudo bash -lc 'set -a; source /etc/42space/event-bot.env; set +a; cd /opt/42space; sudo -E -u 42space npm run event:approve'
```

These commands load the root-owned environment file, then run npm as the unprivileged `42space` user.

## 4. Install systemd services

```bash
sudo cp /opt/42space/ops/42space-event-arm.service /etc/systemd/system/
sudo cp /opt/42space/ops/42space-dashboard.service /etc/systemd/system/
sudo cp /opt/42space/ops/42space-sudoers /etc/sudoers.d/42space-watch-restart
sudo chmod 0440 /etc/sudoers.d/42space-watch-restart
sudo visudo -cf /etc/sudoers.d/42space-watch-restart
sudo systemctl daemon-reload
sudo systemctl enable --now 42space-event-arm
sudo systemctl enable --now 42space-dashboard
```

## 5. Publish the dashboard behind Nginx

Point the DNS record, for example `42.example.com`, to the VPS IP. If Cloudflare proxy is enabled, keep the dashboard bound to `127.0.0.1` and expose only Nginx.

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo cp /opt/42space/ops/nginx-42space.conf /etc/nginx/sites-available/42space
sudo sed -i 's/42.example.com/YOUR_REAL_DOMAIN/g' /etc/nginx/sites-available/42space
sudo sed -i 's#/etc/ssl/cloudflare/example.com.pem#/etc/ssl/cloudflare/YOUR_CERT.pem#g' /etc/nginx/sites-available/42space
sudo sed -i 's#/etc/ssl/cloudflare/example.com.key#/etc/ssl/cloudflare/YOUR_CERT.key#g' /etc/nginx/sites-available/42space
sudo ln -sf /etc/nginx/sites-available/42space /etc/nginx/sites-enabled/42space
sudo nginx -t
sudo systemctl reload nginx
```

The Node dashboard also has its own password gate. Wrong passwords are redirected to `DASHBOARD_AUTH_FAIL_REDIRECT`; correct passwords get an HttpOnly cookie.

Check logs:

```bash
sudo journalctl -u 42space-event-arm -f
sudo journalctl -u 42space-dashboard -f
```

Dashboard binds to `127.0.0.1:4242` by default. Use SSH forwarding:

```bash
ssh -L 4242:127.0.0.1:4242 user@your-vps
```

Then open `http://127.0.0.1:4242` locally.

## Operations

Restart after code or config changes:

```bash
sudo systemctl restart 42space-event-arm
sudo systemctl restart 42space-dashboard
```

Stop trading:

```bash
sudo systemctl stop 42space-event-arm
```

The bot writes state under `/opt/42space/data`.
