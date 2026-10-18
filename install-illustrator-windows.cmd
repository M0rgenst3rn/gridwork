@echo off
rem Installs MS Grids for Illustrator (a CEP panel) for the current user.
rem Restart Illustrator afterwards: Window > Extensions > MS Grids.
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.linus.msgrids.illustrator"
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%~dp0grids-ai" "%DEST%\" /e /i /q /y >nul
rem The panel is not signed by Adobe, so Illustrator has to be allowed to load unsigned panels.
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo Done. Restart Illustrator ^> Window ^> Extensions ^> MS Grids
pause
