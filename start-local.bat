@echo off
chcp 65001 >nul
echo ========================================
echo   班级课表服务 - 本地测试
echo ========================================
echo.

:: 配置
set "CLASS_NAME=计算机1班"
set "CLASS_DESC=2024年春季学期本地测试"
set "EDIT_PASSWORD="
set "SEMESTER_START=2024-03-01"
set "DATA_FILE=%~dp0data\schedule.json"
set "PORT=3000"

echo 正在启动服务器...
echo.
echo 配置信息:
echo   班级: %CLASS_NAME%
echo   学期: %CLASS_DESC%
echo   密码: %EDIT_PASSWORD% (空表示无需密码)
echo   端口: %PORT%
echo.

cd /d "%~dp0server"

:: 检查 Node.js
if not exist "C:\nodejs\node.exe" (
    echo 错误: 未找到 C:\nodejs\node.exe
    echo 请确保 Node.js 已正确安装
    pause
    exit /b 1
)

echo 启动中...
echo ========================================
echo.

C:\nodejs\node.exe server.js

pause
