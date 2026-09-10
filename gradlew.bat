@rem
@rem Copyright 2015 the original author or authors.
@rem
@if "%DEBUG%"=="" @echo off
set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%
where gradle >nul 2>nul
if %ERRORLEVEL% equ 0 (
    gradle %*
    exit /b %ERRORLEVEL%
)
if exist "%APP_HOME%\gradle\wrapper\gradle-wrapper.jar" (
    java -jar "%APP_HOME%\gradle\wrapper\gradle-wrapper.jar" %*
    exit /b %ERRORLEVEL%
)
echo Error: Gradle 8.8+ is required. Please install Gradle or open this project in Android Studio.
exit /b 1
