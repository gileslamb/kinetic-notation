# Deployment Guide

> **Status:** Sprint 8 — deployment instructions will be finalized then.

## Overview

Kinetic Notation is a static web application with no server-side code. It can be deployed to any static hosting provider.

## Planned Deployment Pipeline

### Phase 1: Render (Static Site)

1. Push to GitHub
2. Connect Render to the repository
3. Configure as a Static Site:
   - **Build command:** (none — no build step)
   - **Publish directory:** `.` (root)
4. Set up custom domain (optional)

### Phase 2: Digital Ocean (App Platform)

1. Migrate from Render to DO App Platform
2. Configure static site deployment
3. Set up CDN and SSL
4. Configure custom domain

## Manual Deployment

Since there's no build step, you can deploy by copying all files to any web server:

```bash
# rsync to a VPS
rsync -avz --exclude='.git' --exclude='node_modules' \
  ./ user@server:/var/www/kinetic-notation/

# Or zip and upload
zip -r kinetic-notation.zip . -x '.git/*' 'node_modules/*' '*.DS_Store'
```

## Environment Considerations

- **HTTPS required** for microphone access (`getUserMedia`)
- **CORS headers** not needed (no external API calls)
- **Cache headers** — set long cache on CSS/JS with cache-busting via query params if needed
