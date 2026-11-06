@echo off
title DeGolyer Sudoku - Online Classroom
cd /d "%~dp0"
"%~dp0DeGolyer-Sudoku-Server.exe" --tunnel
if errorlevel 1 pause
