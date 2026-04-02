# Ithildin Cloud

A hosted service that processes your Obsidian vault while you sleep.

You dump unstructured text into your daily note throughout the day — links, thoughts, tasks, names, half-formed ideas. Twice a day, Ithildin reads your vault, structures your daily note, fetches and archives any linked articles or products, and generates three files: a digest of what's happening, non-obvious connections between your notes, and gaps in your thinking you haven't written about yet.

It syncs with your vault via [Obsidian Headless](https://github.com/obsidianmd/obsidian-headless) and processes it via the Claude API. You bring your own Anthropic API key. Your vault data stays in your Obsidian Sync account — Ithildin is just a processing layer.

Built on [Ithildin](https://github.com/gonsalves/ithildin), the open-source second brain system.

## Hosting

Requires a VPS with Docker and Docker Compose. A small instance (2 vCPU, 4GB RAM) handles 20+ users comfortably.

```bash
# Clone and configure
git clone git@github.com:gonsalves/ithildin-cloud.git
cd ithildin-cloud
cp .env.example .env

# Generate secrets
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env

# Set your domain in the Caddyfile
nano Caddyfile

# Start
docker compose up -d
```

Caddy handles HTTPS automatically. The app runs on port 3000 behind the reverse proxy.

Point your DNS to the VPS IP, then open your domain to sign up.
