# DigitalOcean Deployment

This project is easiest to deploy as a single-host Docker Compose stack on a DigitalOcean Droplet.

## Why this layout

The app currently needs:

- Django web app
- a separate grading worker
- MySQL
- shared local media storage for submissions, test bundles, logs, and grading artifacts
- Java tooling inside the app image for grading Java submissions

That makes a single VPS with shared Docker volumes the cleanest first deployment.

## Recommended server

- Ubuntu 24.04 LTS
- 4 vCPU
- 8 GB RAM
- 80 GB SSD or more

## Services in `compose.yaml`

- `db`: MySQL 8
- `backend`: Django + Gunicorn
- `worker`: grading worker loop
- `caddy`: reverse proxy, HTTPS, frontend static hosting, `/media` and `/static` serving

## First-time server setup

Install Docker and the Compose plugin:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in after adding your user to the `docker` group.

## App setup

Clone the repo and create the production env file:

```bash
git clone <your-repo-url> CAPSTON
cd CAPSTON
cp .env.production.example .env
```

Update `.env` with:

- `SITE_ADDRESS`
- `APP_DOMAIN`
- `DJANGO_SECRET_KEY`
- `DJANGO_ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- MySQL passwords

Use:

- `SITE_ADDRESS=http://<server-ip>` while testing on a raw IP
- `SITE_ADDRESS=gradeforge.example.com` once DNS is pointing at a real domain

## DNS

Point your domain or subdomain A record to the Droplet IP.

Example:

- `gradeforge.example.com -> <droplet-ip>`

## Start the stack

```bash
docker compose up -d --build
```

## Initialize the app

Run database migrations, seed languages, and create an admin account:

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_languages
docker compose exec backend python manage.py createsuperuser
```

## Update the app

```bash
git pull
docker compose up -d --build
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py collectstatic --noinput
```

## Backups

At minimum, back up:

- MySQL data
- the `media_data` Docker volume

Without `media_data`, you lose submissions, uploaded test bundles, logs, and generated grading artifacts.

## Important security note

The grading worker executes student code. This stack is good for a first deployment, but it is not the final hardening target.

Later improvements should include:

- moving media to object storage
- isolating the worker on a separate host or runtime
- tighter OS/container restrictions around grading execution
- external database backups and monitoring
