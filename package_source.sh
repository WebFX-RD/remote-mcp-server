#!/bin/bash

# 1. Name of the output file expected by Cloud Build
OUTPUT_FILE="source.tgz"

# 2. Hardcoded list of files/directories to include
#    Add or remove paths here as needed.
FILES=(
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "tsconfig.json"
  "Procfile"
  "src"
  ".gcloudignore" 
)

echo "📦 Preparing to zip source files..."

# 3. Clean up previous build artifact
if [ -f "$OUTPUT_FILE" ]; then
  rm "$OUTPUT_FILE"
fi

# 4. Check if files exist before trying to tar them (optional safety check)
MISSING_FILES=0
for file in "${FILES[@]}"; do
  if [ ! -e "$file" ]; then
    echo "⚠️  Warning: '$file' not found, skipping."
    MISSING_FILES=1
  else
    echo "   - Including: $file"
  fi
done

# 5. Run the tar command
#    -c: Create archive
#    -z: Compress with GZIP
#    -f: Output file name
tar -czf "$OUTPUT_FILE" "${FILES[@]}"

# 6. Verify success and print next steps
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Successfully created '$OUTPUT_FILE' ($(du -h $OUTPUT_FILE | cut -f1))"
  echo ""
  echo "🚀 To deploy, run:"
  echo "   gcloud builds submit --config cloudbuild.yaml --source $OUTPUT_FILE"
else
  echo "❌ Error: Failed to create tarball."
  exit 1
fi