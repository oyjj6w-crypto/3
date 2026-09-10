#!/usr/bin/env sh
##############################################################################
#
#   Gradle start up script for POSIX generated for TradingMultiView
#
##############################################################################

# Attempt to set APP_HOME
PRG="$0"
while [ -h "$PRG" ] ; do
    ls=`ls -ld "$PRG"`
    link=`expr "$ls" : '.*-> \(.*\)$'`
    if expr "$link" : '/.*' > /dev/null; then
        PRG="$link"
    else
        PRG=`dirname "$PRG"`"/$link"
    fi
done
APP_HOME=`cd \`dirname "$PRG"\` >/dev/null; pwd`

# Check if global gradle exists in PATH
if command -v gradle >/dev/null 2>&1; then
    exec gradle "$@"
fi

# Fallback: check wrapper jar
CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar
if [ -f "$CLASSPATH" ]; then
    exec java -jar "$CLASSPATH" "$@"
fi

echo "Error: Gradle 8.8+ is required. Please install Gradle or open this project in Android Studio." >&2
exit 1
