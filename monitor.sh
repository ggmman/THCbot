#!/bin/bash

# THC Bot Health Monitor Script
# Add to crontab: */5 * * * * /opt/thcbot/monitor.sh

LOGFILE="/opt/thcbot/logs/health.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Function to log messages
log_message() {
    echo "[$TIMESTAMP] $1" >> "$LOGFILE"
}

# Check if using systemd
if systemctl is-active --quiet thcbot; then
    SERVICE_STATUS="running"
    PROCESS_MANAGER="systemd"
elif command -v pm2 > /dev/null && pm2 describe thcbot > /dev/null 2>&1; then
    if pm2 describe thcbot | grep -q "online"; then
        SERVICE_STATUS="running"
    else
        SERVICE_STATUS="stopped"
    fi
    PROCESS_MANAGER="pm2"
else
    SERVICE_STATUS="unknown"
    PROCESS_MANAGER="unknown"
fi

# Check system resources
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')
DISK_USAGE=$(df -h /opt/thcbot | awk 'NR==2 {print $5}' | sed 's/%//')

# Log status
log_message "Status: $SERVICE_STATUS ($PROCESS_MANAGER) | Memory: ${MEMORY_USAGE}% | CPU: ${CPU_USAGE}% | Disk: ${DISK_USAGE}%"

# Check if bot is not running and attempt restart
if [ "$SERVICE_STATUS" != "running" ]; then
    log_message "WARNING: Bot is not running. Attempting restart..."
    
    if [ "$PROCESS_MANAGER" = "systemd" ]; then
        sudo systemctl restart thcbot
        log_message "Restart attempted via systemd"
    elif [ "$PROCESS_MANAGER" = "pm2" ]; then
        pm2 restart thcbot
        log_message "Restart attempted via PM2"
    fi
fi

# Check high resource usage
if [ "$MEMORY_USAGE" > "80" ]; then
    log_message "WARNING: High memory usage detected: ${MEMORY_USAGE}%"
fi

if [ "$DISK_USAGE" > "90" ]; then
    log_message "WARNING: High disk usage detected: ${DISK_USAGE}%"
fi

# Rotate log if it gets too large (>10MB)
if [ -f "$LOGFILE" ] && [ $(stat -f%z "$LOGFILE" 2>/dev/null || stat -c%s "$LOGFILE") -gt 10485760 ]; then
    mv "$LOGFILE" "${LOGFILE}.old"
    log_message "Log file rotated"
fi
