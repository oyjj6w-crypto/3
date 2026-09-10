import JSZip from 'jszip';
import { ANDROID_PROJECT_FILES } from '../data/androidProjectSource';

export async function generateAndroidProjectZip(): Promise<Blob> {
  const zip = new JSZip();

  // Root files
  for (const file of ANDROID_PROJECT_FILES) {
    zip.file(file.path, file.content);
  }

  // Add standard gradlew and gradlew.bat
  zip.file('gradlew', `#!/bin/sh
APP_BASE_NAME=\`basename "$0"\`
CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar
exec "\$JAVACMD" "\$@" -classpath "\$CLASSPATH" org.gradle.wrapper.GradleWrapperMain
`);

  zip.file('gradlew.bat', `@rem
@rem Copyright 2015 the original author or authors.
@rem
@if "%DEBUG%"=="" @echo off
set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%
@rem Execute Gradle
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=%APP_BASE_NAME%" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
`);

  zip.file('gradle/wrapper/gradle-wrapper.properties', `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.8-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`);

  zip.file('.gitignore', `*.iml
.gradle
/local.properties
/.idea/caches
/.idea/libraries
/.idea/modules.xml
/.idea/workspace.xml
.DS_Store
/build
/captures
.externalNativeBuild
.cxx
local.properties
`);

  zip.file('.gitattributes', `* text=auto eol=lf
*.bat text eol=crlf
gradlew text eol=lf
*.jar binary
*.png binary
`);

  zip.file('push-to-github.sh', `#!/usr/bin/env bash
# 一键初始化并 Push 到 GitHub 脚本
set -e

if [ -z "$1" ]; then
  echo "使用方法: ./push-to-github.sh <你的GitHub仓库地址>"
  echo "示例: ./push-to-github.sh https://github.com/your-username/trading-multiview.git"
  exit 1
fi

REPO_URL="$1"

echo "==> 1. 初始化 Git 仓库与分支..."
git init
git branch -M main

echo "==> 2. 提交代码与 GitHub Actions 自动编译工作流..."
git add .
git commit -m "feat: Android 多视窗看盘浏览器 (含 GitHub Actions 自动编译 APK 工作流)"

echo "==> 3. 设置远程仓库: $REPO_URL"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

echo "==> 4. 推送到 GitHub (将自动触发 Actions 云端编译)..."
git push -u origin main

echo ""
echo "🎉 推送成功！请打开你的 GitHub 仓库 -> 点击 Actions 标签页查看实时自动编译进度。"
`);

  return await zip.generateAsync({ type: 'blob' });
}

export function triggerDownload(blob: Blob, filename = 'TradingMultiView-Android-Project.zip') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
