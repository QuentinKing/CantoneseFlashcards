@echo off
rem Double-click to run the flashcards app locally at http://localhost:8000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
