#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${NC}"
    echo "Install it with: brew install jq"
    exit 1
fi

# Check if version argument is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Version argument is required${NC}"
    echo "Usage: ./release.sh <version>"
    echo "Example: ./release.sh 1.0.6"
    exit 1
fi

VERSION="$1"

# Validate version format (basic semver check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Error: Version must be in format x.y.z (e.g., 1.0.6)${NC}"
    exit 1
fi

echo -e "${GREEN}Starting release process for version $VERSION${NC}"

# Step 1: Update version in package.json
echo -e "${BLUE}Updating package.json...${NC}"
jq --arg version "$VERSION" '.version = $version' package.json > package.json.tmp && mv package.json.tmp package.json
echo -e "${GREEN}package.json updated successfully${NC}"

# Step 2: Update version in tauri.conf.json
echo -e "${BLUE}Updating tauri.conf.json...${NC}"
jq --arg version "$VERSION" '.version = $version' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
echo -e "${GREEN}tauri.conf.json updated successfully${NC}"

# Step 3: Prompt for release notes
echo -e "${BLUE}Enter release notes for version $VERSION:${NC}"
read -r NOTES
if [ -z "$NOTES" ]; then
    NOTES="Release version $VERSION"
fi

# Step 4: Update updater.json
echo -e "${BLUE}Updating updater.json...${NC}"
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

jq --arg version "$VERSION" \
   --arg notes "$NOTES" \
   --arg pub_date "$PUB_DATE" '
   .version = $version |
   .notes = $notes |
   .pub_date = $pub_date |
   .platforms."windows-x86_64".url = "https://github.com/maciej-trebacz/ff7-lgp-explorer/releases/download/v\($version)/FF7.LGP.Explorer_\($version)_x64-setup.exe" |
   .platforms."darwin-x86_64".url = "https://github.com/maciej-trebacz/ff7-lgp-explorer/releases/download/v\($version)/FF7.LGP.Explorer_x64.app.tar.gz" |
   .platforms."darwin-aarch64".url = "https://github.com/maciej-trebacz/ff7-lgp-explorer/releases/download/v\($version)/FF7.LGP.Explorer_aarch64.app.tar.gz" |
   .platforms."linux-x86_64".url = "https://github.com/maciej-trebacz/ff7-lgp-explorer/releases/download/v\($version)/FF7.LGP.Explorer_\($version)_amd64.AppImage"
' updater.json > updater.json.tmp && mv updater.json.tmp updater.json
echo -e "${GREEN}updater.json updated successfully${NC}"

# Step 5: Git operations
echo -e "${BLUE}Committing changes...${NC}"

git add package.json src-tauri/tauri.conf.json updater.json

git commit -m "Release version $VERSION"
echo -e "${GREEN}Changes committed successfully${NC}"

echo -e "${BLUE}Creating tag v$VERSION...${NC}"
git tag "v$VERSION"
echo -e "${GREEN}Tag created successfully${NC}"

echo -e "${BLUE}Pushing commit and tag...${NC}"
git push origin main
git push origin "v$VERSION"
echo -e "${GREEN}Push completed successfully${NC}"

echo ""
echo -e "${GREEN}Release v$VERSION completed successfully!${NC}"
echo -e "${BLUE}Create a GitHub release at: https://github.com/maciej-trebacz/ff7-lgp-explorer/releases/new?tag=v$VERSION${NC}"
