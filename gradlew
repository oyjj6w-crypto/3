#!/usr/bin/env sh
##############################################################################
# Gradle startup script for POSIX
##############################################################################
APP_HOME=`cd "\`dirname "$0"\`" >/dev/null; pwd`
if command -v gradle >/dev/null 2>&1; then
    exec gradle "$@"
elif [ -f "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" ]; then
    exec java -jar "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" "$@"
else
    echo "Error: Gradle 8.8+ is required. Please install Gradle or open this project in Android Studio." >&2
    exit 1
fi
