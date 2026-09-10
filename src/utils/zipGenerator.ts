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
