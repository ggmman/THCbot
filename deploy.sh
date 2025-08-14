#!/bin/bash

# THC Bot Deployment Script
# Run this from your development directory to deploy changes

echo "🚀 Starting THC Bot deployment..."

# Step 1: Push changes to GitHub
echo "📤 Pushing changes to GitHub..."
git add .
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main

if [ $? -ne 0 ]; then
    echo "❌ Failed to push to GitHub"
    exit 1
fi

echo "✅ Changes pushed to GitHub successfully"

# Step 2: Instructions for Pi deployment
echo ""
echo "🔧 Now run these commands on your Pi:"
echo "   cd /opt/thcbot"
echo "   sudo git pull origin main"
echo "   sudo systemctl restart thcbot.service"
echo "   sudo systemctl status thcbot.service"
echo ""
echo "📝 Or if you have SSH access, you can run:"
echo "   ssh arctic@piserver 'cd /opt/thcbot && sudo git pull origin main && sudo systemctl restart thcbot.service'"
