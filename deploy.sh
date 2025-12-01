#!/bin/bash

gcloud run deploy remote-mcp-server \
--source=. \
--region=us-central1 \
--set-secrets=/etc/secrets/.env.local=REMOTE_MCP_SERVER:latest \
--no-cpu-throttling \
--no-invoker-iam-check \
--max-instances=1 \
--memory=1Gi \
--timeout=3600 \
--set-build-env-vars=NPM_TOKEN=${NPM_TOKEN} \
--set-cloudsql-instances=idyllic-vehicle-159522:us-east1:mcfx,idyllic-vehicle-159522:us-central1:mcfx-revops \
--set-env-vars=LOCALDOMAIN=c.idyllic-vehicle-159522.internal \
--network=default \
--subnet=default
