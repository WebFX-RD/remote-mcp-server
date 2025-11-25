#!/bin/bash

gcloud run deploy remote-mcp-server \
--source=. \
--region=us-central1 \
--set-secrets=/etc/secrets/.env.local=REMOTE_MCP_SERVER:latest \
--no-cpu-throttling \
--no-invoker-iam-check \
--max-instances=1 \
--timeout=3600 \
--set-build-env-vars=NPM_TOKEN=${NPM_TOKEN} \
--set-cloudsql-instances=mcfx,mcfx-revops
